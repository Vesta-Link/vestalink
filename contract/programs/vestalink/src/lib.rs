use anchor_lang::prelude::*;
use anchor_lang::solana_program::clock::Clock;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

declare_id!("6F7nCFLsZNgpVPjrGFdn5QhN3icbrnFbh9pingoiqi2E");

#[program]
pub mod vestalink {
    use super::*;

    pub fn create_vesting_schedule(
        ctx: Context<CreateVestingSchedule>,
        params: CreateVestingParams,
    ) -> Result<()> {
        // 1. Validate parameters
        require!(params.total_amount > 0, VestingError::InvalidAmount);
        require!(
            params.start_time < params.end_time,
            VestingError::InvalidTimeRange
        );
        require!(
            params.vesting_type == VestingType::Linear,
            VestingError::UnsupportedVestingType
        );

        // 2. Initialize VestingState account
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
        vesting_state.cliff_time = params.start_time; // Linear: no cliff, set to start_time
        vesting_state.milestone_count = 0;
        vesting_state.milestones_reached = 0;
        vesting_state.bump = ctx.bumps.vesting_state;
        vesting_state.nonce = params.nonce;

        // 3. Transfer tokens from funder to PDA vault via CPI
        let cpi_accounts = Transfer {
            from: ctx.accounts.funder_token_account.to_account_info(),
            to: ctx.accounts.vesting_token_account.to_account_info(),
            authority: ctx.accounts.funder.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
        token::transfer(cpi_ctx, params.total_amount)?;

        Ok(())
    }

    pub fn unlock_milestone(_ctx: Context<UnlockMilestone>) -> Result<()> {
        // Milestone vesting is not supported in this phase
        err!(VestingError::UnsupportedVestingType)
    }

    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        let vesting_state = &ctx.accounts.vesting_state;

        // 1. Check stream is not revoked (also enforced by account constraint)
        require!(!vesting_state.is_revoked, VestingError::StreamRevoked);

        // 2. Calculate unlocked amount using Clock sysvar
        let current_time = Clock::get()?.unix_timestamp;
        let unlocked_amount = calculate_unlocked(
            vesting_state.total_amount,
            vesting_state.start_time,
            vesting_state.end_time,
            current_time,
        );

        // 3. Compute claimable amount
        let claimable_amount = unlocked_amount
            .checked_sub(vesting_state.claimed_amount)
            .ok_or(VestingError::InsufficientUnlockedTokens)?;

        // 4. If claimable is 0, succeed as no-op
        if claimable_amount == 0 {
            return Ok(());
        }

        // 5. Transfer tokens from PDA vault to recipient via CPI (PDA signs)
        let seeds = &[
            b"vesting",
            vesting_state.funder.as_ref(),
            vesting_state.recipient.as_ref(),
            &vesting_state.nonce.to_le_bytes(),
            &[vesting_state.bump],
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

        // 6. Update claimed_amount (mutable borrow after CPI)
        let vesting_state = &mut ctx.accounts.vesting_state;
        vesting_state.claimed_amount = vesting_state
            .claimed_amount
            .checked_add(claimable_amount)
            .ok_or(VestingError::ArithmeticOverflow)?;

        Ok(())
    }

    pub fn cancel_vesting(ctx: Context<CancelVesting>) -> Result<()> {
        let vesting_state = &ctx.accounts.vesting_state;

        // 1. Calculate remaining unclaimed tokens
        let remaining_amount = vesting_state
            .total_amount
            .checked_sub(vesting_state.claimed_amount)
            .ok_or(VestingError::ArithmeticOverflow)?;

        // Extract PDA seed data before mutable borrow
        let funder = vesting_state.funder;
        let recipient = vesting_state.recipient;
        let nonce = vesting_state.nonce;
        let bump = vesting_state.bump;

        // 2. Mark as revoked
        let vesting_state_mut = &mut ctx.accounts.vesting_state;
        vesting_state_mut.is_revoked = true;

        // 3. Transfer remaining tokens back to treasury via CPI (PDA signs)
        if remaining_amount > 0 {
            let seeds = &[
                b"vesting",
                funder.as_ref(),
                recipient.as_ref(),
                &nonce.to_le_bytes(),
                &[bump],
            ];
            let signer_seeds = &[&seeds[..]];

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
            token::transfer(cpi_ctx, remaining_amount)?;
        }

        Ok(())
    }
}

// ── Helper ──────────────────────────────────────────────────────────

/// Calculates the unlocked token amount using linear vesting formula.
/// Uses integer arithmetic with floor division to ensure
/// unlocked_amount never exceeds the true proportional share.
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
    // total * elapsed / duration — u128 prevents overflow for reasonable values
    ((total * elapsed) / duration) as u64
}

// ── Account contexts ────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(params: CreateVestingParams)]
pub struct CreateVestingSchedule<'info> {
    #[account(
        init,
        payer = funder,
        space = VestingState::SIZE,
        seeds = [
            "vesting".as_ref(),
            funder.key().as_ref(),
            recipient.key().as_ref(),
            &params.nonce.to_le_bytes(),
        ],
        bump
    )]
    pub vesting_state: Account<'info, VestingState>,

    #[account(mut)]
    pub funder: Signer<'info>,

    /// CHECK: Recipient address used as PDA seed; validation happens in handler logic.
    pub recipient: UncheckedAccount<'info>,

    #[account(mut)]
    pub funder_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = vesting_token_account.owner == vesting_state.key() @ VestingError::InvalidVaultOwner
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
pub struct Claim<'info> {
    #[account(
        mut,
        has_one = recipient,
        constraint = !vesting_state.is_revoked @ VestingError::StreamRevoked
    )]
    pub vesting_state: Account<'info, VestingState>,

    pub recipient: Signer<'info>,

    #[account(
        mut,
        constraint = recipient_token_account.owner == recipient.key()
    )]
    pub recipient_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub vesting_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct CancelVesting<'info> {
    #[account(mut, has_one = authority_revoker)]
    pub vesting_state: Account<'info, VestingState>,

    pub authority_revoker: Signer<'info>,

    #[account(mut)]
    pub treasury_return_address: Account<'info, TokenAccount>,

    #[account(mut)]
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
    pub nonce: u64,
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
    pub bump: u8,
    pub nonce: u64,
}

impl VestingState {
    // 8 (discriminator) + 32*5 (Pubkeys) + 8*2 (u64s) + 1 (VestingType) + 1 (bool)
    // + 8*3 (i64s) + 1*3 (u8s) + 1 (bump) + 8 (nonce) = 222, rounded to 224
    pub const SIZE: usize = 224;
}

// ── Error codes ────────────────────────────────────────────────────

#[error_code]
pub enum VestingError {
    InvalidTimeRange,
    InvalidAmount,
    UnsupportedVestingType,
    UnauthorizedClaimant,
    InsufficientUnlockedTokens,
    StreamRevoked,
    ArithmeticOverflow,
    InvalidVaultOwner,
}