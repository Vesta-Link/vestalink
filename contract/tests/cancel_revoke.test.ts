import * as anchor from "@coral-xyz/anchor";
import { assert } from "chai";
import { getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import { expectError, getTokenBalance, nowSeconds } from "./utils";
import { VestalinkFixture } from "./fixture";

describe("cancel and revoke", () => {
  const fixture = new VestalinkFixture();

  before(async () => {
    await fixture.setup();
  });

  describe("revoke_vesting", () => {
    it("sweeps only unvested tokens and allows post-revoke vested withdrawal", async () => {
      const totalAmount = new anchor.BN(1_000_000);
      const now = nowSeconds();
      const stream = await fixture.createStream({
        totalAmount,
        startTime: new anchor.BN(now - 25),
        endTime: new anchor.BN(now + 75),
        nonce: new anchor.BN(20),
      });

      const funderBefore = await getTokenBalance(fixture.provider, fixture.funderTokenAccount);

      await fixture.revokeVesting(stream);

      const revokedState = await fixture.program.account.vestingState.fetch(
        stream.vestingStatePda
      );
      const vested = BigInt(revokedState.vestedAmountAtRevocation.toString());
      const expectedReturn = BigInt(totalAmount.toString()) - vested;
      const funderAfter = await getTokenBalance(fixture.provider, fixture.funderTokenAccount);

      assert.isTrue(revokedState.isRevoked);
      assert.isAbove(Number(vested), 0);
      assert.isBelow(Number(vested), totalAmount.toNumber());
      assert.equal(
        (funderAfter - funderBefore).toString(),
        expectedReturn.toString()
      );

      await fixture.withdraw(stream);
      const finalState = await fixture.program.account.vestingState.fetch(
        stream.vestingStatePda
      );
      assert.equal(finalState.claimedAmount.toString(), vested.toString());
    });

    it("rejects repeated revocation", async () => {
      const now = nowSeconds();
      const stream = await fixture.createStream({
        startTime: new anchor.BN(now - 50),
        endTime: new anchor.BN(now + 50),
        nonce: new anchor.BN(22),
      });

      await fixture.revokeVesting(stream);

      await expectError(
        () =>
          fixture.revokeVesting(stream),
        "StreamRevoked"
      );
    });

    it("rejects an unexpected treasury return address", async () => {
      const now = nowSeconds();
      const stream = await fixture.createStream({
        startTime: new anchor.BN(now - 50),
        endTime: new anchor.BN(now + 50),
        nonce: new anchor.BN(23),
      });
      const wrongTreasury = (
        await getOrCreateAssociatedTokenAccount(
          fixture.provider.connection,
          fixture.wallet.payer,
          fixture.mint,
          anchor.web3.Keypair.generate().publicKey
        )
      ).address;

      await expectError(
        () =>
          fixture.revokeVesting(stream, { treasuryReturnAddress: wrongTreasury }),
        "InvalidTreasuryReturnAddress"
      );
    });
  });

  describe("cancel_stream", () => {
    it("cancels mid-stream: recipient keeps vested, funder gets unvested", async () => {
      const totalAmount = new anchor.BN(1_000_000);
      const now = nowSeconds();
      const stream = await fixture.createStream({
        totalAmount,
        startTime: new anchor.BN(now - 25),
        endTime: new anchor.BN(now + 75),
        nonce: new anchor.BN(60),
      });

      const funderBefore = await getTokenBalance(fixture.provider, fixture.funderTokenAccount);

      await fixture.cancelStream(stream);

      const cancelledState = await fixture.program.account.vestingState.fetch(
        stream.vestingStatePda
      );
      const vested = BigInt(cancelledState.vestedAmountAtRevocation.toString());
      const expectedReturn = BigInt(totalAmount.toString()) - vested;
      const funderAfter = await getTokenBalance(fixture.provider, fixture.funderTokenAccount);

      assert.isTrue(cancelledState.isRevoked);
      assert.isAbove(Number(vested), 0);
      assert.isBelow(Number(vested), totalAmount.toNumber());
      assert.equal(
        (funderAfter - funderBefore).toString(),
        expectedReturn.toString()
      );

      await fixture.withdraw(stream);
      const finalState = await fixture.program.account.vestingState.fetch(
        stream.vestingStatePda
      );
      assert.equal(finalState.claimedAmount.toString(), vested.toString());
    });

    it("cancels before cliff: funder gets nearly all tokens back", async () => {
      const totalAmount = new anchor.BN(1_000_000);
      const now = nowSeconds();
      const stream = await fixture.createStream({
        totalAmount,
        startTime: new anchor.BN(now),
        endTime: new anchor.BN(now + 120),
        cliffTime: new anchor.BN(now + 60),
        vestingType: { cliff: {} },
        nonce: new anchor.BN(61),
      });

      const funderBefore = await getTokenBalance(fixture.provider, fixture.funderTokenAccount);

      await fixture.cancelStream(stream);

      const state = await fixture.program.account.vestingState.fetch(
        stream.vestingStatePda
      );

      assert.isTrue(state.isRevoked);
      const vested = Number(state.vestedAmountAtRevocation.toString());
      assert.isAtMost(vested, 10_000);

      const funderAfter = await getTokenBalance(fixture.provider, fixture.funderTokenAccount);
      const returned = Number(funderAfter - funderBefore);
      assert.isAtLeast(returned, 990_000);
    });

    it("rejects cancel after full vest with StreamFullyVested", async () => {
      const now = nowSeconds();
      const stream = await fixture.createStream({
        startTime: new anchor.BN(now - 200),
        endTime: new anchor.BN(now - 100),
        nonce: new anchor.BN(62),
      });

      await expectError(
        () => fixture.cancelStream(stream),
        "StreamFullyVested"
      );
    });

    it("rejects cancel of already-cancelled stream with StreamCancelled", async () => {
      const now = nowSeconds();
      const stream = await fixture.createStream({
        startTime: new anchor.BN(now - 50),
        endTime: new anchor.BN(now + 50),
        nonce: new anchor.BN(63),
      });

      await fixture.cancelStream(stream);

      await expectError(
        () => fixture.cancelStream(stream),
        "StreamCancelled"
      );
    });

    it("rejects cancel by non-authority", async () => {
      const now = nowSeconds();
      const stream = await fixture.createStream({
        startTime: new anchor.BN(now - 50),
        endTime: new anchor.BN(now + 50),
        nonce: new anchor.BN(64),
      });

      const impostor = anchor.web3.Keypair.generate();
      const airdropSig = await fixture.provider.connection.requestAirdrop(
        impostor.publicKey,
        1_000_000_000
      );
      const latestBlockhash = await fixture.provider.connection.getLatestBlockhash();
      await fixture.provider.connection.confirmTransaction({
        signature: airdropSig,
        ...latestBlockhash,
      });

      await expectError(
        () =>
          fixture.cancelStream(stream, {
            authorityRevoker: impostor.publicKey,
            signer: impostor,
          }),
        "ConstraintHasOne"
      );
    });

    it("allows withdrawal from cancelled stream for vested amount", async () => {
      const totalAmount = new anchor.BN(1_000_000);
      const now = nowSeconds();
      const stream = await fixture.createStream({
        totalAmount,
        startTime: new anchor.BN(now - 50),
        endTime: new anchor.BN(now + 50),
        nonce: new anchor.BN(65),
      });

      await fixture.cancelStream(stream);

      const cancelledState = await fixture.program.account.vestingState.fetch(
        stream.vestingStatePda
      );
      assert.isTrue(cancelledState.isRevoked);
      const vestedAmount = BigInt(cancelledState.vestedAmountAtRevocation.toString());

      await fixture.withdraw(stream);

      const finalState = await fixture.program.account.vestingState.fetch(
        stream.vestingStatePda
      );
      assert.equal(finalState.claimedAmount.toString(), vestedAmount.toString());

      await expectError(
        () => fixture.withdraw(stream),
        "InsufficientUnlockedTokens"
      );
    });
  });
});
