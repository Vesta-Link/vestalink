use anchor_lang::prelude::*;
use anchor_lang::solana_program::clock::Clock;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

declare_id!("8q5LLVTGNUS16AV4xj6KPLet1M7y4xpa8XjxV7cHH98r");

#[program]
pub mod vestalink {
    use super::*;

    pub fn create_stream(
        ctx: Context<CreateVestingSchedule>,
        params: CreateVestingParams,
    ) -> Result<()> {
        create_stream_impl(ctx, params)
    }

    pub fn create_vesting_schedule(
        ctx: Context<CreateVestingSchedule>,
        params: CreateVestingParams,
    ) -> Result<()> {
        create_stream_impl(ctx, params)
    }

    pub fn unlock_milestone(_ctx: Context<UnlockMilestone>) -> Result<()> {
        err!(VestingError::UnsupportedVestingType)
    }

    pub fn withdraw(ctx: Context<Withdraw>) -> Result<()> {
        withdraw_impl(ctx)
    }

    pub fn claim(ctx: Context<Withdraw>) -> Result<()> {
        withdraw_impl(ctx)
    }

    pub fn claim_tokens(ctx: Context<Withdraw>) -> Result<()> {
        withdraw_impl(ctx)
    }

    pub fn revoke_vesting(ctx: Context<RevokeVesting>) -> Result<()> {
        revoke_vesting_impl(ctx)
    }

    pub fn cancel_vesting(ctx: Context<RevokeVesting>) -> Result<()> {
        revoke_vesting_impl(ctx)
    }
}

fn create_stream_impl(
    ctx: Context<CreateVestingSchedule>,
    params: CreateVestingParams,
) -> Result<()> {
    require!(params.total_amount > 0, VestingError::InvalidAmount);
    require!(
        params.start_time < params.end_time,
        VestingError::InvalidTimeRange
    );
    require!(
        params.vesting_type == VestingType::Linear,
        VestingError::UnsupportedVestingType
    );

    let vesting_state = &mut ctx.accounts.vesting_state;
    vesting_state.recipient = ctx.accounts.recipient.key();
    vesting_state.funder = ctx.accounts.funder.key();
    vesting_state.total_amount = params.total_amount;
    vesting_state.claimed_amount = 0;
    vesting_state.authority_revoker = ctx.accounts.funder.key();
    vesting_state.authority_milestone = ctx.accounts.funder.key();
    vesting_state.treasury_return_address = ctx.accounts.funder_token_account.key();
    vesting_state.vesting_type = params.vesting_type;
    vesting_state.is_revoked = false;
    vesting_state.start_time = params.start_time;
    vesting_state.end_time = params.end_time;
    vesting_state.cliff_time = params.start_time;
    vesting_state.milestone_count = 0;
    vesting_state.milestones_reached = 0;
    vesting_state.bump = ctx.bumps.vesting_state;
    vesting_state.nonce = params.nonce;
    vesting_state.vested_amount_at_revocation = 0;

    let cpi_accounts = Transfer {
        from: ctx.accounts.funder_token_account.to_account_info(),
        to: ctx.accounts.vesting_token_account.to_account_info(),
        authority: ctx.accounts.funder.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
    token::transfer(cpi_ctx, params.total_amount)?;

    Ok(())
}

fn withdraw_impl(ctx: Context<Withdraw>) -> Result<()> {
    let vesting_state = &ctx.accounts.vesting_state;
    let unlocked_amount = current_unlocked_amount(vesting_state)?;
    let claimable_amount = unlocked_amount
        .checked_sub(vesting_state.claimed_amount)
        .ok_or(VestingError::InsufficientUnlockedTokens)?;

    require!(
        claimable_amount > 0,
        VestingError::InsufficientUnlockedTokens
    );

    let nonce_bytes = vesting_state.nonce.to_le_bytes();
    let bump = [vesting_state.bump];
    let seeds = &[
        b"vesting",
        vesting_state.funder.as_ref(),
        vesting_state.recipient.as_ref(),
        &nonce_bytes,
        &bump,
    ];
    let signer_seeds = &[&seeds[..]];

    let cpi_accounts = Transfer {
        from: ctx.accounts.vesting_token_account.to_account_info(),
        to: ctx.accounts.recipient_token_account.to_account_info(),
        authority: ctx.accounts.vesting_state.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        cpi_accounts,
        signer_seeds,
    );
    token::transfer(cpi_ctx, claimable_amount)?;

    let vesting_state = &mut ctx.accounts.vesting_state;
    vesting_state.claimed_amount = vesting_state
        .claimed_amount
        .checked_add(claimable_amount)
        .ok_or(VestingError::ArithmeticOverflow)?;

    Ok(())
}

fn revoke_vesting_impl(ctx: Context<RevokeVesting>) -> Result<()> {
    let vesting_state = &ctx.accounts.vesting_state;
    require!(!vesting_state.is_revoked, VestingError::StreamRevoked);

    let current_time = Clock::get()?.unix_timestamp;
    let unlocked_amount = calculate_unlocked(
        vesting_state.total_amount,
        vesting_state.start_time,
        vesting_state.end_time,
        current_time,
    );
    let unvested_amount = vesting_state
        .total_amount
        .checked_sub(unlocked_amount)
        .ok_or(VestingError::ArithmeticOverflow)?;

    let nonce_bytes = vesting_state.nonce.to_le_bytes();
    let bump = [vesting_state.bump];
    let seeds = &[
        b"vesting",
        vesting_state.funder.as_ref(),
        vesting_state.recipient.as_ref(),
        &nonce_bytes,
        &bump,
    ];
    let signer_seeds = &[&seeds[..]];

    if unvested_amount > 0 {
        let cpi_accounts = Transfer {
            from: ctx.accounts.vesting_token_account.to_account_info(),
            to: ctx.accounts.treasury_return_address.to_account_info(),
            authority: ctx.accounts.vesting_state.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );
        token::transfer(cpi_ctx, unvested_amount)?;
    }

    let vesting_state_mut = &mut ctx.accounts.vesting_state;
    vesting_state_mut.is_revoked = true;
    vesting_state_mut.vested_amount_at_revocation = unlocked_amount;

    Ok(())
}

fn current_unlocked_amount(vesting_state: &VestingState) -> Result<u64> {
    if vesting_state.is_revoked {
        return Ok(vesting_state.vested_amount_at_revocation);
    }

    let current_time = Clock::get()?.unix_timestamp;
    Ok(calculate_unlocked(
        vesting_state.total_amount,
        vesting_state.start_time,
        vesting_state.end_time,
        current_time,
    ))
}

/// Calculates the unlocked token amount using a linear vesting formula.
/// Integer floor division ensures the unlocked amount never exceeds the true
/// proportional share.
pub fn calculate_unlocked(
    total_amount: u64,
    start_time: i64,
    end_time: i64,
    current_time: i64,
) -> u64 {
    if current_time <= start_time {
        return 0;
    }
    if current_time >= end_time {
        return total_amount;
    }

    let elapsed = (current_time - start_time) as u128;
    let duration = (end_time - start_time) as u128;
    let total = total_amount as u128;
    ((total * elapsed) / duration) as u64
}

#[derive(Accounts)]
#[instruction(params: CreateVestingParams)]
pub struct CreateVestingSchedule<'info> {
    #[account(
        init,
        payer = funder,
        space = VestingState::SIZE,
        seeds = [
            b"vesting",
            funder.key().as_ref(),
            recipient.key().as_ref(),
            &params.nonce.to_le_bytes(),
        ],
        bump
    )]
    pub vesting_state: Account<'info, VestingState>,

    #[account(mut)]
    pub funder: Signer<'info>,

    /// CHECK: Recipient is stored as a stream beneficiary and used as a PDA seed.
    pub recipient: UncheckedAccount<'info>,

    #[account(
        mut,
        constraint = funder_token_account.owner == funder.key() @ VestingError::InvalidTokenOwner
    )]
    pub funder_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = vesting_token_account.owner == vesting_state.key() @ VestingError::InvalidVaultOwner,
        constraint = vesting_token_account.mint == funder_token_account.mint @ VestingError::InvalidTokenMint
    )]
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
pub struct Withdraw<'info> {
    #[account(
        mut,
        constraint = vesting_state.recipient == recipient.key() @ VestingError::UnauthorizedClaimant
    )]
    pub vesting_state: Account<'info, VestingState>,

    pub recipient: Signer<'info>,

    #[account(
        mut,
        constraint = recipient_token_account.owner == recipient.key() @ VestingError::InvalidTokenOwner,
        constraint = recipient_token_account.mint == vesting_token_account.mint @ VestingError::InvalidTokenMint
    )]
    pub recipient_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = vesting_token_account.owner == vesting_state.key() @ VestingError::InvalidVaultOwner
    )]
    pub vesting_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct RevokeVesting<'info> {
    #[account(
        mut,
        has_one = authority_revoker,
        constraint = treasury_return_address.key() == vesting_state.treasury_return_address @ VestingError::InvalidTreasuryReturnAddress
    )]
    pub vesting_state: Account<'info, VestingState>,

    pub authority_revoker: Signer<'info>,

    #[account(
        mut,
        constraint = treasury_return_address.mint == vesting_token_account.mint @ VestingError::InvalidTokenMint
    )]
    pub treasury_return_address: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = vesting_token_account.owner == vesting_state.key() @ VestingError::InvalidVaultOwner
    )]
    pub vesting_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct CreateVestingParams {
    pub total_amount: u64,
    pub vesting_type: VestingType,
    pub start_time: i64,
    pub end_time: i64,
    pub cliff_time: i64,
    pub milestone_count: u8,
    pub nonce: u64,
}

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
    pub bump: u8,
    pub nonce: u64,
    pub vested_amount_at_revocation: u64,
}

impl VestingState {
    pub const SIZE: usize = 256;
}

#[error_code]
pub enum VestingError {
    #[msg("Start time must be before end time")]
    InvalidTimeRange,
    #[msg("Amount must be greater than zero")]
    InvalidAmount,
    #[msg("Only linear vesting is supported")]
    UnsupportedVestingType,
    #[msg("Only the stream recipient can withdraw from this stream")]
    UnauthorizedClaimant,
    #[msg("No unlocked tokens are available to withdraw")]
    InsufficientUnlockedTokens,
    #[msg("Vesting stream has already been revoked")]
    StreamRevoked,
    #[msg("Arithmetic overflow")]
    ArithmeticOverflow,
    #[msg("Vault token account must be owned by the vesting PDA")]
    InvalidVaultOwner,
    #[msg("Token account mint does not match the vesting mint")]
    InvalidTokenMint,
    #[msg("Token account owner is invalid")]
    InvalidTokenOwner,
    #[msg("Treasury return address does not match the stream")]
    InvalidTreasuryReturnAddress,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unlocked_before_or_at_start_is_zero() {
        assert_eq!(calculate_unlocked(1_000, 100, 200, 99), 0);
        assert_eq!(calculate_unlocked(1_000, 100, 200, 100), 0);
    }

    #[test]
    fn unlocked_at_25_percent_is_quarter() {
        assert_eq!(calculate_unlocked(1_000, 100, 200, 125), 250);
    }

    #[test]
    fn unlocked_at_50_percent_is_half() {
        assert_eq!(calculate_unlocked(1_000, 100, 200, 150), 500);
    }

    #[test]
    fn unlocked_at_or_after_end_is_total() {
        assert_eq!(calculate_unlocked(1_000, 100, 200, 200), 1_000);
        assert_eq!(calculate_unlocked(1_000, 100, 200, 201), 1_000);
    }

    #[test]
    fn unlocked_uses_floor_division() {
        assert_eq!(calculate_unlocked(1_000, 0, 3, 1), 333);
        assert_eq!(calculate_unlocked(1_000, 0, 3, 2), 666);
    }
}
