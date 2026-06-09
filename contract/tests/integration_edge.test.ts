import * as anchor from "@coral-xyz/anchor";
import { assert } from "chai";
import { getAccount, getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { expectError, getTokenBalance, nowSeconds, sleep } from "./utils";
import { VestalinkFixture } from "./fixture";

describe("integration and edge cases", () => {
  const fixture = new VestalinkFixture();

  before(async () => {
    await fixture.setup();
  });

  describe("request_vesta", () => {
    it("mints test VESTA from the faucet PDA authority", async () => {
      const requesterTokenAccount = getAssociatedTokenAddressSync(
        fixture.faucetMint,
        fixture.wallet.payer.publicKey
      );
      const [faucetAuthority] = fixture.deriveFaucetPda();

      await fixture.program.methods
        .requestVesta()
        .accountsPartial({
          requester: fixture.wallet.payer.publicKey,
          vestaMint: fixture.faucetMint,
          requesterTokenAccount,
          faucetAuthority,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .preInstructions([
          createAssociatedTokenAccountIdempotentInstruction(
            fixture.wallet.payer.publicKey,
            requesterTokenAccount,
            fixture.wallet.payer.publicKey,
            fixture.faucetMint,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
          ),
        ])
        .rpc();

      const account = await getAccount(
        fixture.provider.connection,
        requesterTokenAccount
      );
      assert.equal(account.amount.toString(), "10000000000");
    });
  });

  describe("integration — full flow", () => {
    it("full flow: create → partial withdraw → verify balance delta → wait → full withdraw → verify total", async () => {
      const totalAmount = new anchor.BN(1_000_000);
      const now = nowSeconds();
      const stream = await fixture.createStream({
        totalAmount,
        startTime: new anchor.BN(now - 5),
        endTime: new anchor.BN(now + 15),
        nonce: new anchor.BN(400),
      });

      const recipientBefore = await getTokenBalance(fixture.provider, stream.recipientTokenAccount);
      const vaultBefore = await getTokenBalance(fixture.provider, stream.vestingTokenAccount);

      await fixture.withdraw(stream);

      const stateAfterFirst = await fixture.program.account.vestingState.fetch(
        stream.vestingStatePda
      );
      const firstClaimed = BigInt(stateAfterFirst.claimedAmount.toString());
      assert.isAbove(Number(firstClaimed), 0, "First claim must be > 0");
      assert.isBelow(
        Number(firstClaimed),
        totalAmount.toNumber(),
        "First claim must be < totalAmount (stream not ended)"
      );

      const recipientAfterFirst = await getTokenBalance(fixture.provider, stream.recipientTokenAccount);
      const vaultAfterFirst = await getTokenBalance(fixture.provider, stream.vestingTokenAccount);

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

      await sleep(17_000); 

      await fixture.withdraw(stream);

      const stateFinal = await fixture.program.account.vestingState.fetch(
        stream.vestingStatePda
      );
      assert.equal(
        stateFinal.claimedAmount.toString(),
        totalAmount.toString(),
        "After stream ends, total claimedAmount must equal totalAmount"
      );

      const recipientFinal = await getTokenBalance(fixture.provider, stream.recipientTokenAccount);
      const vaultFinal = await getTokenBalance(fixture.provider, stream.vestingTokenAccount);

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
      const stream = await fixture.createStream({
        totalAmount,
        startTime: new anchor.BN(now - 5),
        endTime: new anchor.BN(now + 25),
        cliffTime: new anchor.BN(now + 3),
        vestingType: { cliff: {} },
        nonce: new anchor.BN(401),
      });

      await expectError(
        () => fixture.withdraw(stream),
        "InsufficientUnlockedTokens"
      );

      await sleep(5_000);

      const recipientBefore = await getTokenBalance(fixture.provider, stream.recipientTokenAccount);

      await fixture.withdraw(stream);

      const state = await fixture.program.account.vestingState.fetch(
        stream.vestingStatePda
      );
      const claimed = BigInt(state.claimedAmount.toString());
      assert.isAbove(Number(claimed), 0, "Should have claimed some tokens after cliff");

      const recipientAfter = await getTokenBalance(fixture.provider, stream.recipientTokenAccount);
      assert.equal(
        (recipientAfter - recipientBefore).toString(),
        claimed.toString(),
        "Recipient balance delta must equal claimedAmount"
      );
    });

    it("full flow: milestone stream → unlock all → withdraw → verify full balance", async () => {
      const totalAmount = new anchor.BN(600_000);
      const stream = await fixture.createStream({
        totalAmount,
        vestingType: { milestone: {} },
        milestoneCount: 3,
        nonce: new anchor.BN(402),
      });

      const recipientBefore = await getTokenBalance(fixture.provider, stream.recipientTokenAccount);

      for (let i = 0; i < 3; i++) {
        await fixture.unlockMilestone(stream);
        await fixture.withdraw(stream);
      }

      const stateFinal = await fixture.program.account.vestingState.fetch(
        stream.vestingStatePda
      );
      assert.equal(
        stateFinal.claimedAmount.toString(),
        totalAmount.toString(),
        "claimedAmount must equal totalAmount after all milestones"
      );

      const recipientFinal = await getTokenBalance(fixture.provider, stream.recipientTokenAccount);
      assert.equal(
        (recipientFinal - recipientBefore).toString(),
        totalAmount.toString(),
        "Recipient net gain must equal totalAmount"
      );
    });
  });

  describe("edge cases", () => {
    it("zero amount stream is rejected with InvalidAmount", async () => {
      await expectError(
        () =>
          fixture.createStream({
            totalAmount: new anchor.BN(0),
            nonce: new anchor.BN(410),
          }),
        "InvalidAmount"
      );
    });

    it("withdraw at exactly cliff_time returns InsufficientUnlockedTokens", async () => {
      const now = nowSeconds();
      const stream = await fixture.createStream({
        startTime: new anchor.BN(now - 10),
        endTime: new anchor.BN(now + 100),
        cliffTime: new anchor.BN(now), 
        vestingType: { cliff: {} },
        nonce: new anchor.BN(411),
      });

      await expectError(
        () => fixture.withdraw(stream),
        "InsufficientUnlockedTokens"
      );
    });

    it("cancel at exactly end_time (fully vested stream) returns StreamFullyVested", async () => {
      const now = nowSeconds();
      const stream = await fixture.createStream({
        startTime: new anchor.BN(now - 100),
        endTime: new anchor.BN(now - 1),
        nonce: new anchor.BN(412),
      });

      await expectError(
        () => fixture.cancelStream(stream),
        "StreamFullyVested"
      );
    });

    it("double withdraw: second call returns InsufficientUnlockedTokens when stream is fully drained", async () => {
      const totalAmount = new anchor.BN(1_000_000);
      const now = nowSeconds();
      const stream = await fixture.createStream({
        totalAmount,
        startTime: new anchor.BN(now - 50),
        endTime: new anchor.BN(now - 1),
        nonce: new anchor.BN(413),
      });

      await fixture.withdraw(stream);

      const stateAfterFirst = await fixture.program.account.vestingState.fetch(
        stream.vestingStatePda
      );
      assert.equal(
        stateAfterFirst.claimedAmount.toString(),
        totalAmount.toString(),
        "Stream should be fully claimed after first withdraw"
      );

      await expectError(
        () => fixture.withdraw(stream),
        "InsufficientUnlockedTokens"
      );
    });

    it("withdraw with nothing available (stream starts in the future) returns InsufficientUnlockedTokens", async () => {
      const now = nowSeconds();
      const stream = await fixture.createStream({
        startTime: new anchor.BN(now + 60),
        endTime: new anchor.BN(now + 120),
        nonce: new anchor.BN(414),
      });

      await expectError(
        () => fixture.withdraw(stream),
        "InsufficientUnlockedTokens"
      );
    });

    it("withdraw from revoked stream with zero vested returns InsufficientUnlockedTokens", async () => {
      const now = nowSeconds();
      const stream = await fixture.createStream({
        totalAmount: new anchor.BN(1_000_000),
        startTime: new anchor.BN(now),
        endTime: new anchor.BN(now + 120),
        cliffTime: new anchor.BN(now + 60),
        vestingType: { cliff: {} },
        nonce: new anchor.BN(415),
      });

      await fixture.cancelStream(stream);

      const cancelledState = await fixture.program.account.vestingState.fetch(
        stream.vestingStatePda
      );
      assert.isTrue(cancelledState.isRevoked);
      assert.equal(
        cancelledState.vestedAmountAtRevocation.toString(),
        "0",
        "No tokens should be vested before the cliff"
      );

      await expectError(
        () => fixture.withdraw(stream),
        "InsufficientUnlockedTokens"
      );
    });

    it("stream with start_time == end_time is rejected with InvalidTimeRange", async () => {
      const now = nowSeconds();
      await expectError(
        () =>
          fixture.createStream({
            startTime: new anchor.BN(now + 10),
            endTime: new anchor.BN(now + 10), 
            nonce: new anchor.BN(416),
          }),
        "InvalidTimeRange"
      );
    });

    it("milestone stream with milestone_count == 0 is rejected with MilestoneCountZero", async () => {
      await expectError(
        () =>
          fixture.createStream({
            vestingType: { milestone: {} },
            milestoneCount: 0,
            nonce: new anchor.BN(417),
          }),
        "MilestoneCountZero"
      );
    });
  });
});
