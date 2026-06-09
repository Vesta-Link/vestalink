import * as anchor from "@coral-xyz/anchor";
import { assert } from "chai";
import { expectError, getTokenBalance, nowSeconds } from "./utils";
import { VestalinkFixture } from "./fixture";

describe("property tests", () => {
  const fixture = new VestalinkFixture();

  before(async () => {
    await fixture.setup();
  });

  describe("cliff vesting — property tests", () => {
    it("Property 1: withdrawal before cliff_time always fails with InsufficientUnlockedTokens", async () => {
      const totalAmount = new anchor.BN(1_000_000);
      const cliffOffsets = [30, 45, 60, 90, 120, 180, 300]; 

      for (let i = 0; i < cliffOffsets.length; i++) {
        const now = nowSeconds();
        const cliffOffset = cliffOffsets[i];
        const stream = await fixture.createStream({
          totalAmount,
          startTime: new anchor.BN(now),
          endTime: new anchor.BN(now + 600),
          cliffTime: new anchor.BN(now + cliffOffset),
          vestingType: { cliff: {} },
          nonce: new anchor.BN(100 + i),
        });

        await expectError(
          () => fixture.withdraw(stream),
          "InsufficientUnlockedTokens"
        );
      }
    });

    it("Property 2: after cliff_time, unlocked matches linear formula within ±5%", async () => {
      const totalAmount = new anchor.BN(1_000_000);
      const configs = [
        { startAgo: 60, cliffAgo: 30, endAhead: 60 },   
        { startAgo: 100, cliffAgo: 80, endAhead: 100 },  
        { startAgo: 40, cliffAgo: 20, endAhead: 160 },    
        { startAgo: 80, cliffAgo: 40, endAhead: 20 },     
        { startAgo: 50, cliffAgo: 50, endAhead: 50 },     
        { startAgo: 120, cliffAgo: 60, endAhead: 30 },    
        { startAgo: 30, cliffAgo: 10, endAhead: 270 },     
      ];

      for (let i = 0; i < configs.length; i++) {
        const { startAgo, cliffAgo, endAhead } = configs[i];
        const now = nowSeconds();
        const startTime = new anchor.BN(now - startAgo);
        const endTime = new anchor.BN(now + endAhead);
        const cliffTime = new anchor.BN(now - cliffAgo);

        const stream = await fixture.createStream({
          totalAmount,
          startTime,
          endTime,
          cliffTime,
          vestingType: { cliff: {} },
          nonce: new anchor.BN(110 + i),
        });

        await fixture.withdraw(stream);

        const state = await fixture.program.account.vestingState.fetch(
          stream.vestingStatePda
        );
        const claimed = Number(state.claimedAmount.toString());

        const duration = endTime.toNumber() - startTime.toNumber();
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
    it("Property 4: claimed amount equals totalAmount * milestonesReached / milestoneCount", async () => {
      const totalAmount = new anchor.BN(1_000_000);
      const milestoneCounts = [2, 3, 4, 5];

      let nonceCounter = 200;

      for (const milestoneCount of milestoneCounts) {
        const stream = await fixture.createStream({
          totalAmount,
          vestingType: { milestone: {} },
          milestoneCount,
          nonce: new anchor.BN(nonceCounter++),
        });

        let cumulativeClaimed = 0;

        for (let reached = 1; reached <= milestoneCount; reached++) {
          await fixture.unlockMilestone(stream);
          await fixture.withdraw(stream);

          const state = await fixture.program.account.vestingState.fetch(
            stream.vestingStatePda
          );
          const claimed = Number(state.claimedAmount.toString());

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

        assert.equal(
          cumulativeClaimed,
          totalAmount.toNumber(),
          `Milestone property 4: after all ${milestoneCount} milestones, claimed should equal totalAmount`
        );
      }
    });
  });

  describe("cancel_stream — property tests", () => {
    it("Property 5: cancel distributes vested to recipient and unvested to funder", async () => {
      const totalAmount = new anchor.BN(1_000_000);
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

        const stream = await fixture.createStream({
          totalAmount,
          startTime,
          endTime,
          nonce: new anchor.BN(nonceCounter++),
        });

        const funderBefore = await getTokenBalance(fixture.provider, fixture.funderTokenAccount);

        await fixture.cancelStream(stream);

        const cancelledState = await fixture.program.account.vestingState.fetch(
          stream.vestingStatePda
        );

        assert.isTrue(cancelledState.isRevoked, `${label}: stream should be revoked`);

        const vestedAtRevocation = BigInt(cancelledState.vestedAmountAtRevocation.toString());
        const expectedUnvested = BigInt(totalAmount.toString()) - vestedAtRevocation;

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

        const funderAfter = await getTokenBalance(fixture.provider, fixture.funderTokenAccount);
        const funderReceived = funderAfter - funderBefore;
        assert.equal(
          funderReceived.toString(),
          expectedUnvested.toString(),
          `${label}: funder should receive back totalAmount - vestedAmountAtRevocation`
        );

        await fixture.withdraw(stream);

        const finalState = await fixture.program.account.vestingState.fetch(
          stream.vestingStatePda
        );
        assert.equal(
          finalState.claimedAmount.toString(),
          vestedAtRevocation.toString(),
          `${label}: recipient should withdraw exactly vestedAmountAtRevocation`
        );

        await expectError(
          () => fixture.withdraw(stream),
          "InsufficientUnlockedTokens"
        );
      }
    });
  });
});
