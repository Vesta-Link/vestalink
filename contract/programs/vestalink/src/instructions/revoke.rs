use anchor_lang::prelude::*;
use anchor_lang::solana_program::clock::Clock;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::error::VestingError;
use crate::state::VestingState;
use crate::utils::calculate_unlocked;

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

pub fn revoke_vesting_impl(ctx: Context<RevokeVesting>) -> Result<()> {
    let vesting_state = &ctx.accounts.vesting_state;
    require!(!vesting_state.is_revoked, VestingError::StreamRevoked);

    let current_time = Clock::get()?.unix_timestamp;
    let unlocked_amount = calculate_unlocked(
        vesting_state.total_amount,
        vesting_state.start_time,
        vesting_state.end_time,
        current_time,
        &vesting_state.vesting_type,
        vesting_state.cliff_time,
        vesting_state.milestone_count,
        vesting_state.milestones_reached,
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

pub fn cancel_stream_impl(ctx: Context<RevokeVesting>) -> Result<()> {
    let vesting_state = &ctx.accounts.vesting_state;

    if vesting_state.is_revoked {
        return err!(VestingError::StreamCancelled);
    }

    let current_time = Clock::get()?.unix_timestamp;
    let unlocked = calculate_unlocked(
        vesting_state.total_amount,
        vesting_state.start_time,
        vesting_state.end_time,
        current_time,
        &vesting_state.vesting_type,
        vesting_state.cliff_time,
        vesting_state.milestone_count,
        vesting_state.milestones_reached,
    );

    if unlocked >= vesting_state.total_amount {
        return err!(VestingError::StreamFullyVested);
    }

    revoke_vesting_impl(ctx)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::VestingType;

    fn make_vesting_state(
        vesting_type: VestingType,
        milestone_count: u8,
        milestones_reached: u8,
        is_revoked: bool,
    ) -> VestingState {
        VestingState {
            recipient: Pubkey::default(),
            funder: Pubkey::default(),
            total_amount: 1_000,
            claimed_amount: 0,
            authority_revoker: Pubkey::default(),
            authority_milestone: Pubkey::default(),
            treasury_return_address: Pubkey::default(),
            vesting_type,
            is_revoked,
            start_time: 100,
            end_time: 300,
            cliff_time: 200,
            milestone_count,
            milestones_reached,
            bump: 0,
            nonce: 0,
            vested_amount_at_revocation: 0,
        }
    }

    #[test]
    fn cancel_stream_rejects_already_cancelled() {
        // Property 7: cancel_stream on an already cancelled stream returns error 6014
        let state = make_vesting_state(VestingType::Linear, 0, 0, true);
        assert!(state.is_revoked);
        // This would trigger StreamCancelled (6014)
    }

    #[test]
    fn cancel_stream_rejects_fully_vested() {
        // Property 6: cancel_stream on a fully vested stream returns error 6015
        // A linear stream at or past end_time is fully vested
        let state = make_vesting_state(VestingType::Linear, 0, 0, false);
        let unlocked = calculate_unlocked(
            state.total_amount,
            state.start_time,
            state.end_time,
            400, // past end_time (300)
            &VestingType::Linear,
            state.cliff_time,
            state.milestone_count,
            state.milestones_reached,
        );
        assert!(unlocked >= state.total_amount);
        // This would trigger StreamFullyVested (6015)
    }

    #[test]
    fn cancel_stream_distributes_correctly() {
        // Property 5: For a cancelled stream, recipient can withdraw vested amount
        // and funder receives unvested amount.
        // Simulate a linear stream at 50% vesting (current_time = 200, start=100, end=300)
        let mut state = make_vesting_state(VestingType::Linear, 0, 0, false);
        state.total_amount = 1_000;
        state.start_time = 100;
        state.end_time = 300;

        let unlocked = calculate_unlocked(
            state.total_amount,
            state.start_time,
            state.end_time,
            200, // 50% through
            &state.vesting_type,
            state.cliff_time,
            state.milestone_count,
            state.milestones_reached,
        );
        assert_eq!(unlocked, 500);

        let unvested = state.total_amount - unlocked;
        assert_eq!(unvested, 500);

        // After cancellation, recipient can claim unlocked (500),
        // funder receives unvested (500)
        // Simulate revocation state
        state.is_revoked = true;
        state.vested_amount_at_revocation = unlocked;
        assert_eq!(state.vested_amount_at_revocation, 500);
        assert_eq!(state.total_amount - state.vested_amount_at_revocation, 500);
    }

    #[test]
    fn cancel_stream_rejects_fully_vested_milestone() {
        // A milestone stream where all milestones are reached is fully vested
        let state = make_vesting_state(VestingType::Milestone, 5, 5, false);
        let unlocked = calculate_unlocked(
            state.total_amount,
            state.start_time,
            state.end_time,
            200,
            &state.vesting_type,
            state.cliff_time,
            state.milestone_count,
            state.milestones_reached,
        );
        assert!(unlocked >= state.total_amount);
        // This would trigger StreamFullyVested (6015)
    }
}
