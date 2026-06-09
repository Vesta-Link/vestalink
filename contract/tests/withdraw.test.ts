import * as anchor from "@coral-xyz/anchor";
import { assert } from "chai";
import { getAssociatedTokenAddressSync, getOrCreateAssociatedTokenAccount, createAssociatedTokenAccountIdempotentInstruction, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { expectError, nowSeconds, sleep } from "./utils";
import { VestalinkFixture } from "./fixture";

describe("withdraw", () => {
  const fixture = new VestalinkFixture();

  before(async () => {
    await fixture.setup();
  });

  it("withdraws about 25% from a partially vested stream", async () => {
    const totalAmount = new anchor.BN(1_000_000);
    const now = nowSeconds();
    const stream = await fixture.createStream({
      totalAmount,
      startTime: new anchor.BN(now - 25),
      endTime: new anchor.BN(now + 75),
      nonce: new anchor.BN(10),
    });

    await fixture.withdraw(stream);

    const state = await fixture.program.account.vestingState.fetch(
      stream.vestingStatePda
    );
    const claimed = BigInt(state.claimedAmount.toString());
    assert.isAtLeast(Number(claimed), 230_000);
    assert.isBelow(Number(claimed), 300_000);
  });

  it("allows later partial withdrawals as more tokens unlock", async () => {
    const totalAmount = new anchor.BN(1_000_000);
    const now = nowSeconds();
    const stream = await fixture.createStream({
      totalAmount,
      startTime: new anchor.BN(now - 5),
      endTime: new anchor.BN(now + 15),
      nonce: new anchor.BN(11),
    });

    await fixture.withdraw(stream);
    const firstState = await fixture.program.account.vestingState.fetch(
      stream.vestingStatePda
    );
    await sleep(6000);
    await fixture.withdraw(stream);
    const secondState = await fixture.program.account.vestingState.fetch(
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
    const stream = await fixture.createStream({
      totalAmount,
      startTime: new anchor.BN(now - 20),
      endTime: new anchor.BN(now - 10),
      nonce: new anchor.BN(12),
    });

    await fixture.withdraw(stream, { method: "claimTokens" });

    const state = await fixture.program.account.vestingState.fetch(
      stream.vestingStatePda
    );
    assert.equal(state.claimedAmount.toString(), totalAmount.toString());
  });

  it("returns InsufficientUnlockedTokens before any tokens unlock", async () => {
    const now = nowSeconds();
    const stream = await fixture.createStream({
      startTime: new anchor.BN(now + 60),
      endTime: new anchor.BN(now + 120),
      nonce: new anchor.BN(13),
    });

    await expectError(() => fixture.withdraw(stream), "InsufficientUnlockedTokens");
  });

  it("returns InsufficientUnlockedTokens on repeat full withdrawal", async () => {
    const now = nowSeconds();
    const stream = await fixture.createStream({
      startTime: new anchor.BN(now - 20),
      endTime: new anchor.BN(now - 10),
      nonce: new anchor.BN(14),
    });

    await fixture.withdraw(stream, { method: "claim" });
    await expectError(() => fixture.withdraw(stream), "InsufficientUnlockedTokens");
  });

  it("returns UnauthorizedClaimant for someone else's stream", async () => {
    const now = nowSeconds();
    const stream = await fixture.createStream({
      startTime: new anchor.BN(now - 20),
      endTime: new anchor.BN(now + 80),
      nonce: new anchor.BN(15),
    });
    const impostor = anchor.web3.Keypair.generate();
    const impostorAta = getAssociatedTokenAddressSync(
      fixture.mint,
      impostor.publicKey
    );

    const airdropSig = await fixture.provider.connection.requestAirdrop(
      impostor.publicKey,
      1_000_000_000
    );
    const latestBlockhash = await fixture.provider.connection.getLatestBlockhash();
    await fixture.provider.connection.confirmTransaction({
      signature: airdropSig,
      ...latestBlockhash,
    });
    await anchor.web3.sendAndConfirmTransaction(
      fixture.provider.connection,
      new anchor.web3.Transaction().add(
        createAssociatedTokenAccountIdempotentInstruction(
          impostor.publicKey,
          impostorAta,
          impostor.publicKey,
          fixture.mint,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      ),
      [impostor]
    );

    await expectError(
      () =>
        fixture.withdraw(stream, {
          signer: impostor,
          recipientTokenAccount: impostorAta,
        }),
      "UnauthorizedClaimant"
    );
  });

  it("rejects recipient token accounts with a different mint", async () => {
    const now = nowSeconds();
    const stream = await fixture.createStream({
      startTime: new anchor.BN(now - 20),
      endTime: new anchor.BN(now + 80),
      nonce: new anchor.BN(16),
    });
    const wrongMintAta = (
      await getOrCreateAssociatedTokenAccount(
        fixture.provider.connection,
        fixture.wallet.payer,
        fixture.otherMint,
        fixture.recipient.publicKey
      )
    ).address;

    await expectError(
      () => fixture.withdraw(stream, { recipientTokenAccount: wrongMintAta }),
      "InvalidTokenMint"
    );
  });
});
