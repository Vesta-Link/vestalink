use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};
use anchor_spl::associated_token::AssociatedToken;
use crate::error::VestingError;
use crate::state::{GlobalConfig, VestingState, VestingType};

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

    #[account(address = funder_token_account.mint)]
    pub mint: Account<'info, Mint>,

    #[account(
        mut,
        constraint = vesting_token_account.owner == vesting_state.key() @ VestingError::InvalidVaultOwner,
        constraint = vesting_token_account.mint == mint.key() @ VestingError::InvalidTokenMint
    )]
    pub vesting_token_account: Account<'info, TokenAccount>,

    #[account(
        seeds = [b"global_config"],
        bump
    )]
    pub global_config: Account<'info, GlobalConfig>,

    /// CHECK: Admin address from global config, used as authority for the ATA.
    #[account(address = global_config.admin @ VestingError::Unauthorized)]
    pub admin_address: UncheckedAccount<'info>,

    #[account(
        init_if_needed,
        payer = funder,
        associated_token::mint = mint,
        associated_token::authority = admin_address
    )]
    pub admin_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,

    pub associated_token_program: Program<'info, AssociatedToken>,

    pub system_program: Program<'info, System>,
}

pub fn create_stream_impl(
    ctx: Context<CreateVestingSchedule>,
    params: CreateVestingParams,
) -> Result<()> {
    require!(params.total_amount > 0, VestingError::InvalidAmount);
    require!(
        params.start_time < params.end_time,
        VestingError::InvalidTimeRange
    );
    require!(
        !(params.vesting_type == VestingType::Cliff && params.cliff_time > params.end_time),
        VestingError::CliffTimeExceedsEndTime
    );
    require!(
        !(params.vesting_type == VestingType::Milestone && params.milestone_count == 0),
        VestingError::MilestoneCountZero
    );

    let vesting_state = &mut ctx.accounts.vesting_state;
    vesting_state.recipient = ctx.accounts.recipient.key();
    vesting_state.funder = ctx.accounts.funder.key();
    let admin_fee = params
        .total_amount
        .checked_mul(5)
        .ok_or(VestingError::ArithmeticOverflow)?
        .checked_div(1000)
        .ok_or(VestingError::ArithmeticOverflow)?;

    let vesting_amount = params.total_amount;

    vesting_state.total_amount = vesting_amount;
    vesting_state.claimed_amount = 0;
    vesting_state.authority_revoker = ctx.accounts.funder.key();
    vesting_state.authority_milestone = ctx.accounts.funder.key();
    vesting_state.treasury_return_address = ctx.accounts.funder_token_account.key();
    vesting_state.vesting_type = params.vesting_type.clone();
    vesting_state.is_revoked = false;
    vesting_state.start_time = params.start_time;
    vesting_state.end_time = params.end_time;
    vesting_state.cliff_time = match params.vesting_type {
        VestingType::Cliff => params.cliff_time,
        _ => params.start_time,
    };
    vesting_state.milestone_count = match params.vesting_type {
        VestingType::Milestone => params.milestone_count,
        _ => 0,
    };
    vesting_state.milestones_reached = 0;
    vesting_state.bump = ctx.bumps.vesting_state;
    vesting_state.nonce = params.nonce;
    vesting_state.vested_amount_at_revocation = 0;

    // Transfer admin fee
    if admin_fee > 0 {
        let admin_cpi_accounts = Transfer {
            from: ctx.accounts.funder_token_account.to_account_info(),
            to: ctx.accounts.admin_token_account.to_account_info(),
            authority: ctx.accounts.funder.to_account_info(),
        };
        let admin_cpi_ctx =
            CpiContext::new(ctx.accounts.token_program.to_account_info(), admin_cpi_accounts);
        token::transfer(admin_cpi_ctx, admin_fee)?;
    }

    // Transfer vesting amount
    if vesting_amount > 0 {
        let cpi_accounts = Transfer {
            from: ctx.accounts.funder_token_account.to_account_info(),
            to: ctx.accounts.vesting_token_account.to_account_info(),
            authority: ctx.accounts.funder.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
        token::transfer(cpi_ctx, vesting_amount)?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_params_traits() {
        let params = CreateVestingParams {
            total_amount: 100,
            vesting_type: VestingType::Linear,
            start_time: 0,
            end_time: 100,
            cliff_time: 0,
            milestone_count: 0,
            nonce: 0,
        };
        let p2 = params.clone();
        assert_eq!(format!("{:?}", p2), format!("{:?}", params));
        
        let mut buf = Vec::new();
        params.serialize(&mut buf).unwrap();
        let p3 = CreateVestingParams::try_from_slice(&buf).unwrap();
        assert_eq!(p3.total_amount, 100);
    }
}
