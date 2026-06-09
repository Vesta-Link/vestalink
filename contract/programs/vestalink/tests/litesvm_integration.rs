//! LiteSVM integration tests for the vestalink Anchor program.
//!
//! These tests run the compiled BPF program inside LiteSVM (an in-process
//! Solana VM), giving full Rust-native test ergonomics:
//!   • No external validator process required
//!   • Instant clock manipulation via `svm.set_sysvar(&clock)`
//!   • Faster than `anchor test` (~seconds vs ~30 s)
//!
//! **Pre-requisite**: the program must be compiled first:
//!   ```
//!   anchor build
//!   cargo test --test litesvm_integration
//!   ```

use anchor_lang::{AccountDeserialize, AnchorSerialize};
use litesvm::LiteSVM;
use sha2::{Digest, Sha256};
use solana_sdk::{
    clock::Clock,
    instruction::{AccountMeta, Instruction},
    native_token::LAMPORTS_PER_SOL,
    program_pack::Pack,
    pubkey::Pubkey,
    signature::{Keypair, Signer},
    system_instruction,
    transaction::Transaction,
};
use spl_token::state::{Account as TokenAccount, Mint};
use vestalink::{CreateVestingParams, VestingState, VestingType};

// ─── helpers ────────────────────────────────────────────────────────────────

const PROGRAM_ID_STR: &str = "8q5LLVTGNUS16AV4xj6KPLet1M7y4xpa8XjxV7cHH98r";

fn program_id() -> Pubkey {
    PROGRAM_ID_STR.parse().unwrap()
}

/// Compute the first 8 bytes of SHA-256("global:<name>") — Anchor's discriminator.
fn discriminator(name: &str) -> [u8; 8] {
    let mut h = Sha256::new();
    h.update(b"global:");
    h.update(name.as_bytes());
    h.finalize()[..8].try_into().unwrap()
}

/// Load the compiled vestalink BPF binary and return a fresh LiteSVM instance.
///
/// Skips the test gracefully if `anchor build` has not been run yet.
fn load_svm() -> Option<LiteSVM> {
    let so_path = format!(
        "{}/../../target/deploy/vestalink.so",
        env!("CARGO_MANIFEST_DIR")
    );
    let program_data = match std::fs::read(&so_path) {
        Ok(d) => d,
        Err(_) => {
            eprintln!(
                "⚠  Skipping LiteSVM tests: {} not found. Run `anchor build` first.",
                so_path
            );
            return None;
        }
    };
    let mut svm = LiteSVM::new();
    svm.add_program(program_id(), &program_data);
    Some(svm)
}

/// Set the on-chain clock to a specific unix timestamp.
fn warp_to(svm: &mut LiteSVM, unix_timestamp: i64) {
    let mut clock = svm.get_sysvar::<Clock>();
    clock.unix_timestamp = unix_timestamp;
    svm.set_sysvar(&clock);
}

/// Create an SPL Mint and return its pubkey.
fn create_mint(svm: &mut LiteSVM, payer: &Keypair) -> Pubkey {
    let mint_kp = Keypair::new();
    let rent = svm.minimum_balance_for_rent_exemption(Mint::LEN);
    let tx = Transaction::new_signed_with_payer(
        &[
            system_instruction::create_account(
                &payer.pubkey(),
                &mint_kp.pubkey(),
                rent,
                Mint::LEN as u64,
                &spl_token::id(),
            ),
            spl_token::instruction::initialize_mint(
                &spl_token::id(),
                &mint_kp.pubkey(),
                &payer.pubkey(),
                None,
                6,
            )
            .unwrap(),
        ],
        Some(&payer.pubkey()),
        &[payer, &mint_kp],
        svm.latest_blockhash(),
    );
    svm.send_transaction(tx).unwrap();
    mint_kp.pubkey()
}

/// Create an SPL token account owned by `owner` and return its pubkey.
fn create_token_account(svm: &mut LiteSVM, payer: &Keypair, mint: Pubkey, owner: Pubkey) -> Pubkey {
    let ta_kp = Keypair::new();
    let rent = svm.minimum_balance_for_rent_exemption(TokenAccount::LEN);
    let tx = Transaction::new_signed_with_payer(
        &[
            system_instruction::create_account(
                &payer.pubkey(),
                &ta_kp.pubkey(),
                rent,
                TokenAccount::LEN as u64,
                &spl_token::id(),
            ),
            spl_token::instruction::initialize_account(
                &spl_token::id(),
                &ta_kp.pubkey(),
                &mint,
                &owner,
            )
            .unwrap(),
        ],
        Some(&payer.pubkey()),
        &[payer, &ta_kp],
        svm.latest_blockhash(),
    );
    svm.send_transaction(tx).unwrap();
    ta_kp.pubkey()
}

/// Mint `amount` tokens from `mint` into `dest`.
fn mint_to(svm: &mut LiteSVM, payer: &Keypair, mint: Pubkey, dest: Pubkey, amount: u64) {
    let tx = Transaction::new_signed_with_payer(
        &[spl_token::instruction::mint_to(
            &spl_token::id(),
            &mint,
            &dest,
            &payer.pubkey(),
            &[],
            amount,
        )
        .unwrap()],
        Some(&payer.pubkey()),
        &[payer],
        svm.latest_blockhash(),
    );
    svm.send_transaction(tx).unwrap();
}

/// Read the SPL token balance from an account.
fn token_balance(svm: &LiteSVM, account: &Pubkey) -> u64 {
    let data = svm.get_account(account).expect("account not found").data;
    TokenAccount::unpack(&data).unwrap().amount
}

/// Deserialize the `VestingState` from an on-chain account
fn vesting_state(svm: &LiteSVM, pda: &Pubkey) -> VestingState {
    let data = svm.get_account(pda).expect("vesting state not found").data;
    VestingState::try_deserialize(&mut data.as_slice()).unwrap()
}

/// Derive the vesting PDA.
fn vesting_pda(funder: &Pubkey, recipient: &Pubkey, nonce: u64) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            b"vesting",
            funder.as_ref(),
            recipient.as_ref(),
            &nonce.to_le_bytes(),
        ],
        &program_id(),
    )
}

/// Build a `create_stream` instruction.
fn ix_create_stream(
    vesting_state_pda: Pubkey,
    funder: Pubkey,
    recipient: Pubkey,
    funder_ata: Pubkey,
    vault_ata: Pubkey,
    params: &CreateVestingParams,
) -> Instruction {
    let mut data = discriminator("create_stream").to_vec();
    params.serialize(&mut data).unwrap();
    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new(vesting_state_pda, false),
            AccountMeta::new(funder, true),
            AccountMeta::new_readonly(recipient, false),
            AccountMeta::new(funder_ata, false),
            AccountMeta::new(vault_ata, false),
            AccountMeta::new_readonly(spl_token::id(), false),
            AccountMeta::new_readonly(solana_sdk::system_program::id(), false),
        ],
        data,
    }
}

/// Build a `withdraw` instruction.
fn ix_withdraw(
    vesting_state_pda: Pubkey,
    recipient: Pubkey,
    recipient_ata: Pubkey,
    vault_ata: Pubkey,
) -> Instruction {
    let data = discriminator("withdraw").to_vec();
    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new(vesting_state_pda, false),
            AccountMeta::new_readonly(recipient, true),
            AccountMeta::new(recipient_ata, false),
            AccountMeta::new(vault_ata, false),
            AccountMeta::new_readonly(spl_token::id(), false),
        ],
        data,
    }
}

// ─── test fixtures ───────────────────────────────────────────────────────────

struct Ctx {
    svm: LiteSVM,
    funder: Keypair,
    mint: Pubkey,
    funder_ata: Pubkey,
}

fn setup() -> Option<Ctx> {
    let mut svm = load_svm()?;
    let funder = Keypair::new();
    svm.airdrop(&funder.pubkey(), 100 * LAMPORTS_PER_SOL).unwrap();

    let mint = create_mint(&mut svm, &funder);
    let funder_ata = create_token_account(&mut svm, &funder, mint, funder.pubkey());
    mint_to(&mut svm, &funder, mint, funder_ata, 10_000_000_000);

    Some(Ctx { svm, funder, mint, funder_ata })
}

// ─── tests ───────────────────────────────────────────────────────────────────

/// Happy path: create_stream locks tokens in the vault and initialises state.
#[test]
fn test_create_stream_locks_tokens() {
    let mut ctx = match setup() {
        Some(ctx) => ctx,
        None => return, // anchor build not run, skip gracefully
    };

    let recipient = Keypair::new();
    let nonce: u64 = 1;
    let total: u64 = 500_000;

    let (pda, _bump) = vesting_pda(&ctx.funder.pubkey(), &recipient.pubkey(), nonce);
    let vault = create_token_account(&mut ctx.svm, &ctx.funder, ctx.mint, pda);

    let now = 1_000_000i64;
    warp_to(&mut ctx.svm, now);

    let params = CreateVestingParams {
        total_amount: total,
        vesting_type: VestingType::Linear,
        start_time: now,
        end_time: now + 100,
        cliff_time: now,
        milestone_count: 0,
        nonce,
    };

    let tx = Transaction::new_signed_with_payer(
        &[ix_create_stream(pda, ctx.funder.pubkey(), recipient.pubkey(), ctx.funder_ata, vault, &params)],
        Some(&ctx.funder.pubkey()),
        &[&ctx.funder],
        ctx.svm.latest_blockhash(),
    );
    ctx.svm.send_transaction(tx).unwrap();

    // Vault holds the locked tokens
    assert_eq!(token_balance(&ctx.svm, &vault), total);

    // Vesting state is initialised correctly
    let state = vesting_state(&ctx.svm, &pda);
    assert_eq!(state.total_amount, total);
    assert_eq!(state.claimed_amount, 0);
    assert!(!state.is_revoked);
    assert_eq!(state.recipient, recipient.pubkey());
    assert_eq!(state.funder, ctx.funder.pubkey());
}

/// Time-warp withdraw: after 50% of the linear stream has elapsed the
/// recipient can claim exactly half the total.
#[test]
fn test_withdraw_after_time_warp_claims_half() {
    let mut ctx = match setup() {
        Some(ctx) => ctx,
        None => return,
    };

    let recipient = Keypair::new();
    ctx.svm.airdrop(&recipient.pubkey(), LAMPORTS_PER_SOL).unwrap();

    let nonce: u64 = 2;
    let total: u64 = 1_000_000;
    let start = 2_000_000i64;
    let end = start + 100;

    let (pda, _) = vesting_pda(&ctx.funder.pubkey(), &recipient.pubkey(), nonce);
    let vault = create_token_account(&mut ctx.svm, &ctx.funder, ctx.mint, pda);
    let recipient_ata =
        create_token_account(&mut ctx.svm, &ctx.funder, ctx.mint, recipient.pubkey());

    warp_to(&mut ctx.svm, start);

    let params = CreateVestingParams {
        total_amount: total,
        vesting_type: VestingType::Linear,
        start_time: start,
        end_time: end,
        cliff_time: start,
        milestone_count: 0,
        nonce,
    };
    let tx = Transaction::new_signed_with_payer(
        &[ix_create_stream(pda, ctx.funder.pubkey(), recipient.pubkey(), ctx.funder_ata, vault, &params)],
        Some(&ctx.funder.pubkey()),
        &[&ctx.funder],
        ctx.svm.latest_blockhash(),
    );
    ctx.svm.send_transaction(tx).unwrap();

    // Jump to 50% through the stream
    warp_to(&mut ctx.svm, start + 50);

    let tx = Transaction::new_signed_with_payer(
        &[ix_withdraw(pda, recipient.pubkey(), recipient_ata, vault)],
        Some(&recipient.pubkey()),
        &[&recipient],
        ctx.svm.latest_blockhash(),
    );
    ctx.svm.send_transaction(tx).unwrap();

    assert_eq!(token_balance(&ctx.svm, &recipient_ata), 500_000);

    let state = vesting_state(&ctx.svm, &pda);
    assert_eq!(state.claimed_amount, 500_000);
}

/// Security: a third-party `impostor` cannot withdraw from a stream they are
/// not the recipient of.
#[test]
fn test_unauthorized_withdraw_is_rejected() {
    let mut ctx = match setup() {
        Some(ctx) => ctx,
        None => return,
    };

    let recipient = Keypair::new();
    let impostor = Keypair::new();
    ctx.svm.airdrop(&impostor.pubkey(), LAMPORTS_PER_SOL).unwrap();

    let nonce: u64 = 3;
    let start = 3_000_000i64;

    let (pda, _) = vesting_pda(&ctx.funder.pubkey(), &recipient.pubkey(), nonce);
    let vault = create_token_account(&mut ctx.svm, &ctx.funder, ctx.mint, pda);
    let impostor_ata =
        create_token_account(&mut ctx.svm, &ctx.funder, ctx.mint, impostor.pubkey());

    warp_to(&mut ctx.svm, start);

    let params = CreateVestingParams {
        total_amount: 1_000_000,
        vesting_type: VestingType::Linear,
        start_time: start - 50,
        end_time: start + 50,
        cliff_time: start - 50,
        milestone_count: 0,
        nonce,
    };
    let tx = Transaction::new_signed_with_payer(
        &[ix_create_stream(pda, ctx.funder.pubkey(), recipient.pubkey(), ctx.funder_ata, vault, &params)],
        Some(&ctx.funder.pubkey()),
        &[&ctx.funder],
        ctx.svm.latest_blockhash(),
    );
    ctx.svm.send_transaction(tx).unwrap();

    // Impostor tries to drain the vault — must fail
    let tx = Transaction::new_signed_with_payer(
        &[ix_withdraw(pda, impostor.pubkey(), impostor_ata, vault)],
        Some(&impostor.pubkey()),
        &[&impostor],
        ctx.svm.latest_blockhash(),
    );
    assert!(
        ctx.svm.send_transaction(tx).is_err(),
        "impostor should not be able to withdraw"
    );

    // Vault must still hold all tokens
    assert_eq!(token_balance(&ctx.svm, &vault), 1_000_000);
}
