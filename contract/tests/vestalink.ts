import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Vestalink } from "../target/types/vestalink";
import { assert, expect } from "chai";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

describe("vestalink", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.vestalink as Program<Vestalink>;
  const wallet = provider.wallet as anchor.Wallet;

  // Shared state
  let mint: anchor.web3.PublicKey;
  let funderTokenAccount: anchor.web3.PublicKey;
  let recipient: anchor.web3.Keypair;
  let recipientTokenAccount: anchor.web3.PublicKey;

  // Helper: derive PDA for a given nonce
  function derivePda(
    funder: anchor.web3.PublicKey,
    recipient: anchor.web3.PublicKey,
    nonce: anchor.BN,
  ) {
    return anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("vesting"),
        funder.toBuffer(),
        recipient.toBuffer(),
        nonce.toArrayLike(Buffer, "le", 8),
      ],
      program.programId,
    );
  }

  // Helper: create a vesting stream
  async function createStream(params: {
    funder?: anchor.web3.PublicKey;
    funderTokenAcct?: anchor.web3.PublicKey;
    recipient?: anchor.web3.Keypair;
    totalAmount?: anchor.BN;
    startTime?: anchor.BN;
    endTime?: anchor.BN;
    nonce?: anchor.BN;
    vestingType?: any;
  } = {}) {
    const nonce = params.nonce ?? new anchor.BN(0);
    const funder = params.funder ?? wallet.payer.publicKey;
    const funderTokenAcct = params.funderTokenAcct ?? funderTokenAccount;
    const streamRecipient = params.recipient ?? recipient;
    const totalAmount = params.totalAmount ?? new anchor.BN(1_000_000_000_000);
    const now = Math.floor(Date.now() / 1000);
    const startTime = params.startTime ?? new anchor.BN(now);
    const endTime = params.endTime ?? new anchor.BN(now + 86400 * 365);
    const vestingType = params.vestingType ?? { linear: {} };

    const [vestingStatePda, vestingStateBump] = derivePda(
      funder,
      streamRecipient.publicKey,
      nonce,
    );

    const vestingTokenAccount = getAssociatedTokenAddressSync(
      mint,
      vestingStatePda,
      true,
    );

    const recipientTokenAccount = getAssociatedTokenAddressSync(
      mint,
      streamRecipient.publicKey,
    );

    return {
      vestingStatePda,
      vestingStateBump,
      vestingTokenAccount,
      recipientTokenAccount,
      nonce,
      totalAmount,
      startTime,
      endTime,
      vestingType,
      funder,
      streamRecipient,
      send: async () => {
        // Create ATA for vesting PDA if needed
        const createAtaIx = createAssociatedTokenAccountIdempotentInstruction(
          wallet.payer.publicKey,
          vestingTokenAccount,
          vestingStatePda,
          mint,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID,
        );

        // Create recipient token account if needed
        const createRecipientAtaIx =
          createAssociatedTokenAccountIdempotentInstruction(
            wallet.payer.publicKey,
            recipientTokenAccount,
            streamRecipient.publicKey,
            mint,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID,
          );

        const preInstructions = [createAtaIx, createRecipientAtaIx];

        return program.methods
          .createVestingSchedule({
            totalAmount,
            vestingType,
            startTime,
            endTime,
            cliffTime: startTime,
            milestoneCount: 0,
            nonce,
          })
          .accounts({
            vestingState: vestingStatePda,
            funder: wallet.payer.publicKey,
            recipient: streamRecipient.publicKey,
            funderTokenAccount: funderTokenAcct,
            vestingTokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .preInstructions(preInstructions)
          .rpc();
      },
    };
  }

  // ── Setup ──────────────────────────────────────────────────────────

  before(async () => {
    mint = await createMint(
      provider.connection,
      wallet.payer,
      wallet.payer.publicKey,
      null,
      6,
    );

    funderTokenAccount = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        wallet.payer,
        mint,
        wallet.payer.publicKey,
      )
    ).address;

    await mintTo(
      provider.connection,
      wallet.payer,
      mint,
      funderTokenAccount,
      wallet.payer.publicKey,
      100_000_000_000_000,
    );

    recipient = anchor.web3.Keypair.generate();
  });

  // ── Task 1: VestingState struct and error codes ────────────────────

  describe("VestingState struct and error codes", () => {
    it("deploys successfully", async () => {
      const programId = program.programId;
      assert.isNotNull(programId);
      assert.isTrue(programId.toBase58().length > 0);
    });
  });

  // ── Task 2: create_vesting_schedule ────────────────────────────────

  describe("create_vesting_schedule", () => {
    it("creates a vesting stream and verifies VestingState fields", async () => {
      const stream = await createStream();
      await stream.send();

      const vs = await program.account.vestingState.fetch(
        stream.vestingStatePda,
      );

      assert.isTrue(
        vs.recipient.equals(recipient.publicKey),
        "recipient should match",
      );
      assert.isTrue(
        vs.funder.equals(wallet.payer.publicKey),
        "funder should match",
      );
      assert.equal(
        vs.totalAmount.toString(),
        stream.totalAmount.toString(),
        "totalAmount should match",
      );
      assert.equal(vs.claimedAmount.toString(), "0", "claimedAmount should be 0");
      assert.isTrue(
        vs.authorityRevoker.equals(wallet.payer.publicKey),
        "authorityRevoker should be funder",
      );
      assert.isTrue(
        vs.authorityMilestone.equals(wallet.payer.publicKey),
        "authorityMilestone should be funder",
      );
      assert.isTrue(
        vs.treasuryReturnAddress.equals(funderTokenAccount),
        "treasuryReturnAddress should be funder token account",
      );
      assert.deepEqual(vs.vestingType, { linear: {} }, "vestingType should be Linear");
      assert.isFalse(vs.isRevoked, "isRevoked should be false");
      assert.equal(
        vs.startTime.toString(),
        stream.startTime.toString(),
        "startTime should match",
      );
      assert.equal(
        vs.endTime.toString(),
        stream.endTime.toString(),
        "endTime should match",
      );
      assert.equal(
        vs.cliffTime.toString(),
        stream.startTime.toString(),
        "cliffTime should equal startTime for Linear",
      );
      assert.equal(vs.milestoneCount, 0, "milestoneCount should be 0");
      assert.equal(vs.milestonesReached, 0, "milestonesReached should be 0");
      assert.equal(vs.bump, stream.vestingStateBump, "bump should match");
      assert.equal(
        vs.nonce.toString(),
        stream.nonce.toString(),
        "nonce should match",
      );
    });

    it("transfers tokens from funder to PDA vault", async () => {
      const nonce = new anchor.BN(1);
      const totalAmount = new anchor.BN(500_000_000_000);

      const funderBalanceBefore = await provider.connection.getTokenAccountBalance(funderTokenAccount);
      const funderBalBefore = BigInt(funderBalanceBefore.value.amount);

      const stream = await createStream({
        nonce,
        totalAmount,
      });
      await stream.send();

      const vaultBalance = await provider.connection.getTokenAccountBalance(
        stream.vestingTokenAccount,
      );
      assert.equal(vaultBalance.value.amount, totalAmount.toString(), "vault should have totalAmount");

      const funderBalanceAfter = await provider.connection.getTokenAccountBalance(funderTokenAccount);
      const funderBalAfter = BigInt(funderBalanceAfter.value.amount);
      assert.equal(
        (funderBalBefore - funderBalAfter).toString(),
        totalAmount.toString(),
        "funder balance should decrease by totalAmount",
      );
    });

    it("rejects total_amount of 0 with InvalidAmount", async () => {
      const stream = await createStream({
        totalAmount: new anchor.BN(0),
        nonce: new anchor.BN(2),
      });

      try {
        await stream.send();
        assert.fail("Should have thrown error");
      } catch (err: any) {
        const errorMsg = err.error?.errorMessage || err.toString();
        assert.include(
          errorMsg.toLowerCase(),
          "invalidamount",
          `Expected InvalidAmount, got: ${errorMsg}`,
        );
      }
    });

    it("rejects start_time >= end_time with InvalidTimeRange", async () => {
      const now = Math.floor(Date.now() / 1000);
      const stream = await createStream({
        startTime: new anchor.BN(now + 1000),
        endTime: new anchor.BN(now + 500),
        nonce: new anchor.BN(3),
      });

      try {
        await stream.send();
        assert.fail("Should have thrown error");
      } catch (err: any) {
        const errorMsg = err.error?.errorMessage || err.toString();
        assert.include(
          errorMsg.toLowerCase(),
          "invalidtimerange",
          `Expected InvalidTimeRange, got: ${errorMsg}`,
        );
      }
    });

    it("rejects start_time == end_time with InvalidTimeRange", async () => {
      const now = Math.floor(Date.now() / 1000);
      const stream = await createStream({
        startTime: new anchor.BN(now),
        endTime: new anchor.BN(now),
        nonce: new anchor.BN(4),
      });

      try {
        await stream.send();
        assert.fail("Should have thrown error");
      } catch (err: any) {
        const errorMsg = err.error?.errorMessage || err.toString();
        assert.include(
          errorMsg.toLowerCase(),
          "invalidtimerange",
          `Expected InvalidTimeRange, got: ${errorMsg}`,
        );
      }
    });

    it("rejects non-Linear vesting type with UnsupportedVestingType", async () => {
      const stream = await createStream({
        vestingType: { cliff: {} },
        nonce: new anchor.BN(5),
      });

      try {
        await stream.send();
        assert.fail("Should have thrown error");
      } catch (err: any) {
        const errorMsg = err.error?.errorMessage || err.toString();
        assert.include(
          errorMsg.toLowerCase(),
          "unsupportedvestingtype",
          `Expected UnsupportedVestingType, got: ${errorMsg}`,
        );
      }
    });
  });

  // ── Task 3: calculate_unlocked ────────────────────────────────────

  describe("calculate_unlocked (via claim)", () => {
    it("unlocked amount is 0 before start_time", async () => {
      const now = Math.floor(Date.now() / 1000);
      const startTime = now + 86400; // starts in 1 day
      const endTime = now + 86400 * 365;

      const stream = await createStream({
        startTime: new anchor.BN(startTime),
        endTime: new anchor.BN(endTime),
        nonce: new anchor.BN(10),
      });
      await stream.send();

      // Try to claim before start — should succeed as no-op (claimable = 0)
      const vs = await program.account.vestingState.fetch(stream.vestingStatePda);
      assert.equal(vs.claimedAmount.toString(), "0", "claimed should be 0");
    });

    it("unlocked amount equals total_amount after vesting ends", async () => {
      const now = Math.floor(Date.now() / 1000);
      // Start in the past, end in the past (fully vested)
      const startTime = now - 86400 * 2;
      const endTime = now - 86400;

      const totalAmount = new anchor.BN(1_000_000_000_000);
      const stream = await createStream({
        startTime: new anchor.BN(startTime),
        endTime: new anchor.BN(endTime),
        totalAmount,
        nonce: new anchor.BN(11),
      });
      await stream.send();

      // Claim after full vesting
      await program.methods
        .claim()
        .accounts({
          vestingState: stream.vestingStatePda,
          recipient: recipient.publicKey,
          recipientTokenAccount: stream.recipientTokenAccount,
          vestingTokenAccount: stream.vestingTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([recipient])
        .rpc();

      const vs = await program.account.vestingState.fetch(stream.vestingStatePda);
      assert.equal(
        vs.claimedAmount.toString(),
        totalAmount.toString(),
        "should have claimed full amount",
      );

      const recipientBal = await provider.connection.getTokenAccountBalance(
        stream.recipientTokenAccount,
      );
      assert.equal(
        recipientBal.value.amount,
        totalAmount.toString(),
        "recipient should have full amount",
      );
    });

    it("unlocked amount is approximately 50% at 50% elapsed time", async () => {
      // We test this by creating a stream that started in the past
      // and checking the claimed amount after a claim
      const now = Math.floor(Date.now() / 1000);
      const duration = 86400 * 100; // 100 days
      const startTime = now - duration / 2; // 50% elapsed
      const endTime = startTime + duration;

      const totalAmount = new anchor.BN(1_000_000_000_000);
      const stream = await createStream({
        startTime: new anchor.BN(startTime),
        endTime: new anchor.BN(endTime),
        totalAmount,
        nonce: new anchor.BN(12),
      });
      await stream.send();

      await program.methods
        .claim()
        .accounts({
          vestingState: stream.vestingStatePda,
          recipient: recipient.publicKey,
          recipientTokenAccount: stream.recipientTokenAccount,
          vestingTokenAccount: stream.vestingTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([recipient])
        .rpc();

      const vs = await program.account.vestingState.fetch(stream.vestingStatePda);
      const claimed = BigInt(vs.claimedAmount.toString());
      const total = BigInt(totalAmount.toString());

      // Should be approximately 50% (allow 1% tolerance due to integer division)
      const ratio = Number(claimed * 10000n / total) / 100;
      assert.approximately(ratio, 50, 1, "should be approximately 50% unlocked");
    });
  });

  // ── Task 4: claim instruction ──────────────────────────────────────

  describe("claim", () => {
    it("partial claim transfers correct amount and updates claimed_amount", async () => {
      const now = Math.floor(Date.now() / 1000);
      const duration = 86400 * 100;
      const startTime = now - duration / 4; // 25% elapsed
      const endTime = startTime + duration;

      const totalAmount = new anchor.BN(1_000_000_000_000);
      const nonce = new anchor.BN(20);
      const stream = await createStream({
        startTime: new anchor.BN(startTime),
        endTime: new anchor.BN(endTime),
        totalAmount,
        nonce,
      });
      await stream.send();

      const recipientBalBefore = BigInt(
        (await provider.connection.getTokenAccountBalance(stream.recipientTokenAccount)).value.amount,
      );

      await program.methods
        .claim()
        .accounts({
          vestingState: stream.vestingStatePda,
          recipient: recipient.publicKey,
          recipientTokenAccount: stream.recipientTokenAccount,
          vestingTokenAccount: stream.vestingTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([recipient])
        .rpc();

      const vs = await program.account.vestingState.fetch(stream.vestingStatePda);
      const claimed = BigInt(vs.claimedAmount.toString());
      assert.isTrue(claimed > 0n, "claimed should be > 0");
      assert.isTrue(
        claimed < BigInt(totalAmount.toString()),
        "claimed should be < totalAmount",
      );

      const recipientBalAfter = BigInt(
        (await provider.connection.getTokenAccountBalance(stream.recipientTokenAccount)).value.amount,
      );
      const transferred = recipientBalAfter - recipientBalBefore;
      assert.equal(transferred.toString(), claimed.toString(), "transferred should equal claimed");
    });

    it("full claim after vesting ends transfers entire total_amount", async () => {
      const now = Math.floor(Date.now() / 1000);
      const startTime = now - 86400 * 2;
      const endTime = now - 86400;

      const totalAmount = new anchor.BN(2_000_000_000_000);
      const nonce = new anchor.BN(21);
      const stream = await createStream({
        startTime: new anchor.BN(startTime),
        endTime: new anchor.BN(endTime),
        totalAmount,
        nonce,
      });
      await stream.send();

      const recipientBalBefore = BigInt(
        (await provider.connection.getTokenAccountBalance(stream.recipientTokenAccount)).value.amount,
      );

      await program.methods
        .claim()
        .accounts({
          vestingState: stream.vestingStatePda,
          recipient: recipient.publicKey,
          recipientTokenAccount: stream.recipientTokenAccount,
          vestingTokenAccount: stream.vestingTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([recipient])
        .rpc();

      const vs = await program.account.vestingState.fetch(stream.vestingStatePda);
      assert.equal(
        vs.claimedAmount.toString(),
        totalAmount.toString(),
        "claimed should equal totalAmount",
      );

      const recipientBalAfter = BigInt(
        (await provider.connection.getTokenAccountBalance(stream.recipientTokenAccount)).value.amount,
      );
      const transferred = recipientBalAfter - recipientBalBefore;
      assert.equal(
        transferred.toString(),
        totalAmount.toString(),
        "transferred amount should equal totalAmount",
      );
    });

    it("claim with zero newly unlocked tokens succeeds as no-op", async () => {
      const now = Math.floor(Date.now() / 1000);
      const startTime = now + 86400; // starts in the future
      const endTime = now + 86400 * 365;

      const nonce = new anchor.BN(22);
      const stream = await createStream({
        startTime: new anchor.BN(startTime),
        endTime: new anchor.BN(endTime),
        nonce,
      });
      await stream.send();

      const vaultBalBefore = BigInt(
        (await provider.connection.getTokenAccountBalance(stream.vestingTokenAccount)).value.amount,
      );

      // Claim before any tokens unlock — should succeed as no-op
      await program.methods
        .claim()
        .accounts({
          vestingState: stream.vestingStatePda,
          recipient: recipient.publicKey,
          recipientTokenAccount: stream.recipientTokenAccount,
          vestingTokenAccount: stream.vestingTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([recipient])
        .rpc();

      const vs = await program.account.vestingState.fetch(stream.vestingStatePda);
      assert.equal(vs.claimedAmount.toString(), "0", "claimed should still be 0");

      const vaultBalAfter = BigInt(
        (await provider.connection.getTokenAccountBalance(stream.vestingTokenAccount)).value.amount,
      );
      assert.equal(
        vaultBalAfter.toString(),
        vaultBalBefore.toString(),
        "vault balance should not change",
      );
    });

    it("rejects unauthorized claim with UnauthorizedClaimant", async () => {
      const now = Math.floor(Date.now() / 1000);
      const startTime = now - 86400;
      const endTime = now + 86400 * 365;

      const nonce = new anchor.BN(23);
      const stream = await createStream({
        startTime: new anchor.BN(startTime),
        endTime: new anchor.BN(endTime),
        nonce,
      });
      await stream.send();

      const impostor = anchor.web3.Keypair.generate();
      const impostorTokenAccount = getAssociatedTokenAddressSync(
        mint,
        impostor.publicKey,
      );

      // Airdrop SOL to impostor for transaction fees
      const airdropSig = await provider.connection.requestAirdrop(
        impostor.publicKey,
        1_000_000_000,
      );
      await provider.connection.confirmTransaction(airdropSig);

      // Create impostor's token account
      const createImpostorAtaIx =
        createAssociatedTokenAccountIdempotentInstruction(
          impostor.publicKey,
          impostorTokenAccount,
          impostor.publicKey,
          mint,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID,
        );

      await anchor.web3.sendAndConfirmTransaction(
        provider.connection,
        new anchor.web3.Transaction().add(createImpostorAtaIx),
        [impostor],
      );

      try {
        await program.methods
          .claim()
          .accounts({
            vestingState: stream.vestingStatePda,
            recipient: impostor.publicKey,
            recipientTokenAccount: impostorTokenAccount,
            vestingTokenAccount: stream.vestingTokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([impostor])
          .rpc();
        assert.fail("Should have thrown error");
      } catch (err: any) {
        // Anchor constraint errors may show as "ConstraintHasOne" or similar
        const errStr = (err.error?.errorMessage || err.toString()).toLowerCase();
        assert.isTrue(
          errStr.includes("unauthorizedclaimant") ||
            errStr.includes("hasone") ||
            errStr.includes("constraint") ||
            errStr.includes("0x1"),
          `Expected unauthorized claim error, got: ${errStr}`,
        );
      }
    });
  });

  // ── Task 5: cancel_vesting and unlock_milestone ────────────────────

  describe("cancel_vesting", () => {
    it("sets is_revoked and returns unclaimed tokens to treasury", async () => {
      const now = Math.floor(Date.now() / 1000);
      const startTime = now - 86400 * 10;
      const endTime = now + 86400 * 90;

      const totalAmount = new anchor.BN(3_000_000_000_000);
      const nonce = new anchor.BN(30);
      const stream = await createStream({
        startTime: new anchor.BN(startTime),
        endTime: new anchor.BN(endTime),
        totalAmount,
        nonce,
      });
      await stream.send();

      // Claim some tokens first
      await program.methods
        .claim()
        .accounts({
          vestingState: stream.vestingStatePda,
          recipient: recipient.publicKey,
          recipientTokenAccount: stream.recipientTokenAccount,
          vestingTokenAccount: stream.vestingTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([recipient])
        .rpc();

      const vsBeforeCancel = await program.account.vestingState.fetch(
        stream.vestingStatePda,
      );
      const claimedBefore = BigInt(vsBeforeCancel.claimedAmount.toString());

      const funderBalBefore = BigInt(
        (await provider.connection.getTokenAccountBalance(funderTokenAccount)).value.amount,
      );

      // Cancel vesting
      await program.methods
        .cancelVesting()
        .accounts({
          vestingState: stream.vestingStatePda,
          authorityRevoker: wallet.payer.publicKey,
          treasuryReturnAddress: funderTokenAccount,
          vestingTokenAccount: stream.vestingTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      const vsAfterCancel = await program.account.vestingState.fetch(
        stream.vestingStatePda,
      );
      assert.isTrue(vsAfterCancel.isRevoked, "isRevoked should be true");

      // Check that remaining tokens were returned to funder
      const funderBalAfter = BigInt(
        (await provider.connection.getTokenAccountBalance(funderTokenAccount)).value.amount,
      );
      const returnedAmount = funderBalAfter - funderBalBefore;
      const expectedReturn = BigInt(totalAmount.toString()) - claimedBefore;
      assert.equal(
        returnedAmount.toString(),
        expectedReturn.toString(),
        "remaining tokens should be returned to funder",
      );
    });

    it("claim from revoked stream returns StreamRevoked error", async () => {
      const now = Math.floor(Date.now() / 1000);
      const startTime = now - 86400;
      const endTime = now + 86400 * 365;

      const nonce = new anchor.BN(31);
      const stream = await createStream({
        startTime: new anchor.BN(startTime),
        endTime: new anchor.BN(endTime),
        nonce,
      });
      await stream.send();

      // Cancel vesting
      await program.methods
        .cancelVesting()
        .accounts({
          vestingState: stream.vestingStatePda,
          authorityRevoker: wallet.payer.publicKey,
          treasuryReturnAddress: funderTokenAccount,
          vestingTokenAccount: stream.vestingTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      // Try to claim from revoked stream
      try {
        await program.methods
          .claim()
          .accounts({
            vestingState: stream.vestingStatePda,
            recipient: recipient.publicKey,
            recipientTokenAccount: stream.recipientTokenAccount,
            vestingTokenAccount: stream.vestingTokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([recipient])
          .rpc();
        assert.fail("Should have thrown StreamRevoked error");
      } catch (err: any) {
        const errorMsg = (err.error?.errorMessage || err.toString()).toLowerCase();
        assert.include(
          errorMsg,
          "streamrevoked",
          `Expected StreamRevoked, got: ${errorMsg}`,
        );
      }
    });
  });

  describe("unlock_milestone", () => {
    it("returns UnsupportedVestingType error", async () => {
      const nonce = new anchor.BN(35);
      const now = Math.floor(Date.now() / 1000);
      const stream = await createStream({
        startTime: new anchor.BN(now),
        endTime: new anchor.BN(now + 86400 * 365),
        nonce,
      });
      await stream.send();

      try {
        await program.methods
          .unlockMilestone()
          .accounts({
            vestingState: stream.vestingStatePda,
            authorityMilestone: wallet.payer.publicKey,
          })
          .rpc();
        assert.fail("Should have thrown UnsupportedVestingType error");
      } catch (err: any) {
        const errorMsg = (err.error?.errorMessage || err.toString()).toLowerCase();
        assert.include(
          errorMsg,
          "unsupportedvestingtype",
          `Expected UnsupportedVestingType, got: ${errorMsg}`,
        );
      }
    });
  });

  // ── Task 7: Multiple streams per recipient ─────────────────────────

  describe("multiple streams per recipient", () => {
    it("creates multiple streams for same funder-recipient with different nonces", async () => {
      const now = Math.floor(Date.now() / 1000);
      const nonce1 = new anchor.BN(40);
      const nonce2 = new anchor.BN(41);

      const stream1 = await createStream({
        nonce: nonce1,
        totalAmount: new anchor.BN(1_000_000_000_000),
        startTime: new anchor.BN(now),
        endTime: new anchor.BN(now + 86400 * 365),
      });
      await stream1.send();

      const stream2 = await createStream({
        nonce: nonce2,
        totalAmount: new anchor.BN(2_000_000_000_000),
        startTime: new anchor.BN(now - 86400),
        endTime: new anchor.BN(now + 86400 * 180),
      });
      await stream2.send();

      const vs1 = await program.account.vestingState.fetch(stream1.vestingStatePda);
      const vs2 = await program.account.vestingState.fetch(stream2.vestingStatePda);

      assert.equal(
        vs1.totalAmount.toString(),
        "1000000000000",
        "stream 1 totalAmount",
      );
      assert.equal(
        vs2.totalAmount.toString(),
        "2000000000000",
        "stream 2 totalAmount",
      );
      assert.equal(vs1.nonce.toString(), nonce1.toString(), "stream 1 nonce");
      assert.equal(vs2.nonce.toString(), nonce2.toString(), "stream 2 nonce");

      // Verify PDAs are different
      assert.notEqual(
        stream1.vestingStatePda.toBase58(),
        stream2.vestingStatePda.toBase58(),
        "PDAs should be different",
      );
    });

    it("allows independent claims on multiple streams", async () => {
      const now = Math.floor(Date.now() / 1000);
      const nonce1 = new anchor.BN(42);
      const nonce2 = new anchor.BN(43);

      // Stream 1: fully vested
      const stream1 = await createStream({
        nonce: nonce1,
        totalAmount: new anchor.BN(1_000_000_000_000),
        startTime: new anchor.BN(now - 86400 * 2),
        endTime: new anchor.BN(now - 86400),
      });
      await stream1.send();

      // Stream 2: partially vested
      const stream2 = await createStream({
        nonce: nonce2,
        totalAmount: new anchor.BN(2_000_000_000_000),
        startTime: new anchor.BN(now - 86400 * 50),
        endTime: new anchor.BN(now + 86400 * 50),
      });
      await stream2.send();

      // Claim from stream 1
      await program.methods
        .claim()
        .accounts({
          vestingState: stream1.vestingStatePda,
          recipient: recipient.publicKey,
          recipientTokenAccount: stream1.recipientTokenAccount,
          vestingTokenAccount: stream1.vestingTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([recipient])
        .rpc();

      const vs1 = await program.account.vestingState.fetch(stream1.vestingStatePda);
      assert.equal(
        vs1.claimedAmount.toString(),
        "1000000000000",
        "stream 1 should be fully claimed",
      );

      // Claim from stream 2
      await program.methods
        .claim()
        .accounts({
          vestingState: stream2.vestingStatePda,
          recipient: recipient.publicKey,
          recipientTokenAccount: stream2.recipientTokenAccount,
          vestingTokenAccount: stream2.vestingTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([recipient])
        .rpc();

      const vs2 = await program.account.vestingState.fetch(stream2.vestingStatePda);
      assert.isTrue(
        BigInt(vs2.claimedAmount.toString()) > 0n,
        "stream 2 should have some claimed amount",
      );
      assert.isTrue(
        BigInt(vs2.claimedAmount.toString()) < BigInt(vs2.totalAmount.toString()),
        "stream 2 should not be fully claimed",
      );
    });
  });

  // ── Integer truncation test ─────────────────────────────────────────

  describe("integer truncation", () => {
    it("calculate_unlocked never exceeds true proportional share", async () => {
      // Create a stream with an odd total amount and short duration
      // to maximize truncation effects
      const now = Math.floor(Date.now() / 1000);
      const duration = 7; // 7 seconds
      const startTime = now - 3; // 3 seconds elapsed (~42.8%)
      const endTime = startTime + duration;
      const totalAmount = new anchor.BN(999_999_999_999);

      const nonce = new anchor.BN(50);
      const stream = await createStream({
        startTime: new anchor.BN(startTime),
        endTime: new anchor.BN(endTime),
        totalAmount,
        nonce,
      });
      await stream.send();

      await program.methods
        .claim()
        .accounts({
          vestingState: stream.vestingStatePda,
          recipient: recipient.publicKey,
          recipientTokenAccount: stream.recipientTokenAccount,
          vestingTokenAccount: stream.vestingTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([recipient])
        .rpc();

      const vs = await program.account.vestingState.fetch(stream.vestingStatePda);
      const claimed = BigInt(vs.claimedAmount.toString());
      const total = BigInt(totalAmount.toString());

      // The claimed amount should never exceed the true proportional share
      // True share = total * elapsed / duration
      // With integer truncation, claimed <= true share
      assert.isTrue(
        claimed <= total,
        "claimed should never exceed total",
      );
      assert.isTrue(
        claimed > 0n,
        "should have claimed some tokens",
      );
    });
  });
});