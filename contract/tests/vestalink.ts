import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { assert } from "chai";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createMint,
  getAccount,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { Vestalink } from "../target/types/vestalink";

describe("vestalink", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.vestalink as Program<Vestalink>;
  const wallet = provider.wallet as anchor.Wallet;

  let mint: anchor.web3.PublicKey;
  let otherMint: anchor.web3.PublicKey;
  let funderTokenAccount: anchor.web3.PublicKey;
  let recipient: anchor.web3.Keypair;

  function nowSeconds() {
    return Math.floor(Date.now() / 1000);
  }

  function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function derivePda(
    funder: anchor.web3.PublicKey,
    streamRecipient: anchor.web3.PublicKey,
    nonce: anchor.BN
  ) {
    return anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("vesting"),
        funder.toBuffer(),
        streamRecipient.toBuffer(),
        nonce.toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );
  }

  async function expectError(
    action: () => Promise<unknown>,
    expectedCode: string
  ) {
    try {
      await action();
      assert.fail(`Expected ${expectedCode}`);
    } catch (err: any) {
      const code = err.error?.errorCode?.code;
      const message = `${err.error?.errorMessage ?? ""} ${err.toString()}`;
      assert.isTrue(
        code === expectedCode || message.includes(expectedCode),
        `Expected ${expectedCode}, got code=${code}, message=${message}`
      );
    }
  }

  async function createStream(
    params: {
      totalAmount?: anchor.BN;
      startTime?: anchor.BN;
      endTime?: anchor.BN;
      nonce?: anchor.BN;
      streamRecipient?: anchor.web3.Keypair;
      vestingType?: any;
      method?: "createStream" | "createVestingSchedule";
      funderTokenAcct?: anchor.web3.PublicKey;
      vaultTokenAccount?: anchor.web3.PublicKey;
    } = {}
  ) {
    const streamRecipient = params.streamRecipient ?? recipient;
    const nonce = params.nonce ?? new anchor.BN(Date.now());
    const totalAmount = params.totalAmount ?? new anchor.BN(1_000_000);
    const startTime = params.startTime ?? new anchor.BN(nowSeconds());
    const endTime =
      params.endTime ?? new anchor.BN(nowSeconds() + 365 * 24 * 60 * 60);
    const vestingType = params.vestingType ?? { linear: {} };
    const [vestingStatePda, vestingStateBump] = derivePda(
      wallet.payer.publicKey,
      streamRecipient.publicKey,
      nonce
    );
    const vestingTokenAccount =
      params.vaultTokenAccount ??
      getAssociatedTokenAddressSync(mint, vestingStatePda, true);
    const recipientTokenAccount = getAssociatedTokenAddressSync(
      mint,
      streamRecipient.publicKey
    );

    const preInstructions = [];
    if (!params.vaultTokenAccount) {
      preInstructions.push(
        createAssociatedTokenAccountIdempotentInstruction(
          wallet.payer.publicKey,
          vestingTokenAccount,
          vestingStatePda,
          mint,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      );
    }
    preInstructions.push(
      createAssociatedTokenAccountIdempotentInstruction(
        wallet.payer.publicKey,
        recipientTokenAccount,
        streamRecipient.publicKey,
        mint,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );

    const args = {
      totalAmount,
      vestingType,
      startTime,
      endTime,
      cliffTime: startTime,
      milestoneCount: 0,
      nonce,
    };
    const builder =
      params.method === "createVestingSchedule"
        ? program.methods.createVestingSchedule(args)
        : program.methods.createStream(args);

    await builder
      .accountsPartial({
        vestingState: vestingStatePda,
        funder: wallet.payer.publicKey,
        recipient: streamRecipient.publicKey,
        funderTokenAccount: params.funderTokenAcct ?? funderTokenAccount,
        vestingTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .preInstructions(preInstructions)
      .rpc();

    return {
      vestingStatePda,
      vestingStateBump,
      vestingTokenAccount,
      recipientTokenAccount,
      streamRecipient,
      nonce,
      totalAmount,
      startTime,
      endTime,
    };
  }

  async function withdraw(
    stream: Awaited<ReturnType<typeof createStream>>,
    params: {
      signer?: anchor.web3.Keypair;
      recipientTokenAccount?: anchor.web3.PublicKey;
      method?: "withdraw" | "claim" | "claimTokens";
    } = {}
  ) {
    const signer = params.signer ?? stream.streamRecipient;
    const builder =
      params.method === "claim"
        ? program.methods.claim()
        : params.method === "claimTokens"
        ? program.methods.claimTokens()
        : program.methods.withdraw();

    return builder
      .accountsPartial({
        vestingState: stream.vestingStatePda,
        recipient: signer.publicKey,
        recipientTokenAccount:
          params.recipientTokenAccount ?? stream.recipientTokenAccount,
        vestingTokenAccount: stream.vestingTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([signer])
      .rpc();
  }

  before(async () => {
    mint = await createMint(
      provider.connection,
      wallet.payer,
      wallet.payer.publicKey,
      null,
      6
    );
    otherMint = await createMint(
      provider.connection,
      wallet.payer,
      wallet.payer.publicKey,
      null,
      6
    );
    funderTokenAccount = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        wallet.payer,
        mint,
        wallet.payer.publicKey
      )
    ).address;
    await mintTo(
      provider.connection,
      wallet.payer,
      mint,
      funderTokenAccount,
      wallet.payer.publicKey,
      100_000_000_000
    );
    recipient = anchor.web3.Keypair.generate();
  });

  describe("create_stream", () => {
    it("creates a stream and locks tokens in a PDA-owned vault", async () => {
      const totalAmount = new anchor.BN(1_000_000);
      const startTime = new anchor.BN(nowSeconds());
      const endTime = new anchor.BN(startTime.toNumber() + 100);
      const stream = await createStream({
        totalAmount,
        startTime,
        endTime,
        nonce: new anchor.BN(1),
      });

      const state = await program.account.vestingState.fetch(
        stream.vestingStatePda
      );
      const vault = await getAccount(
        provider.connection,
        stream.vestingTokenAccount
      );

      assert.isTrue(state.recipient.equals(recipient.publicKey));
      assert.isTrue(state.funder.equals(wallet.payer.publicKey));
      assert.equal(state.totalAmount.toString(), totalAmount.toString());
      assert.equal(state.claimedAmount.toString(), "0");
      assert.equal(state.vestedAmountAtRevocation.toString(), "0");
      assert.isFalse(state.isRevoked);
      assert.equal(state.startTime.toString(), startTime.toString());
      assert.equal(state.endTime.toString(), endTime.toString());
      assert.equal(state.bump, stream.vestingStateBump);
      assert.isTrue(vault.owner.equals(stream.vestingStatePda));
      assert.equal(vault.amount.toString(), totalAmount.toString());
    });

    it("keeps create_vesting_schedule as a working alias", async () => {
      const stream = await createStream({
        method: "createVestingSchedule",
        nonce: new anchor.BN(2),
      });
      const state = await program.account.vestingState.fetch(
        stream.vestingStatePda
      );
      assert.equal(state.totalAmount.toString(), stream.totalAmount.toString());
    });

    it("rejects invalid stream parameters", async () => {
      await expectError(
        () =>
          createStream({
            totalAmount: new anchor.BN(0),
            nonce: new anchor.BN(3),
          }),
        "InvalidAmount"
      );

      const now = nowSeconds();
      await expectError(
        () =>
          createStream({
            startTime: new anchor.BN(now + 10),
            endTime: new anchor.BN(now + 10),
            nonce: new anchor.BN(4),
          }),
        "InvalidTimeRange"
      );

      await expectError(
        () =>
          createStream({
            vestingType: { milestone: {} },
            nonce: new anchor.BN(5),
          }),
        "UnsupportedVestingType"
      );
    });

    it("rejects a vault not owned by the vesting PDA", async () => {
      const funderOwnedVault = (
        await getOrCreateAssociatedTokenAccount(
          provider.connection,
          wallet.payer,
          mint,
          wallet.payer.publicKey
        )
      ).address;

      await expectError(
        () =>
          createStream({
            vaultTokenAccount: funderOwnedVault,
            nonce: new anchor.BN(6),
          }),
        "InvalidVaultOwner"
      );
    });
  });

  describe("withdraw", () => {
    it("withdraws about 25% from a partially vested stream", async () => {
      const totalAmount = new anchor.BN(1_000_000);
      const now = nowSeconds();
      const stream = await createStream({
        totalAmount,
        startTime: new anchor.BN(now - 25),
        endTime: new anchor.BN(now + 75),
        nonce: new anchor.BN(10),
      });

      await withdraw(stream);

      const state = await program.account.vestingState.fetch(
        stream.vestingStatePda
      );
      const claimed = BigInt(state.claimedAmount.toString());
      assert.isAtLeast(Number(claimed), 250_000);
      assert.isBelow(Number(claimed), 300_000);
    });

    it("allows later partial withdrawals as more tokens unlock", async () => {
      const totalAmount = new anchor.BN(1_000_000);
      const now = nowSeconds();
      const stream = await createStream({
        totalAmount,
        startTime: new anchor.BN(now - 5),
        endTime: new anchor.BN(now + 15),
        nonce: new anchor.BN(11),
      });

      await withdraw(stream);
      const firstState = await program.account.vestingState.fetch(
        stream.vestingStatePda
      );
      await sleep(6000);
      await withdraw(stream);
      const secondState = await program.account.vestingState.fetch(
        stream.vestingStatePda
      );

      assert.isAbove(
        Number(secondState.claimedAmount.toString()),
        Number(firstState.claimedAmount.toString())
      );
      assert.isBelow(
        Number(secondState.claimedAmount.toString()),
        totalAmount.toNumber()
      );
    });

    it("withdraws the full amount after the stream ends", async () => {
      const totalAmount = new anchor.BN(2_000_000);
      const now = nowSeconds();
      const stream = await createStream({
        totalAmount,
        startTime: new anchor.BN(now - 20),
        endTime: new anchor.BN(now - 10),
        nonce: new anchor.BN(12),
      });

      await withdraw(stream, { method: "claimTokens" });

      const state = await program.account.vestingState.fetch(
        stream.vestingStatePda
      );
      assert.equal(state.claimedAmount.toString(), totalAmount.toString());
    });

    it("returns InsufficientUnlockedTokens before any tokens unlock", async () => {
      const now = nowSeconds();
      const stream = await createStream({
        startTime: new anchor.BN(now + 60),
        endTime: new anchor.BN(now + 120),
        nonce: new anchor.BN(13),
      });

      await expectError(() => withdraw(stream), "InsufficientUnlockedTokens");
    });

    it("returns InsufficientUnlockedTokens on repeat full withdrawal", async () => {
      const now = nowSeconds();
      const stream = await createStream({
        startTime: new anchor.BN(now - 20),
        endTime: new anchor.BN(now - 10),
        nonce: new anchor.BN(14),
      });

      await withdraw(stream, { method: "claim" });
      await expectError(() => withdraw(stream), "InsufficientUnlockedTokens");
    });

    it("returns UnauthorizedClaimant for someone else's stream", async () => {
      const now = nowSeconds();
      const stream = await createStream({
        startTime: new anchor.BN(now - 20),
        endTime: new anchor.BN(now + 80),
        nonce: new anchor.BN(15),
      });
      const impostor = anchor.web3.Keypair.generate();
      const impostorAta = getAssociatedTokenAddressSync(
        mint,
        impostor.publicKey
      );

      const airdropSig = await provider.connection.requestAirdrop(
        impostor.publicKey,
        1_000_000_000
      );
      await provider.connection.confirmTransaction(airdropSig);
      await anchor.web3.sendAndConfirmTransaction(
        provider.connection,
        new anchor.web3.Transaction().add(
          createAssociatedTokenAccountIdempotentInstruction(
            impostor.publicKey,
            impostorAta,
            impostor.publicKey,
            mint,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
          )
        ),
        [impostor]
      );

      await expectError(
        () =>
          withdraw(stream, {
            signer: impostor,
            recipientTokenAccount: impostorAta,
          }),
        "UnauthorizedClaimant"
      );
    });

    it("rejects recipient token accounts with a different mint", async () => {
      const now = nowSeconds();
      const stream = await createStream({
        startTime: new anchor.BN(now - 20),
        endTime: new anchor.BN(now + 80),
        nonce: new anchor.BN(16),
      });
      const wrongMintAta = (
        await getOrCreateAssociatedTokenAccount(
          provider.connection,
          wallet.payer,
          otherMint,
          recipient.publicKey
        )
      ).address;

      await expectError(
        () => withdraw(stream, { recipientTokenAccount: wrongMintAta }),
        "InvalidTokenMint"
      );
    });
  });

  describe("revoke_vesting", () => {
    it("sweeps only unvested tokens and allows post-revoke vested withdrawal", async () => {
      const totalAmount = new anchor.BN(1_000_000);
      const now = nowSeconds();
      const stream = await createStream({
        totalAmount,
        startTime: new anchor.BN(now - 25),
        endTime: new anchor.BN(now + 75),
        nonce: new anchor.BN(20),
      });

      const funderBefore = BigInt(
        (await provider.connection.getTokenAccountBalance(funderTokenAccount))
          .value.amount
      );

      await program.methods
        .revokeVesting()
        .accountsPartial({
          vestingState: stream.vestingStatePda,
          authorityRevoker: wallet.payer.publicKey,
          treasuryReturnAddress: funderTokenAccount,
          vestingTokenAccount: stream.vestingTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      const revokedState = await program.account.vestingState.fetch(
        stream.vestingStatePda
      );
      const vested = BigInt(revokedState.vestedAmountAtRevocation.toString());
      const expectedReturn = BigInt(totalAmount.toString()) - vested;
      const funderAfter = BigInt(
        (await provider.connection.getTokenAccountBalance(funderTokenAccount))
          .value.amount
      );

      assert.isTrue(revokedState.isRevoked);
      assert.isAbove(Number(vested), 0);
      assert.isBelow(Number(vested), totalAmount.toNumber());
      assert.equal(
        (funderAfter - funderBefore).toString(),
        expectedReturn.toString()
      );

      await withdraw(stream);
      const finalState = await program.account.vestingState.fetch(
        stream.vestingStatePda
      );
      assert.equal(finalState.claimedAmount.toString(), vested.toString());
    });

    it("keeps cancel_vesting as a working revoke alias", async () => {
      const now = nowSeconds();
      const stream = await createStream({
        startTime: new anchor.BN(now - 50),
        endTime: new anchor.BN(now + 50),
        nonce: new anchor.BN(21),
      });

      await program.methods
        .cancelVesting()
        .accountsPartial({
          vestingState: stream.vestingStatePda,
          authorityRevoker: wallet.payer.publicKey,
          treasuryReturnAddress: funderTokenAccount,
          vestingTokenAccount: stream.vestingTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      const state = await program.account.vestingState.fetch(
        stream.vestingStatePda
      );
      assert.isTrue(state.isRevoked);
    });

    it("rejects repeated revocation", async () => {
      const now = nowSeconds();
      const stream = await createStream({
        startTime: new anchor.BN(now - 50),
        endTime: new anchor.BN(now + 50),
        nonce: new anchor.BN(22),
      });

      await program.methods
        .revokeVesting()
        .accountsPartial({
          vestingState: stream.vestingStatePda,
          authorityRevoker: wallet.payer.publicKey,
          treasuryReturnAddress: funderTokenAccount,
          vestingTokenAccount: stream.vestingTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      await expectError(
        () =>
          program.methods
            .revokeVesting()
            .accountsPartial({
              vestingState: stream.vestingStatePda,
              authorityRevoker: wallet.payer.publicKey,
              treasuryReturnAddress: funderTokenAccount,
              vestingTokenAccount: stream.vestingTokenAccount,
              tokenProgram: TOKEN_PROGRAM_ID,
            })
            .rpc(),
        "StreamRevoked"
      );
    });

    it("rejects an unexpected treasury return address", async () => {
      const now = nowSeconds();
      const stream = await createStream({
        startTime: new anchor.BN(now - 50),
        endTime: new anchor.BN(now + 50),
        nonce: new anchor.BN(23),
      });
      const wrongTreasury = (
        await getOrCreateAssociatedTokenAccount(
          provider.connection,
          wallet.payer,
          mint,
          anchor.web3.Keypair.generate().publicKey
        )
      ).address;

      await expectError(
        () =>
          program.methods
            .revokeVesting()
            .accountsPartial({
              vestingState: stream.vestingStatePda,
              authorityRevoker: wallet.payer.publicKey,
              treasuryReturnAddress: wrongTreasury,
              vestingTokenAccount: stream.vestingTokenAccount,
              tokenProgram: TOKEN_PROGRAM_ID,
            })
            .rpc(),
        "InvalidTreasuryReturnAddress"
      );
    });
  });

  describe("unlock_milestone", () => {
    it("remains explicitly unsupported for this trial", async () => {
      const stream = await createStream({ nonce: new anchor.BN(30) });

      await expectError(
        () =>
          program.methods
            .unlockMilestone()
            .accountsPartial({
              vestingState: stream.vestingStatePda,
              authorityMilestone: wallet.payer.publicKey,
            })
            .rpc(),
        "UnsupportedVestingType"
      );
    });
  });
});
