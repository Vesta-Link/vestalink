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
  let faucetMint: anchor.web3.PublicKey;
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

  function deriveFaucetPda() {
    return anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vesta_faucet")],
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
      cliffTime?: anchor.BN;
      milestoneCount?: number;
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
    const cliffTime = params.cliffTime ?? startTime;
    const milestoneCount = params.milestoneCount ?? 0;
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
      cliffTime,
      milestoneCount,
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
    const [faucetAuthority] = deriveFaucetPda();
    faucetMint = await createMint(
      provider.connection,
      wallet.payer,
      faucetAuthority,
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
            milestoneCount: 0,
            nonce: new anchor.BN(5),
          }),
        "MilestoneCountZero"
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
      assert.isAtLeast(Number(claimed), 230_000);
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
    it("rejects unlock_milestone on a non-milestone stream with UnsupportedVestingType", async () => {
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

  describe("milestone vesting", () => {
    it("creates a milestone stream and stores milestone_count", async () => {
      const totalAmount = new anchor.BN(1_000_000);
      const now = nowSeconds();
      const stream = await createStream({
        totalAmount,
        startTime: new anchor.BN(now),
        endTime: new anchor.BN(now + 365 * 24 * 60 * 60),
        vestingType: { milestone: {} },
        milestoneCount: 4,
        nonce: new anchor.BN(50),
      });

      const state = await program.account.vestingState.fetch(
        stream.vestingStatePda
      );

      assert.isTrue("milestone" in state.vestingType);
      assert.equal(state.milestoneCount, 4);
      assert.equal(state.milestonesReached, 0);
      assert.equal(state.totalAmount.toString(), totalAmount.toString());
    });

    it("rejects milestone stream with milestone_count == 0", async () => {
      await expectError(
        () =>
          createStream({
            vestingType: { milestone: {} },
            milestoneCount: 0,
            nonce: new anchor.BN(51),
          }),
        "MilestoneCountZero"
      );
    });

    it("increments milestones_reached on unlock_milestone", async () => {
      const stream = await createStream({
        totalAmount: new anchor.BN(1_000_000),
        vestingType: { milestone: {} },
        milestoneCount: 4,
        nonce: new anchor.BN(52),
      });

      let state = await program.account.vestingState.fetch(
        stream.vestingStatePda
      );
      assert.equal(state.milestonesReached, 0);

      await program.methods
        .unlockMilestone()
        .accountsPartial({
          vestingState: stream.vestingStatePda,
          authorityMilestone: wallet.payer.publicKey,
        })
        .rpc();

      state = await program.account.vestingState.fetch(
        stream.vestingStatePda
      );
      assert.equal(state.milestonesReached, 1);

      await program.methods
        .unlockMilestone()
        .accountsPartial({
          vestingState: stream.vestingStatePda,
          authorityMilestone: wallet.payer.publicKey,
        })
        .rpc();

      state = await program.account.vestingState.fetch(
        stream.vestingStatePda
      );
      assert.equal(state.milestonesReached, 2);
    });

    it("withdraws correct proportional amount after milestone unlock", async () => {
      // 4 milestones, total 1_000_000 tokens
      // After 1 milestone: 1/4 = 250_000 unlocked
      const totalAmount = new anchor.BN(1_000_000);
      const stream = await createStream({
        totalAmount,
        vestingType: { milestone: {} },
        milestoneCount: 4,
        nonce: new anchor.BN(53),
      });

      // Unlock 1 milestone
      await program.methods
        .unlockMilestone()
        .accountsPartial({
          vestingState: stream.vestingStatePda,
          authorityMilestone: wallet.payer.publicKey,
        })
        .rpc();

      // Withdraw
      await withdraw(stream);

      const state = await program.account.vestingState.fetch(
        stream.vestingStatePda
      );
      const claimed = Number(state.claimedAmount.toString());
      // 1/4 of 1_000_000 = 250_000
      assert.equal(claimed, 250_000);
    });

    it("withdraws full amount after all milestones reached", async () => {
      // 3 milestones, total 900_000 tokens
      const totalAmount = new anchor.BN(900_000);
      const stream = await createStream({
        totalAmount,
        vestingType: { milestone: {} },
        milestoneCount: 3,
        nonce: new anchor.BN(54),
      });

      // Unlock all 3 milestones
      for (let i = 0; i < 3; i++) {
        await program.methods
          .unlockMilestone()
          .accountsPartial({
            vestingState: stream.vestingStatePda,
            authorityMilestone: wallet.payer.publicKey,
          })
          .rpc();
      }

      // Withdraw
      await withdraw(stream);

      const state = await program.account.vestingState.fetch(
        stream.vestingStatePda
      );
      assert.equal(state.claimedAmount.toString(), totalAmount.toString());
    });

    it("rejects extra unlock_milestone after all milestones reached", async () => {
      const stream = await createStream({
        vestingType: { milestone: {} },
        milestoneCount: 2,
        nonce: new anchor.BN(55),
      });

      // Unlock both milestones
      await program.methods
        .unlockMilestone()
        .accountsPartial({
          vestingState: stream.vestingStatePda,
          authorityMilestone: wallet.payer.publicKey,
        })
        .rpc();

      await program.methods
        .unlockMilestone()
        .accountsPartial({
          vestingState: stream.vestingStatePda,
          authorityMilestone: wallet.payer.publicKey,
        })
        .rpc();

      // 3rd unlock should fail
      await expectError(
        () =>
          program.methods
            .unlockMilestone()
            .accountsPartial({
              vestingState: stream.vestingStatePda,
              authorityMilestone: wallet.payer.publicKey,
            })
            .rpc(),
        "AllMilestonesReached"
      );
    });

    it("rejects unlock_milestone on a non-milestone stream with UnsupportedVestingType", async () => {
      // Create a cliff stream (not milestone)
      const now = nowSeconds();
      const stream = await createStream({
        vestingType: { cliff: {} },
        cliffTime: new anchor.BN(now + 60),
        nonce: new anchor.BN(56),
      });

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

  describe("cliff vesting", () => {
    it("creates a cliff stream and stores cliff_time", async () => {
      const totalAmount = new anchor.BN(1_000_000);
      const now = nowSeconds();
      const startTime = new anchor.BN(now);
      const endTime = new anchor.BN(now + 200);
      const cliffTime = new anchor.BN(now + 100);

      const stream = await createStream({
        totalAmount,
        startTime,
        endTime,
        cliffTime,
        vestingType: { cliff: {} },
        nonce: new anchor.BN(40),
      });

      const state = await program.account.vestingState.fetch(
        stream.vestingStatePda
      );

      // Verify vestingType is cliff
      assert.isTrue("cliff" in state.vestingType);
      // Verify cliff_time is stored as provided (not overwritten to start_time)
      assert.equal(state.cliffTime.toString(), cliffTime.toString());
      assert.equal(state.totalAmount.toString(), totalAmount.toString());
      assert.equal(state.startTime.toString(), startTime.toString());
      assert.equal(state.endTime.toString(), endTime.toString());
    });

    it("rejects withdrawal before cliff_time with InsufficientUnlockedTokens", async () => {
      const now = nowSeconds();
      // Stream starts now, cliff is 60s from now, ends 120s from now
      const stream = await createStream({
        startTime: new anchor.BN(now),
        endTime: new anchor.BN(now + 120),
        cliffTime: new anchor.BN(now + 60),
        vestingType: { cliff: {} },
        nonce: new anchor.BN(41),
      });

      // Before cliff: no tokens unlocked
      await expectError(
        () => withdraw(stream),
        "InsufficientUnlockedTokens"
      );
    });

    it("withdraws correct linear amount after cliff_time", async () => {
      const totalAmount = new anchor.BN(1_000_000);
      const now = nowSeconds();
      // Stream started 50s ago, cliff was 25s ago, ends 50s from now
      // Duration = 100s, elapsed = 50s => 50% vested = 500_000
      const stream = await createStream({
        totalAmount,
        startTime: new anchor.BN(now - 50),
        endTime: new anchor.BN(now + 50),
        cliffTime: new anchor.BN(now - 25),
        vestingType: { cliff: {} },
        nonce: new anchor.BN(42),
      });

      await withdraw(stream);

      const state = await program.account.vestingState.fetch(
        stream.vestingStatePda
      );
      const claimed = Number(state.claimedAmount.toString());
      // Should be roughly 50% (allow some timing variance)
      assert.isAtLeast(claimed, 400_000);
      assert.isBelow(claimed, 600_000);
    });

    it("cliff_time == start_time behaves like linear vesting", async () => {
      const totalAmount = new anchor.BN(1_000_000);
      const now = nowSeconds();
      // cliff_time == start_time means no cliff delay
      const startTime = new anchor.BN(now - 25);
      const endTime = new anchor.BN(now + 75);
      const cliffTime = startTime; // cliff == start

      const stream = await createStream({
        totalAmount,
        startTime,
        endTime,
        cliffTime,
        vestingType: { cliff: {} },
        nonce: new anchor.BN(43),
      });

      const state = await program.account.vestingState.fetch(
        stream.vestingStatePda
      );
      assert.equal(state.cliffTime.toString(), startTime.toString());

      // Should be able to withdraw immediately (like linear)
      await withdraw(stream);

      const stateAfter = await program.account.vestingState.fetch(
        stream.vestingStatePda
      );
      const claimed = Number(stateAfter.claimedAmount.toString());
      assert.isAbove(claimed, 0);
    });

    it("rejects cliff_time > end_time with CliffTimeExceedsEndTime", async () => {
      const now = nowSeconds();
      const startTime = new anchor.BN(now);
      const endTime = new anchor.BN(now + 100);
      const cliffTime = new anchor.BN(now + 200); // cliff > end

      await expectError(
        () =>
          createStream({
            startTime,
            endTime,
            cliffTime,
            vestingType: { cliff: {} },
            nonce: new anchor.BN(44),
          }),
        "CliffTimeExceedsEndTime"
      );
    });
  });

  describe("cancel_stream", () => {
    it("cancels mid-stream: recipient keeps vested, funder gets unvested", async () => {
      const totalAmount = new anchor.BN(1_000_000);
      const now = nowSeconds();
      // Stream started 25s ago, ends 75s from now => ~25% vested
      const stream = await createStream({
        totalAmount,
        startTime: new anchor.BN(now - 25),
        endTime: new anchor.BN(now + 75),
        nonce: new anchor.BN(60),
      });

      const funderBefore = BigInt(
        (await provider.connection.getTokenAccountBalance(funderTokenAccount))
          .value.amount
      );

      await program.methods
        .cancelStream()
        .accountsPartial({
          vestingState: stream.vestingStatePda,
          authorityRevoker: wallet.payer.publicKey,
          treasuryReturnAddress: funderTokenAccount,
          vestingTokenAccount: stream.vestingTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      const cancelledState = await program.account.vestingState.fetch(
        stream.vestingStatePda
      );
      const vested = BigInt(cancelledState.vestedAmountAtRevocation.toString());
      const expectedReturn = BigInt(totalAmount.toString()) - vested;
      const funderAfter = BigInt(
        (await provider.connection.getTokenAccountBalance(funderTokenAccount))
          .value.amount
      );

      assert.isTrue(cancelledState.isRevoked);
      assert.isAbove(Number(vested), 0);
      assert.isBelow(Number(vested), totalAmount.toNumber());
      assert.equal(
        (funderAfter - funderBefore).toString(),
        expectedReturn.toString()
      );

      // Recipient can still withdraw the vested amount
      await withdraw(stream);
      const finalState = await program.account.vestingState.fetch(
        stream.vestingStatePda
      );
      assert.equal(finalState.claimedAmount.toString(), vested.toString());
    });

    it("cancels before cliff: funder gets nearly all tokens back", async () => {
      const totalAmount = new anchor.BN(1_000_000);
      const now = nowSeconds();
      // Cliff stream: starts now, cliff 60s from now, ends 120s from now
      // Before cliff: nothing is vested, so funder should get almost everything back
      const stream = await createStream({
        totalAmount,
        startTime: new anchor.BN(now),
        endTime: new anchor.BN(now + 120),
        cliffTime: new anchor.BN(now + 60),
        vestingType: { cliff: {} },
        nonce: new anchor.BN(61),
      });

      const funderBefore = BigInt(
        (await provider.connection.getTokenAccountBalance(funderTokenAccount))
          .value.amount
      );

      await program.methods
        .cancelStream()
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
      // Before cliff, vested amount should be 0 or very small
      const vested = Number(state.vestedAmountAtRevocation.toString());
      assert.isAtMost(vested, 10_000); // Allow tiny timing variance

      // Funder should get back nearly the full amount
      const funderAfter = BigInt(
        (await provider.connection.getTokenAccountBalance(funderTokenAccount))
          .value.amount
      );
      const returned = Number(funderAfter - funderBefore);
      assert.isAtLeast(returned, 990_000);
    });

    it("rejects cancel after full vest with StreamFullyVested", async () => {
      const now = nowSeconds();
      // Stream that has already ended (fully vested)
      const stream = await createStream({
        startTime: new anchor.BN(now - 200),
        endTime: new anchor.BN(now - 100),
        nonce: new anchor.BN(62),
      });

      await expectError(
        () =>
          program.methods
            .cancelStream()
            .accountsPartial({
              vestingState: stream.vestingStatePda,
              authorityRevoker: wallet.payer.publicKey,
              treasuryReturnAddress: funderTokenAccount,
              vestingTokenAccount: stream.vestingTokenAccount,
              tokenProgram: TOKEN_PROGRAM_ID,
            })
            .rpc(),
        "StreamFullyVested"
      );
    });

    it("rejects cancel of already-cancelled stream with StreamCancelled", async () => {
      const now = nowSeconds();
      const stream = await createStream({
        startTime: new anchor.BN(now - 50),
        endTime: new anchor.BN(now + 50),
        nonce: new anchor.BN(63),
      });

      // First cancel succeeds
      await program.methods
        .cancelStream()
        .accountsPartial({
          vestingState: stream.vestingStatePda,
          authorityRevoker: wallet.payer.publicKey,
          treasuryReturnAddress: funderTokenAccount,
          vestingTokenAccount: stream.vestingTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      // Second cancel should fail with StreamCancelled
      await expectError(
        () =>
          program.methods
            .cancelStream()
            .accountsPartial({
              vestingState: stream.vestingStatePda,
              authorityRevoker: wallet.payer.publicKey,
              treasuryReturnAddress: funderTokenAccount,
              vestingTokenAccount: stream.vestingTokenAccount,
              tokenProgram: TOKEN_PROGRAM_ID,
            })
            .rpc(),
        "StreamCancelled"
      );
    });

    it("rejects cancel by non-authority", async () => {
      const now = nowSeconds();
      const stream = await createStream({
        startTime: new anchor.BN(now - 50),
        endTime: new anchor.BN(now + 50),
        nonce: new anchor.BN(64),
      });

      const impostor = anchor.web3.Keypair.generate();
      const airdropSig = await provider.connection.requestAirdrop(
        impostor.publicKey,
        1_000_000_000
      );
      await provider.connection.confirmTransaction(airdropSig);

      // The has_one = authority_revoker constraint should reject non-authority
      await expectError(
        () =>
          program.methods
            .cancelStream()
            .accountsPartial({
              vestingState: stream.vestingStatePda,
              authorityRevoker: impostor.publicKey,
              treasuryReturnAddress: funderTokenAccount,
              vestingTokenAccount: stream.vestingTokenAccount,
              tokenProgram: TOKEN_PROGRAM_ID,
            })
            .signers([impostor])
            .rpc(),
        "ConstraintHasOne"
      );
    });

    it("allows withdrawal from cancelled stream for vested amount", async () => {
      const totalAmount = new anchor.BN(1_000_000);
      const now = nowSeconds();
      // Stream started 50s ago, ends 50s from now => ~50% vested
      const stream = await createStream({
        totalAmount,
        startTime: new anchor.BN(now - 50),
        endTime: new anchor.BN(now + 50),
        nonce: new anchor.BN(65),
      });

      // Cancel the stream
      await program.methods
        .cancelStream()
        .accountsPartial({
          vestingState: stream.vestingStatePda,
          authorityRevoker: wallet.payer.publicKey,
          treasuryReturnAddress: funderTokenAccount,
          vestingTokenAccount: stream.vestingTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      const cancelledState = await program.account.vestingState.fetch(
        stream.vestingStatePda
      );
      assert.isTrue(cancelledState.isRevoked);
      const vestedAmount = BigInt(cancelledState.vestedAmountAtRevocation.toString());

      // Recipient withdraws the vested amount
      await withdraw(stream);

      const finalState = await program.account.vestingState.fetch(
        stream.vestingStatePda
      );
      assert.equal(finalState.claimedAmount.toString(), vestedAmount.toString());

      // Second withdrawal should fail — no more unlocked tokens
      await expectError(
        () => withdraw(stream),
        "InsufficientUnlockedTokens"
      );
    });
  });

  // ── Property-based tests ──

  describe("cliff vesting — property tests", () => {
    // Property 1: Cliff gates withdrawals
    // For any cliff stream, unlocked is zero before cliff_time.
    // Test with multiple randomized cliff_time values.
    it("Property 1: withdrawal before cliff_time always fails with InsufficientUnlockedTokens", async () => {
      const totalAmount = new anchor.BN(1_000_000);
      const cliffOffsets = [30, 45, 60, 90, 120, 180, 300]; // seconds into the future

      for (let i = 0; i < cliffOffsets.length; i++) {
        const now = nowSeconds();
        const cliffOffset = cliffOffsets[i];
        const stream = await createStream({
          totalAmount,
          startTime: new anchor.BN(now),
          endTime: new anchor.BN(now + 600),
          cliffTime: new anchor.BN(now + cliffOffset),
          vestingType: { cliff: {} },
          nonce: new anchor.BN(100 + i),
        });

        // Before cliff: no tokens should be unlocked
        await expectError(
          () => withdraw(stream),
          "InsufficientUnlockedTokens"
        );
      }
    });

    // Property 2: Cliff falls through to linear
    // For any cliff stream after cliff_time, unlocked matches the linear formula:
    // total_amount * (now - start_time) / (end_time - start_time)
    it("Property 2: after cliff_time, unlocked matches linear formula within ±5%", async () => {
      const totalAmount = new anchor.BN(1_000_000);
      // Each config: [startOffset (seconds ago), cliffOffset (seconds ago, must be <= startOffset), endOffset (seconds from now)]
      // cliff has already passed in all cases
      const configs = [
        { startAgo: 60, cliffAgo: 30, endAhead: 60 },   // 50% through
        { startAgo: 100, cliffAgo: 80, endAhead: 100 },  // 50% through
        { startAgo: 40, cliffAgo: 20, endAhead: 160 },    // 20% through
        { startAgo: 80, cliffAgo: 40, endAhead: 20 },     // 80% through
        { startAgo: 50, cliffAgo: 50, endAhead: 50 },     // 50% through, cliff==start
        { startAgo: 120, cliffAgo: 60, endAhead: 30 },    // 80% through
        { startAgo: 30, cliffAgo: 10, endAhead: 270 },     // 10% through
      ];

      for (let i = 0; i < configs.length; i++) {
        const { startAgo, cliffAgo, endAhead } = configs[i];
        const now = nowSeconds();
        const startTime = new anchor.BN(now - startAgo);
        const endTime = new anchor.BN(now + endAhead);
        const cliffTime = new anchor.BN(now - cliffAgo);

        const stream = await createStream({
          totalAmount,
          startTime,
          endTime,
          cliffTime,
          vestingType: { cliff: {} },
          nonce: new anchor.BN(110 + i),
        });

        await withdraw(stream);

        const state = await program.account.vestingState.fetch(
          stream.vestingStatePda
        );
        const claimed = Number(state.claimedAmount.toString());

        // Expected: totalAmount * (now - startTime) / (endTime - startTime)
        // Use the actual start/end times from the stream (which may differ slightly)
        const duration = endTime.toNumber() - startTime.toNumber();
        // We can't know the exact block time, so compute expected based on stream params
        // The actual elapsed time is approximately startAgo seconds
        const expectedApprox = (totalAmount.toNumber() * startAgo) / duration;
        const tolerance = expectedApprox * 0.05;

        assert.isAtLeast(
          claimed,
          Math.floor(expectedApprox - tolerance),
          `Cliff property 2 iteration ${i}: claimed ${claimed} too low, expected ~${expectedApprox}`
        );
        assert.isAtMost(
          claimed,
          Math.ceil(expectedApprox + tolerance),
          `Cliff property 2 iteration ${i}: claimed ${claimed} too high, expected ~${expectedApprox}`
        );
      }
    });
  });

  describe("milestone vesting — property tests", () => {
    // Property 4: Milestone unlock is proportional
    // For any milestone stream, unlocked equals total_amount * milestones_reached / milestone_count.
    it("Property 4: claimed amount equals totalAmount * milestonesReached / milestoneCount", async () => {
      const totalAmount = new anchor.BN(1_000_000);
      const milestoneCounts = [2, 3, 4, 5];

      let nonceCounter = 200;

      for (const milestoneCount of milestoneCounts) {
        // Test unlocking 1, then 2, ... up to milestoneCount milestones
        const stream = await createStream({
          totalAmount,
          vestingType: { milestone: {} },
          milestoneCount,
          nonce: new anchor.BN(nonceCounter++),
        });

        let cumulativeClaimed = 0;

        for (let reached = 1; reached <= milestoneCount; reached++) {
          // Unlock one more milestone
          await program.methods
            .unlockMilestone()
            .accountsPartial({
              vestingState: stream.vestingStatePda,
              authorityMilestone: wallet.payer.publicKey,
            })
            .rpc();

          // Withdraw the newly unlocked amount
          await withdraw(stream);

          const state = await program.account.vestingState.fetch(
            stream.vestingStatePda
          );
          const claimed = Number(state.claimedAmount.toString());

          // Expected: totalAmount * reached / milestoneCount
          const expected = Math.floor(
            (totalAmount.toNumber() * reached) / milestoneCount
          );

          assert.equal(
            claimed,
            expected,
            `Milestone property 4: count=${milestoneCount}, reached=${reached}, expected=${expected}, got=${claimed}`
          );

          cumulativeClaimed = claimed;
        }

        // After all milestones, total claimed should equal totalAmount
        assert.equal(
          cumulativeClaimed,
          totalAmount.toNumber(),
          `Milestone property 4: after all ${milestoneCount} milestones, claimed should equal totalAmount`
        );
      }
    });
  });

  describe("cancel_stream — property tests", () => {
    // Property 5: Cancel distributes correctly
    // For any cancelled stream, recipient can withdraw exactly the vested amount
    // and funder receives back exactly the unvested portion.
    it("Property 5: cancel distributes vested to recipient and unvested to funder", async () => {
      const totalAmount = new anchor.BN(1_000_000);
      // Different vesting percentages: ~10%, ~30%, ~50%, ~70%
      // startAgo / (startAgo + endAhead) gives approximate vesting %
      const configs = [
        { startAgo: 10, endAhead: 90, label: "~10%" },
        { startAgo: 30, endAhead: 70, label: "~30%" },
        { startAgo: 50, endAhead: 50, label: "~50%" },
        { startAgo: 70, endAhead: 30, label: "~70%" },
      ];

      let nonceCounter = 300;

      for (const { startAgo, endAhead, label } of configs) {
        const now = nowSeconds();
        const startTime = new anchor.BN(now - startAgo);
        const endTime = new anchor.BN(now + endAhead);

        const stream = await createStream({
          totalAmount,
          startTime,
          endTime,
          nonce: new anchor.BN(nonceCounter++),
        });

        // Record funder balance before cancel
        const funderBefore = BigInt(
          (await provider.connection.getTokenAccountBalance(funderTokenAccount))
            .value.amount
        );

        // Cancel the stream
        await program.methods
          .cancelStream()
          .accountsPartial({
            vestingState: stream.vestingStatePda,
            authorityRevoker: wallet.payer.publicKey,
            treasuryReturnAddress: funderTokenAccount,
            vestingTokenAccount: stream.vestingTokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();

        // Fetch cancelled state
        const cancelledState = await program.account.vestingState.fetch(
          stream.vestingStatePda
        );

        assert.isTrue(cancelledState.isRevoked, `${label}: stream should be revoked`);

        const vestedAtRevocation = BigInt(cancelledState.vestedAmountAtRevocation.toString());
        const expectedUnvested = BigInt(totalAmount.toString()) - vestedAtRevocation;

        // Verify vestedAmountAtRevocation is within ±5% of expected linear formula
        const duration = endTime.toNumber() - startTime.toNumber();
        const expectedVestedApprox = Math.floor(
          (totalAmount.toNumber() * startAgo) / duration
        );
        const tolerance = expectedVestedApprox * 0.05;
        const vestedNum = Number(vestedAtRevocation);

        assert.isAtLeast(
          vestedNum,
          Math.floor(expectedVestedApprox - tolerance),
          `${label}: vestedAtRevocation ${vestedNum} too low, expected ~${expectedVestedApprox}`
        );
        assert.isAtMost(
          vestedNum,
          Math.ceil(expectedVestedApprox + tolerance),
          `${label}: vestedAtRevocation ${vestedNum} too high, expected ~${expectedVestedApprox}`
        );

        // Verify funder received back the unvested portion
        const funderAfter = BigInt(
          (await provider.connection.getTokenAccountBalance(funderTokenAccount))
            .value.amount
        );
        const funderReceived = funderAfter - funderBefore;
        assert.equal(
          funderReceived.toString(),
          expectedUnvested.toString(),
          `${label}: funder should receive back totalAmount - vestedAmountAtRevocation`
        );

        // Verify recipient can withdraw exactly the vested amount
        await withdraw(stream);

        const finalState = await program.account.vestingState.fetch(
          stream.vestingStatePda
        );
        assert.equal(
          finalState.claimedAmount.toString(),
          vestedAtRevocation.toString(),
          `${label}: recipient should withdraw exactly vestedAmountAtRevocation`
        );

        // Verify no further withdrawal is possible
        await expectError(
          () => withdraw(stream),
          "InsufficientUnlockedTokens"
        );
      }
    });
  });

  describe("request_vesta", () => {
    it("mints test VESTA from the faucet PDA authority", async () => {
      const requesterTokenAccount = getAssociatedTokenAddressSync(
        faucetMint,
        wallet.payer.publicKey
      );
      const [faucetAuthority] = deriveFaucetPda();

      await program.methods
        .requestVesta()
        .accountsPartial({
          requester: wallet.payer.publicKey,
          vestaMint: faucetMint,
          requesterTokenAccount,
          faucetAuthority,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .preInstructions([
          createAssociatedTokenAccountIdempotentInstruction(
            wallet.payer.publicKey,
            requesterTokenAccount,
            wallet.payer.publicKey,
            faucetMint,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
          ),
        ])
        .rpc();

      const account = await getAccount(
        provider.connection,
        requesterTokenAccount
      );
      assert.equal(account.amount.toString(), "10000000000");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Integration — Full Flow
  // Tests the complete lifecycle: create_stream → (wait) → withdraw → verify
  // recipient token balance delta and vault balance delta exactly match the
  // claimed amount reported by on-chain state.
  // ─────────────────────────────────────────────────────────────────────────────

  describe("integration — full flow", () => {
    it("full flow: create → partial withdraw → verify balance delta → wait → full withdraw → verify total", async () => {
      const totalAmount = new anchor.BN(1_000_000);
      const now = nowSeconds();
      // Stream: started 5s ago, ends 15s from now → 20s total, ~25% elapsed at creation
      const stream = await createStream({
        totalAmount,
        startTime: new anchor.BN(now - 5),
        endTime: new anchor.BN(now + 15),
        nonce: new anchor.BN(400),
      });

      // ── Step 1: Capture pre-withdraw balances ──
      const recipientBefore = BigInt(
        (
          await provider.connection.getTokenAccountBalance(
            stream.recipientTokenAccount
          )
        ).value.amount
      );
      const vaultBefore = BigInt(
        (
          await provider.connection.getTokenAccountBalance(
            stream.vestingTokenAccount
          )
        ).value.amount
      );

      // ── Step 2: First partial withdraw ──
      await withdraw(stream);

      const stateAfterFirst = await program.account.vestingState.fetch(
        stream.vestingStatePda
      );
      const firstClaimed = BigInt(stateAfterFirst.claimedAmount.toString());
      assert.isAbove(Number(firstClaimed), 0, "First claim must be > 0");
      assert.isBelow(
        Number(firstClaimed),
        totalAmount.toNumber(),
        "First claim must be < totalAmount (stream not ended)"
      );

      // ── Step 3: Verify token balance deltas ──
      const recipientAfterFirst = BigInt(
        (
          await provider.connection.getTokenAccountBalance(
            stream.recipientTokenAccount
          )
        ).value.amount
      );
      const vaultAfterFirst = BigInt(
        (
          await provider.connection.getTokenAccountBalance(
            stream.vestingTokenAccount
          )
        ).value.amount
      );

      assert.equal(
        (recipientAfterFirst - recipientBefore).toString(),
        firstClaimed.toString(),
        "Recipient balance should increase by exactly claimedAmount"
      );
      assert.equal(
        (vaultBefore - vaultAfterFirst).toString(),
        firstClaimed.toString(),
        "Vault balance should decrease by exactly claimedAmount"
      );

      // ── Step 4: Wait for stream to fully vest ──
      await sleep(17_000); // stream ends 15s from creation, wait a bit extra

      // ── Step 5: Final withdraw — drain remaining ──
      await withdraw(stream);

      const stateFinal = await program.account.vestingState.fetch(
        stream.vestingStatePda
      );
      assert.equal(
        stateFinal.claimedAmount.toString(),
        totalAmount.toString(),
        "After stream ends, total claimedAmount must equal totalAmount"
      );

      // ── Step 6: Verify final token balances ──
      const recipientFinal = BigInt(
        (
          await provider.connection.getTokenAccountBalance(
            stream.recipientTokenAccount
          )
        ).value.amount
      );
      const vaultFinal = BigInt(
        (
          await provider.connection.getTokenAccountBalance(
            stream.vestingTokenAccount
          )
        ).value.amount
      );

      assert.equal(
        (recipientFinal - recipientBefore).toString(),
        totalAmount.toString(),
        "Recipient net gain must equal totalAmount"
      );
      assert.equal(
        vaultFinal.toString(),
        "0",
        "Vault must be fully drained after complete claim"
      );
    });

    it("full flow: create cliff stream → wait past cliff → withdraw → verify balance", async () => {
      const totalAmount = new anchor.BN(500_000);
      const now = nowSeconds();
      // Cliff: started 5s ago, cliff 3s from now, ends 25s from now
      const stream = await createStream({
        totalAmount,
        startTime: new anchor.BN(now - 5),
        endTime: new anchor.BN(now + 25),
        cliffTime: new anchor.BN(now + 3),
        vestingType: { cliff: {} },
        nonce: new anchor.BN(401),
      });

      // Before cliff: withdrawal must fail
      await expectError(
        () => withdraw(stream),
        "InsufficientUnlockedTokens"
      );

      // Wait for cliff to pass
      await sleep(5_000);

      const recipientBefore = BigInt(
        (
          await provider.connection.getTokenAccountBalance(
            stream.recipientTokenAccount
          )
        ).value.amount
      );

      await withdraw(stream);

      const state = await program.account.vestingState.fetch(
        stream.vestingStatePda
      );
      const claimed = BigInt(state.claimedAmount.toString());
      assert.isAbove(Number(claimed), 0, "Should have claimed some tokens after cliff");

      const recipientAfter = BigInt(
        (
          await provider.connection.getTokenAccountBalance(
            stream.recipientTokenAccount
          )
        ).value.amount
      );
      assert.equal(
        (recipientAfter - recipientBefore).toString(),
        claimed.toString(),
        "Recipient balance delta must equal claimedAmount"
      );
    });

    it("full flow: milestone stream → unlock all → withdraw → verify full balance", async () => {
      const totalAmount = new anchor.BN(600_000);
      const stream = await createStream({
        totalAmount,
        vestingType: { milestone: {} },
        milestoneCount: 3,
        nonce: new anchor.BN(402),
      });

      const recipientBefore = BigInt(
        (
          await provider.connection.getTokenAccountBalance(
            stream.recipientTokenAccount
          )
        ).value.amount
      );

      // Unlock all 3 milestones and withdraw after each
      for (let i = 0; i < 3; i++) {
        await program.methods
          .unlockMilestone()
          .accountsPartial({
            vestingState: stream.vestingStatePda,
            authorityMilestone: wallet.payer.publicKey,
          })
          .rpc();

        await withdraw(stream);
      }

      const stateFinal = await program.account.vestingState.fetch(
        stream.vestingStatePda
      );
      assert.equal(
        stateFinal.claimedAmount.toString(),
        totalAmount.toString(),
        "claimedAmount must equal totalAmount after all milestones"
      );

      const recipientFinal = BigInt(
        (
          await provider.connection.getTokenAccountBalance(
            stream.recipientTokenAccount
          )
        ).value.amount
      );
      assert.equal(
        (recipientFinal - recipientBefore).toString(),
        totalAmount.toString(),
        "Recipient net gain must equal totalAmount"
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Edge Cases
  // Boundary conditions that could silently break the protocol.
  // ─────────────────────────────────────────────────────────────────────────────

  describe("edge cases", () => {
    // ── Edge case 1: Zero-amount stream ──
    // Creating a stream with totalAmount = 0 must be rejected.
    // This prevents locking zero tokens (wasted rent) and polluting state.
    it("zero amount stream is rejected with InvalidAmount", async () => {
      await expectError(
        () =>
          createStream({
            totalAmount: new anchor.BN(0),
            nonce: new anchor.BN(410),
          }),
        "InvalidAmount"
      );
    });

    // ── Edge case 2: Withdraw at exactly cliff_time ──
    // The contract uses `current_time <= cliff_time → return 0`.
    // At the exact second of cliff_time, nothing should be claimable.
    // This tests the off-by-one boundary (inclusive zero at cliff boundary).
    it("withdraw at exactly cliff_time returns InsufficientUnlockedTokens", async () => {
      const now = nowSeconds();
      // Set cliffTime to *right now* — the validator block time will be >= now,
      // meaning current_time <= cliff_time holds at this instant.
      const stream = await createStream({
        startTime: new anchor.BN(now - 10),
        endTime: new anchor.BN(now + 100),
        cliffTime: new anchor.BN(now), // exactly now
        vestingType: { cliff: {} },
        nonce: new anchor.BN(411),
      });

      // Immediately after creation the block time is at or before cliffTime
      await expectError(
        () => withdraw(stream),
        "InsufficientUnlockedTokens"
      );
    });

    // ── Edge case 3: Cancel at exactly end_time ──
    // A stream whose endTime is in the past (fully vested) cannot be cancelled.
    // The contract checks `unlocked >= total_amount → StreamFullyVested`.
    // Setting endTime = nowSeconds() - 1 guarantees the stream has ended.
    it("cancel at exactly end_time (fully vested stream) returns StreamFullyVested", async () => {
      const now = nowSeconds();
      // Stream already ended: endTime is 1 second ago
      const stream = await createStream({
        startTime: new anchor.BN(now - 100),
        endTime: new anchor.BN(now - 1),
        nonce: new anchor.BN(412),
      });

      await expectError(
        () =>
          program.methods
            .cancelStream()
            .accountsPartial({
              vestingState: stream.vestingStatePda,
              authorityRevoker: wallet.payer.publicKey,
              treasuryReturnAddress: funderTokenAccount,
              vestingTokenAccount: stream.vestingTokenAccount,
              tokenProgram: TOKEN_PROGRAM_ID,
            })
            .rpc(),
        "StreamFullyVested"
      );
    });

    // ── Edge case 4: Double withdraw with nothing remaining ──
    // After draining a fully-vested stream, a second withdraw must fail.
    // This verifies the `claimable = unlocked - claimed` underflow protection.
    it("double withdraw: second call returns InsufficientUnlockedTokens when stream is fully drained", async () => {
      const totalAmount = new anchor.BN(1_000_000);
      const now = nowSeconds();
      // Stream already ended → fully vested immediately
      const stream = await createStream({
        totalAmount,
        startTime: new anchor.BN(now - 50),
        endTime: new anchor.BN(now - 1),
        nonce: new anchor.BN(413),
      });

      // First withdrawal drains all tokens
      await withdraw(stream);

      const stateAfterFirst = await program.account.vestingState.fetch(
        stream.vestingStatePda
      );
      assert.equal(
        stateAfterFirst.claimedAmount.toString(),
        totalAmount.toString(),
        "Stream should be fully claimed after first withdraw"
      );

      // Second withdrawal — nothing left — must fail
      await expectError(
        () => withdraw(stream),
        "InsufficientUnlockedTokens"
      );
    });

    // ── Edge case 5: Withdraw with nothing available (future stream) ──
    // A stream that hasn't started yet has zero unlocked tokens.
    // Any withdrawal attempt must be rejected immediately.
    it("withdraw with nothing available (stream starts in the future) returns InsufficientUnlockedTokens", async () => {
      const now = nowSeconds();
      const stream = await createStream({
        startTime: new anchor.BN(now + 60),
        endTime: new anchor.BN(now + 120),
        nonce: new anchor.BN(414),
      });

      await expectError(
        () => withdraw(stream),
        "InsufficientUnlockedTokens"
      );
    });

    // ── Edge case 6: Withdraw from revoked stream with zero vested amount ──
    // If a cliff stream is cancelled before its cliff_time, vested_amount_at_revocation = 0.
    // The recipient then has nothing to withdraw, so any withdraw attempt must fail.
    it("withdraw from revoked stream with zero vested returns InsufficientUnlockedTokens", async () => {
      const now = nowSeconds();
      // Cliff stream: cliff is 60s away, so nothing is vested yet
      const stream = await createStream({
        totalAmount: new anchor.BN(1_000_000),
        startTime: new anchor.BN(now),
        endTime: new anchor.BN(now + 120),
        cliffTime: new anchor.BN(now + 60),
        vestingType: { cliff: {} },
        nonce: new anchor.BN(415),
      });

      // Cancel before cliff — vested_amount_at_revocation should be 0
      await program.methods
        .cancelStream()
        .accountsPartial({
          vestingState: stream.vestingStatePda,
          authorityRevoker: wallet.payer.publicKey,
          treasuryReturnAddress: funderTokenAccount,
          vestingTokenAccount: stream.vestingTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      const cancelledState = await program.account.vestingState.fetch(
        stream.vestingStatePda
      );
      assert.isTrue(cancelledState.isRevoked);
      assert.equal(
        cancelledState.vestedAmountAtRevocation.toString(),
        "0",
        "No tokens should be vested before the cliff"
      );

      // Recipient has nothing to withdraw
      await expectError(
        () => withdraw(stream),
        "InsufficientUnlockedTokens"
      );
    });

    // ── Edge case 7: Stream with start_time == end_time is rejected ──
    // Zero-duration streams are meaningless and must be rejected.
    it("stream with start_time == end_time is rejected with InvalidTimeRange", async () => {
      const now = nowSeconds();
      await expectError(
        () =>
          createStream({
            startTime: new anchor.BN(now + 10),
            endTime: new anchor.BN(now + 10), // equal → invalid
            nonce: new anchor.BN(416),
          }),
        "InvalidTimeRange"
      );
    });

    // ── Edge case 8: Milestone stream with milestone_count == 0 is rejected ──
    // A milestone stream must have at least one milestone.
    it("milestone stream with milestone_count == 0 is rejected with MilestoneCountZero", async () => {
      await expectError(
        () =>
          createStream({
            vestingType: { milestone: {} },
            milestoneCount: 0,
            nonce: new anchor.BN(417),
          }),
        "MilestoneCountZero"
      );
    });
  });
});
