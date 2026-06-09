use anchor_lang::prelude::*;
use anchor_lang::solana_program::clock::Clock;
use crate::error::VestingError;
use crate::utils::calculate_unlocked;

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

    pub fn current_unlocked_amount(&self) -> Result<u64> {
        if self.is_revoked {
            return Ok(self.vested_amount_at_revocation);
        }

        let current_time = Clock::get()?.unix_timestamp;

        match self.vesting_type {
            VestingType::Milestone => {
                if self.milestone_count == 0 {
                    return Ok(0);
                }
                Ok(self.total_amount
                    .checked_mul(self.milestones_reached as u64)
                    .ok_or(VestingError::ArithmeticOverflow)?
                    .checked_div(self.milestone_count as u64)
                    .ok_or(VestingError::ArithmeticOverflow)?)
            }
            _ => Ok(calculate_unlocked(
                self.total_amount,
                self.start_time,
                self.end_time,
                current_time,
                &self.vesting_type,
                self.cliff_time,
                self.milestone_count,
                self.milestones_reached,
            )),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_vesting_type_traits() {
        let t1 = VestingType::Cliff;
        let t2 = t1.clone();
        assert_eq!(t1, t2);
        assert_eq!(format!("{:?}", t1), "Cliff");
    }

    #[test]
    fn test_vesting_state_traits() {
        let state = VestingState {
            recipient: Pubkey::default(),
            funder: Pubkey::default(),
            total_amount: 1000,
            claimed_amount: 0,
            authority_revoker: Pubkey::default(),
            authority_milestone: Pubkey::default(),
            treasury_return_address: Pubkey::default(),
            vesting_type: VestingType::Milestone,
            is_revoked: false,
            start_time: 0,
            end_time: 100,
            cliff_time: 0,
            milestone_count: 4,
            milestones_reached: 1,
            bump: 255,
            nonce: 12345,
            vested_amount_at_revocation: 0,
        };
        let mut buf = Vec::new();
        state.try_serialize(&mut buf).unwrap();
        let state2 = VestingState::try_deserialize(&mut buf.as_slice()).unwrap();
        assert_eq!(state2.total_amount, 1000);
        assert_eq!(state2.nonce, 12345);
        assert_eq!(VestingState::SIZE, 256);
    }
}
