use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::error::VestingError;
use crate::state::VestingState;

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

#[cfg_attr(coverage_nightly, coverage(off))]
pub fn withdraw_impl(ctx: Context<Withdraw>) -> Result<()> {
    let vesting_state = &ctx.accounts.vesting_state;
    let unlocked_amount = vesting_state.current_unlocked_amount()?;
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
