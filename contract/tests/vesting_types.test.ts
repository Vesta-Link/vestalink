import * as anchor from "@coral-xyz/anchor";
import { assert } from "chai";
import { expectError, nowSeconds } from "./utils";
import { VestalinkFixture } from "./fixture";

describe("vesting types", () => {
  const fixture = new VestalinkFixture();

  before(async () => {
    await fixture.setup();
  });

  describe("unlock_milestone", () => {
    it("rejects unlock_milestone on a non-milestone stream with UnsupportedVestingType", async () => {
      const stream = await fixture.createStream({ nonce: new anchor.BN(30) });

      await expectError(
        () =>
          fixture.unlockMilestone(stream),
        "UnsupportedVestingType"
      );
    });
  });

  describe("milestone vesting", () => {
    it("creates a milestone stream and stores milestone_count", async () => {
      const totalAmount = new anchor.BN(1_000_000);
      const now = nowSeconds();
      const stream = await fixture.createStream({
        totalAmount,
        startTime: new anchor.BN(now),
        endTime: new anchor.BN(now + 365 * 24 * 60 * 60),
        vestingType: { milestone: {} },
        milestoneCount: 4,
        nonce: new anchor.BN(50),
      });

      const state = await fixture.program.account.vestingState.fetch(
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
          fixture.createStream({
            vestingType: { milestone: {} },
            milestoneCount: 0,
            nonce: new anchor.BN(51),
          }),
        "MilestoneCountZero"
      );
    });

    it("increments milestones_reached on unlock_milestone", async () => {
      const stream = await fixture.createStream({
        totalAmount: new anchor.BN(1_000_000),
        vestingType: { milestone: {} },
        milestoneCount: 4,
        nonce: new anchor.BN(52),
      });

      let state = await fixture.program.account.vestingState.fetch(
        stream.vestingStatePda
      );
      assert.equal(state.milestonesReached, 0);

      await fixture.unlockMilestone(stream);

      state = await fixture.program.account.vestingState.fetch(
        stream.vestingStatePda
      );
      assert.equal(state.milestonesReached, 1);

      await fixture.unlockMilestone(stream);

      state = await fixture.program.account.vestingState.fetch(
        stream.vestingStatePda
      );
      assert.equal(state.milestonesReached, 2);
    });

    it("withdraws correct proportional amount after milestone unlock", async () => {
      const totalAmount = new anchor.BN(1_000_000);
      const stream = await fixture.createStream({
        totalAmount,
        vestingType: { milestone: {} },
        milestoneCount: 4,
        nonce: new anchor.BN(53),
      });

      await fixture.unlockMilestone(stream);
      await fixture.withdraw(stream);

      const state = await fixture.program.account.vestingState.fetch(
        stream.vestingStatePda
      );
      const claimed = Number(state.claimedAmount.toString());
      assert.equal(claimed, 250_000);
    });

    it("withdraws full amount after all milestones reached", async () => {
      const totalAmount = new anchor.BN(900_000);
      const stream = await fixture.createStream({
        totalAmount,
        vestingType: { milestone: {} },
        milestoneCount: 3,
        nonce: new anchor.BN(54),
      });

      for (let i = 0; i < 3; i++) {
        await fixture.unlockMilestone(stream);
      }

      await fixture.withdraw(stream);

      const state = await fixture.program.account.vestingState.fetch(
        stream.vestingStatePda
      );
      assert.equal(state.claimedAmount.toString(), totalAmount.toString());
    });

    it("rejects extra unlock_milestone after all milestones reached", async () => {
      const stream = await fixture.createStream({
        vestingType: { milestone: {} },
        milestoneCount: 2,
        nonce: new anchor.BN(55),
      });

      await fixture.unlockMilestone(stream);
      await fixture.unlockMilestone(stream);

      await expectError(
        () =>
          fixture.unlockMilestone(stream),
        "AllMilestonesReached"
      );
    });

    it("rejects unlock_milestone on a non-milestone stream with UnsupportedVestingType", async () => {
      const now = nowSeconds();
      const stream = await fixture.createStream({
        vestingType: { cliff: {} },
        cliffTime: new anchor.BN(now + 60),
        nonce: new anchor.BN(56),
      });

      await expectError(
        () =>
          fixture.unlockMilestone(stream),
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

      const stream = await fixture.createStream({
        totalAmount,
        startTime,
        endTime,
        cliffTime,
        vestingType: { cliff: {} },
        nonce: new anchor.BN(40),
      });

      const state = await fixture.program.account.vestingState.fetch(
        stream.vestingStatePda
      );

      assert.isTrue("cliff" in state.vestingType);
      assert.equal(state.cliffTime.toString(), cliffTime.toString());
      assert.equal(state.totalAmount.toString(), totalAmount.toString());
      assert.equal(state.startTime.toString(), startTime.toString());
      assert.equal(state.endTime.toString(), endTime.toString());
    });

    it("rejects withdrawal before cliff_time with InsufficientUnlockedTokens", async () => {
      const now = nowSeconds();
      const stream = await fixture.createStream({
        startTime: new anchor.BN(now),
        endTime: new anchor.BN(now + 120),
        cliffTime: new anchor.BN(now + 60),
        vestingType: { cliff: {} },
        nonce: new anchor.BN(41),
      });

      await expectError(
        () => fixture.withdraw(stream),
        "InsufficientUnlockedTokens"
      );
    });

    it("withdraws correct linear amount after cliff_time", async () => {
      const totalAmount = new anchor.BN(1_000_000);
      const now = nowSeconds();
      const stream = await fixture.createStream({
        totalAmount,
        startTime: new anchor.BN(now - 50),
        endTime: new anchor.BN(now + 50),
        cliffTime: new anchor.BN(now - 25),
        vestingType: { cliff: {} },
        nonce: new anchor.BN(42),
      });

      await fixture.withdraw(stream);

      const state = await fixture.program.account.vestingState.fetch(
        stream.vestingStatePda
      );
      const claimed = Number(state.claimedAmount.toString());
      assert.isAtLeast(claimed, 400_000);
      assert.isBelow(claimed, 600_000);
    });

    it("cliff_time == start_time behaves like linear vesting", async () => {
      const totalAmount = new anchor.BN(1_000_000);
      const now = nowSeconds();
      const startTime = new anchor.BN(now - 25);
      const endTime = new anchor.BN(now + 75);
      const cliffTime = startTime;

      const stream = await fixture.createStream({
        totalAmount,
        startTime,
        endTime,
        cliffTime,
        vestingType: { cliff: {} },
        nonce: new anchor.BN(43),
      });

      const state = await fixture.program.account.vestingState.fetch(
        stream.vestingStatePda
      );
      assert.equal(state.cliffTime.toString(), startTime.toString());

      await fixture.withdraw(stream);

      const stateAfter = await fixture.program.account.vestingState.fetch(
        stream.vestingStatePda
      );
      const claimed = Number(stateAfter.claimedAmount.toString());
      assert.isAbove(claimed, 0);
    });

    it("rejects cliff_time > end_time with CliffTimeExceedsEndTime", async () => {
      const now = nowSeconds();
      const startTime = new anchor.BN(now);
      const endTime = new anchor.BN(now + 100);
      const cliffTime = new anchor.BN(now + 200);

      await expectError(
        () =>
          fixture.createStream({
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
});
