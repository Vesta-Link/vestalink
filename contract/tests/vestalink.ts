import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Vestalink } from "../target/types/vestalink";
import { assert } from "chai";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import idlJson from "../target/idl/vestalink.json";

describe("vestalink", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.vestalink as Program<Vestalink>;
  const wallet = provider.wallet as anchor.Wallet;

  // Shared state across tests
  let mint: anchor.web3.PublicKey;
  let funderTokenAccount: anchor.web3.PublicKey;
  let vestingTokenAccount: anchor.web3.PublicKey;
  let vestingStatePda: anchor.web3.PublicKey;
  let vestingStateBump: number;
  let recipient: anchor.web3.Keypair;
  let recipientTokenAccount: anchor.web3.PublicKey;

  // ── Property 4: Test suite passes ──────────────────────────────────
  it("deploys successfully", async () => {
    const programId = program.programId;
    assert.isNotNull(programId);
    assert.isTrue(programId.toBase58().length > 0);
  });

  // ── Property 2: Instruction handlers are no-ops ────────────────────
  // Since handlers are scaffold placeholders (no business logic), they don't
  // populate VestingState fields. The create_vesting_schedule handler can be
  // called because Anchor's init constraint creates the account. The other
  // handlers (unlock_milestone, claim, cancel_vesting) require has_one
  // constraints that reference fields set by business logic, so they can't
  // be invoked in the scaffold phase. We verify they exist in the IDL instead.
  describe("instruction handlers (scaffold placeholders)", () => {
    before(async () => {
      // Create a mint
      mint = await createMint(
        provider.connection,
        wallet.payer,
        wallet.payer.publicKey,
        null,
        6,
      );

      // Create funder token account (idempotent)
      funderTokenAccount = (
        await getOrCreateAssociatedTokenAccount(
          provider.connection,
          wallet.payer,
          mint,
          wallet.payer.publicKey,
        )
      ).address;

      // Mint tokens to funder
      await mintTo(
        provider.connection,
        wallet.payer,
        mint,
        funderTokenAccount,
        wallet.payer.publicKey,
        1_000_000_000_000,
      );

      // Create recipient keypair
      recipient = anchor.web3.Keypair.generate();

      // Derive PDA for vesting state
      [vestingStatePda, vestingStateBump] =
        anchor.web3.PublicKey.findProgramAddressSync(
          [
            Buffer.from("vesting"),
            wallet.payer.publicKey.toBuffer(),
            recipient.publicKey.toBuffer(),
          ],
          program.programId,
        );

      // Derive vesting token account (ATA for the PDA)
      vestingTokenAccount = getAssociatedTokenAddressSync(
        mint,
        vestingStatePda,
        true,
      );

      // Create recipient token account (idempotent)
      recipientTokenAccount = (
        await getOrCreateAssociatedTokenAccount(
          provider.connection,
          wallet.payer,
          mint,
          recipient.publicKey,
        )
      ).address;
    });

    it("create_vesting_schedule succeeds as a no-op", async () => {
      // Create the ATA for the vesting PDA
      const createAtaIx = createAssociatedTokenAccountInstruction(
        wallet.payer.publicKey,
        vestingTokenAccount,
        vestingStatePda,
        mint,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      );

      const tx = await program.methods
        .createVestingSchedule({
          totalAmount: new anchor.BN(1_000_000_000_000),
          vestingType: { cliff: {} },
          startTime: new anchor.BN(Math.floor(Date.now() / 1000)),
          endTime: new anchor.BN(Math.floor(Date.now() / 1000) + 86400 * 365),
          cliffTime: new anchor.BN(Math.floor(Date.now() / 1000) + 86400 * 90),
          milestoneCount: 0,
        })
        .accounts({
          vestingState: vestingStatePda,
          funder: wallet.payer.publicKey,
          recipient: recipient.publicKey,
          funderTokenAccount,
          vestingTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .preInstructions([createAtaIx])
        .rpc();

      assert.isNotNull(tx, "Transaction should succeed");
    });

    it("unlock_milestone is registered in IDL with correct accounts", async () => {
      const ix = idlJson.instructions.find(
        (i: any) => i.name === "unlock_milestone",
      );
      assert.exists(ix, "unlock_milestone must exist in IDL");
      const accountNames = ix.accounts.map((a: any) => a.name);
      assert.include(
        accountNames,
        "vesting_state",
        "must have vesting_state account",
      );
      assert.include(
        accountNames,
        "authority_milestone",
        "must have authority_milestone account",
      );
    });

    it("claim is registered in IDL with correct accounts", async () => {
      const ix = idlJson.instructions.find((i: any) => i.name === "claim");
      assert.exists(ix, "claim must exist in IDL");
      const accountNames = ix.accounts.map((a: any) => a.name);
      assert.include(
        accountNames,
        "vesting_state",
        "must have vesting_state account",
      );
      assert.include(accountNames, "recipient", "must have recipient account");
      assert.include(
        accountNames,
        "recipient_token_account",
        "must have recipient_token_account",
      );
      assert.include(
        accountNames,
        "vesting_token_account",
        "must have vesting_token_account",
      );
      assert.include(accountNames, "token_program", "must have token_program");
    });

    it("cancel_vesting is registered in IDL with correct accounts", async () => {
      const ix = idlJson.instructions.find(
        (i: any) => i.name === "cancel_vesting",
      );
      assert.exists(ix, "cancel_vesting must exist in IDL");
      const accountNames = ix.accounts.map((a: any) => a.name);
      assert.include(
        accountNames,
        "vesting_state",
        "must have vesting_state account",
      );
      assert.include(
        accountNames,
        "authority_revoker",
        "must have authority_revoker account",
      );
      assert.include(
        accountNames,
        "treasury_return_address",
        "must have treasury_return_address account",
      );
      assert.include(
        accountNames,
        "vesting_token_account",
        "must have vesting_token_account",
      );
      assert.include(accountNames, "token_program", "must have token_program");
    });
  });

  // ── Property 3: VestingState struct completeness ───────────────────
  describe("VestingState struct completeness", () => {
    it("has all 14 fields with correct types after create_vesting_schedule", async () => {
      const vs = await program.account.vestingState.fetch(vestingStatePda);

      // Verify all 14 fields exist (Requirement 3.1–3.14)
      assert.exists(vs.recipient, "recipient field must exist");
      assert.exists(vs.funder, "funder field must exist");
      assert.exists(vs.totalAmount, "totalAmount field must exist");
      assert.exists(vs.claimedAmount, "claimedAmount field must exist");
      assert.exists(vs.authorityRevoker, "authorityRevoker field must exist");
      assert.exists(
        vs.authorityMilestone,
        "authorityMilestone field must exist",
      );
      assert.exists(
        vs.treasuryReturnAddress,
        "treasuryReturnAddress field must exist",
      );
      assert.exists(vs.vestingType, "vestingType field must exist");
      assert.exists(vs.isRevoked, "isRevoked field must exist");
      assert.exists(vs.startTime, "startTime field must exist");
      assert.exists(vs.endTime, "endTime field must exist");
      assert.exists(vs.cliffTime, "cliffTime field must exist");
      assert.exists(vs.milestoneCount, "milestoneCount field must exist");
      assert.exists(vs.milestonesReached, "milestonesReached field must exist");

      // Verify field types
      assert.instanceOf(
        vs.recipient,
        anchor.web3.PublicKey,
        "recipient must be PublicKey",
      );
      assert.instanceOf(
        vs.funder,
        anchor.web3.PublicKey,
        "funder must be PublicKey",
      );
      assert.instanceOf(
        vs.totalAmount,
        anchor.BN,
        "totalAmount must be BN (u64)",
      );
      assert.instanceOf(
        vs.claimedAmount,
        anchor.BN,
        "claimedAmount must be BN (u64)",
      );
      assert.instanceOf(
        vs.authorityRevoker,
        anchor.web3.PublicKey,
        "authorityRevoker must be PublicKey",
      );
      assert.instanceOf(
        vs.authorityMilestone,
        anchor.web3.PublicKey,
        "authorityMilestone must be PublicKey",
      );
      assert.instanceOf(
        vs.treasuryReturnAddress,
        anchor.web3.PublicKey,
        "treasuryReturnAddress must be PublicKey",
      );
      assert.isBoolean(vs.isRevoked, "isRevoked must be boolean");
      assert.instanceOf(vs.startTime, anchor.BN, "startTime must be BN (i64)");
      assert.instanceOf(vs.endTime, anchor.BN, "endTime must be BN (i64)");
      assert.instanceOf(vs.cliffTime, anchor.BN, "cliffTime must be BN (i64)");
      assert.isNumber(vs.milestoneCount, "milestoneCount must be number (u8)");
      assert.isNumber(
        vs.milestonesReached,
        "milestonesReached must be number (u8)",
      );

      // Verify vestingType is one of the valid enum variants
      const validVestingTypes = ["cliff", "linear", "milestone"];
      const vestingTypeKey = Object.keys(vs.vestingType)[0];
      assert.include(
        validVestingTypes,
        vestingTypeKey,
        "vestingType must be Cliff, Linear, or Milestone",
      );
    });
  });
});
