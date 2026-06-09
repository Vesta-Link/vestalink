import * as anchor from "@coral-xyz/anchor";
import { assert } from "chai";
import { getAccount, getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import { expectError, nowSeconds } from "./utils";
import { VestalinkFixture } from "./fixture";

describe("create_stream", () => {
  const fixture = new VestalinkFixture();

  before(async () => {
    await fixture.setup();
  });

  it("creates a stream and locks tokens in a PDA-owned vault", async () => {
    const totalAmount = new anchor.BN(1_000_000);
    const startTime = new anchor.BN(nowSeconds());
    const endTime = new anchor.BN(startTime.toNumber() + 100);
    const stream = await fixture.createStream({
      totalAmount,
      startTime,
      endTime,
      nonce: new anchor.BN(1),
    });

    const state = await fixture.program.account.vestingState.fetch(
      stream.vestingStatePda
    );
    const vault = await getAccount(
      fixture.provider.connection,
      stream.vestingTokenAccount
    );

    assert.isTrue(state.recipient.equals(fixture.recipient.publicKey));
    assert.isTrue(state.funder.equals(fixture.wallet.payer.publicKey));
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
    const stream = await fixture.createStream({
      method: "createVestingSchedule",
      nonce: new anchor.BN(2),
    });
    const state = await fixture.program.account.vestingState.fetch(
      stream.vestingStatePda
    );
    assert.equal(state.totalAmount.toString(), stream.totalAmount.toString());
  });

  it("rejects invalid stream parameters", async () => {
    await expectError(
      () =>
        fixture.createStream({
          totalAmount: new anchor.BN(0),
          nonce: new anchor.BN(3),
        }),
      "InvalidAmount"
    );

    const now = nowSeconds();
    await expectError(
      () =>
        fixture.createStream({
          startTime: new anchor.BN(now + 10),
          endTime: new anchor.BN(now + 10),
          nonce: new anchor.BN(4),
        }),
      "InvalidTimeRange"
    );

    await expectError(
      () =>
        fixture.createStream({
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
        fixture.provider.connection,
        fixture.wallet.payer,
        fixture.mint,
        fixture.wallet.payer.publicKey
      )
    ).address;

    await expectError(
      () =>
        fixture.createStream({
          vaultTokenAccount: funderOwnedVault,
          nonce: new anchor.BN(6),
        }),
      "InvalidVaultOwner"
    );
  });
});
