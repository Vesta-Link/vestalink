use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};

declare_id!("6F7nCFLsZNgpVPjrGFdn5QhN3icbrnFbh9pingoiqi2E");

#[program]
pub mod vestalink {
    use super::*;

    pub fn create_vesting_schedule(
        _ctx: Context<CreateVestingSchedule>,
        _params: CreateVestingParams,
    ) -> Result<()> {
        msg!("create_vesting_schedule: scaffold placeholder");
        Ok(())
    }

    pub fn unlock_milestone(_ctx: Context<UnlockMilestone>) -> Result<()> {
        msg!("unlock_milestone: scaffold placeholder");
        Ok(())
    }

    pub fn claim(_ctx: Context<Claim>) -> Result<()> {
        msg!("claim: scaffold placeholder");
        Ok(())
    }

    pub fn cancel_vesting(_ctx: Context<CancelVesting>) -> Result<()> {
        msg!("cancel_vesting: scaffold placeholder");
        Ok(())
    }
}

// ── Account contexts ────────────────────────────────────────────────

#[derive(Accounts)]
pub struct CreateVestingSchedule<'info> {
    #[account(
        init,
        payer = funder,
        space = VestingState::SIZE,
        seeds = ["vesting".as_ref(), funder.key().as_ref(), recipient.key().as_ref()],
        bump
    )]
    pub vesting_state: Account<'info, VestingState>,

    #[account(mut)]
    pub funder: Signer<'info>,

    /// CHECK: Recipient address used as PDA seed; validation happens in handler logic.
    pub recipient: UncheckedAccount<'info>,

    pub funder_token_account: Account<'info, TokenAccount>,

    pub vesting_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UnlockMilestone<'info> {
    #[account(mut, has_one = authority_milestone)]
    pub vesting_state: Account<'info, VestingState>,

    pub authority_milestone: Signer<'info>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(has_one = recipient)]
    pub vesting_state: Account<'info, VestingState>,

    pub recipient: Signer<'info>,

    pub recipient_token_account: Account<'info, TokenAccount>,

    pub vesting_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct CancelVesting<'info> {
    #[account(mut, has_one = authority_revoker)]
    pub vesting_state: Account<'info, VestingState>,

    pub authority_revoker: Signer<'info>,

    pub treasury_return_address: Account<'info, TokenAccount>,

    pub vesting_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

// ── Parameters ──────────────────────────────────────────────────────

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct CreateVestingParams {
    pub total_amount: u64,
    pub vesting_type: VestingType,
    pub start_time: i64,
    pub end_time: i64,
    pub cliff_time: i64,
    pub milestone_count: u8,
}

// ── Data types ──────────────────────────────────────────────────────

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Debug)]
pub enum VestingType {
    Cliff,
    Linear,
    Milestone,
}

#[account]
pub struct VestingState {
    pub recipient: Pubkey,
    pub funder: Pubkey,
    pub total_amount: u64,
    pub claimed_amount: u64,
    pub authority_revoker: Pubkey,
    pub authority_milestone: Pubkey,
    pub treasury_return_address: Pubkey,
    pub vesting_type: VestingType,
    pub is_revoked: bool,
    pub start_time: i64,
    pub end_time: i64,
    pub cliff_time: i64,
    pub milestone_count: u8,
    pub milestones_reached: u8,
}

impl VestingState {
    // 8 (discriminator) + 32*4 (Pubkeys) + 8*4 (u64/i64) + 1*3 (bool + u8 + u8) + 1 (VestingType enum)
    pub const SIZE: usize = 8 + 32 + 32 + 8 + 8 + 32 + 32 + 32 + 1 + 1 + 8 + 8 + 8 + 1 + 1;
}
