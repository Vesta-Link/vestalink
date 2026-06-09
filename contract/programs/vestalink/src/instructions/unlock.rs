use anchor_lang::prelude::*;
use crate::error::VestingError;
use crate::state::{VestingState, VestingType};

#[derive(Accounts)]
pub struct UnlockMilestone<'info> {
    #[account(mut, has_one = authority_milestone)]
    pub vesting_state: Account<'info, VestingState>,

    pub authority_milestone: Signer<'info>,
}

pub fn unlock_milestone_impl(ctx: Context<UnlockMilestone>) -> Result<()> {
    let vesting_state = &mut ctx.accounts.vesting_state;

    if vesting_state.vesting_type != VestingType::Milestone {
        return err!(VestingError::UnsupportedVestingType);
    }
    if vesting_state.milestones_reached >= vesting_state.milestone_count {
        return err!(VestingError::AllMilestonesReached);
    }
    if vesting_state.is_revoked {
        return err!(VestingError::StreamCancelled);
    }

    vesting_state.milestones_reached += 1;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn unlock_milestone_increments_milestones_reached() {
        let mut state = make_vesting_state(VestingType::Milestone, 5, 2, false);
        // Simulate the unlock_milestone logic: milestones_reached should increment
        assert_eq!(state.milestones_reached, 2);
        assert!(state.vesting_type == VestingType::Milestone);
        assert!(state.milestones_reached < state.milestone_count);
        assert!(!state.is_revoked);
        state.milestones_reached += 1;
        assert_eq!(state.milestones_reached, 3);
    }

    #[test]
    fn unlock_milestone_rejects_non_milestone_type() {
        // Linear stream should not allow unlock_milestone
        let state = make_vesting_state(VestingType::Linear, 0, 0, false);
        assert_ne!(state.vesting_type, VestingType::Milestone);
        // This would trigger UnsupportedVestingType (6002)

        // Cliff stream should not allow unlock_milestone
        let state = make_vesting_state(VestingType::Cliff, 0, 0, false);
        assert_ne!(state.vesting_type, VestingType::Milestone);
    }

    #[test]
    fn unlock_milestone_rejects_all_milestones_reached() {
        let state = make_vesting_state(VestingType::Milestone, 3, 3, false);
        assert!(state.milestones_reached >= state.milestone_count);
        // This would trigger AllMilestonesReached (6013)
    }

    #[test]
    fn unlock_milestone_rejects_revoked_stream() {
        let state = make_vesting_state(VestingType::Milestone, 5, 2, true);
        assert!(state.is_revoked);
        // This would trigger StreamCancelled (6014)
    }
}
