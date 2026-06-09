use anchor_lang::prelude::*;

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
    #[msg("Cliff time must not exceed end time")]
    CliffTimeExceedsEndTime,
    #[msg("Milestone count must be greater than zero")]
    MilestoneCountZero,
    #[msg("All milestones have already been reached")]
    AllMilestonesReached,
    #[msg("Stream has already been cancelled")]
    StreamCancelled,
    #[msg("Stream is fully vested and cannot be cancelled")]
    StreamFullyVested,
    #[msg("Stream has expired")]
    StreamExpired,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_code_cliff_time_exceeds_end_time() {
        assert_eq!(VestingError::CliffTimeExceedsEndTime as u32, 11);
    }

    #[test]
    fn error_code_milestone_count_zero() {
        assert_eq!(VestingError::MilestoneCountZero as u32, 12);
    }

    #[test]
    fn error_code_unsupported_vesting_type_preserved() {
        assert_eq!(VestingError::UnsupportedVestingType as u32, 2);
    }

    #[test]
    fn error_code_all_milestones_reached() {
        assert_eq!(VestingError::AllMilestonesReached as u32, 13);
    }

    #[test]
    fn error_code_stream_cancelled() {
        assert_eq!(VestingError::StreamCancelled as u32, 14);
    }

    #[test]
    fn error_code_stream_fully_vested() {
        assert_eq!(VestingError::StreamFullyVested as u32, 15);
    }

    #[test]
    fn test_vesting_error_traits() {
        assert_eq!(VestingError::InvalidAmount.to_string(), "Amount must be greater than zero");
        assert_eq!(VestingError::InvalidTimeRange.to_string(), "Start time must be before end time");
        assert_eq!(VestingError::UnsupportedVestingType.to_string(), "Only linear vesting is supported");
        assert_eq!(VestingError::UnauthorizedClaimant.to_string(), "Only the stream recipient can withdraw from this stream");
        assert_eq!(VestingError::InsufficientUnlockedTokens.to_string(), "No unlocked tokens are available to withdraw");
        assert_eq!(VestingError::StreamRevoked.to_string(), "Vesting stream has already been revoked");
        assert_eq!(VestingError::ArithmeticOverflow.to_string(), "Arithmetic overflow");
        assert_eq!(VestingError::InvalidVaultOwner.to_string(), "Vault token account must be owned by the vesting PDA");
        assert_eq!(VestingError::InvalidTokenMint.to_string(), "Token account mint does not match the vesting mint");
        assert_eq!(VestingError::InvalidTokenOwner.to_string(), "Token account owner is invalid");
        assert_eq!(VestingError::InvalidTreasuryReturnAddress.to_string(), "Treasury return address does not match the stream");
        assert_eq!(VestingError::CliffTimeExceedsEndTime.to_string(), "Cliff time must not exceed end time");
        assert_eq!(VestingError::MilestoneCountZero.to_string(), "Milestone count must be greater than zero");
        assert_eq!(VestingError::AllMilestonesReached.to_string(), "All milestones have already been reached");
        assert_eq!(VestingError::StreamCancelled.to_string(), "Stream has already been cancelled");
        assert_eq!(VestingError::StreamFullyVested.to_string(), "Stream is fully vested and cannot be cancelled");
        assert_eq!(VestingError::StreamExpired.to_string(), "Stream has expired");
    }
}
