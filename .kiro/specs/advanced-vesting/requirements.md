# Requirements Document: Advanced Vesting

## Introduction

This feature extends the Vestalink Solana smart contract with three new vesting capabilities: cliff vesting, milestone-based vesting, and an improved cancel_stream instruction. The contract currently supports only linear vesting, despite having `Cliff` and `Milestone` enum variants and placeholder fields already defined. This feature activates those dormant code paths and adds a cancellation instruction with clearer error semantics.

## Glossary

- **Vestalink**: The Solana Anchor program that manages token vesting streams
- **Stream**: A vesting schedule that locks tokens and releases them over time or upon conditions
- **Funder**: The creator of a stream who deposits tokens and holds revocation authority
- **Recipient**: The beneficiary of a stream who can withdraw unlocked tokens
- **Cliff**: A vesting type where zero tokens unlock before a specified cliff date, after which linear vesting applies retroactively from the start time
- **Milestone**: A vesting type where tokens unlock in discrete tranches when the `authority_milestone` signer triggers each milestone
- **Cancel**: An instruction that terminates a stream, distributing vested tokens to the recipient and returning unvested tokens to the funder
- **Revoke**: The existing instruction that terminates a stream (renamed conceptually to "cancel" with improved error handling)
- **authority_milestone**: The signer authorized to trigger milestone unlocks for a stream
- **authority_revoker**: The signer authorized to cancel a stream (currently the funder)

## Requirements

### Requirement 1: Cliff Vesting

**User Story:** As a funder, I want to create a cliff vesting stream so that the recipient receives zero tokens before the cliff date and linear vesting applies after the cliff.

#### Acceptance Criteria

1. WHEN a funder creates a stream with `VestingType::Cliff` and a `cliff_time` after `start_time`, THE Vestalink SHALL store the `cliff_time` and accept the stream
2. WHEN the current time is before or equal to `cliff_time`, THE Vestalink SHALL return zero as the unlocked amount for a cliff stream
3. WHEN the current time is after `cliff_time`, THE Vestalink SHALL calculate the unlocked amount using the linear vesting formula from `start_time` to `end_time`
4. WHEN a funder creates a cliff stream with `cliff_time` equal to `start_time`, THE Vestalink SHALL behave identically to a linear stream (no cliff period)
5. WHEN a funder creates a cliff stream with `cliff_time` after `end_time`, THE Vestalink SHALL reject the stream with error code 6011

### Requirement 2: Milestone-Based Vesting

**User Story:** As a funder, I want to create a milestone-based vesting stream so that tokens unlock in discrete tranches only when the `authority_milestone` signer triggers each milestone.

#### Acceptance Criteria

1. WHEN a funder creates a stream with `VestingType::Milestone` and a `milestone_count` greater than zero, THE Vestalink SHALL store the `milestone_count` and accept the stream
2. WHEN a funder creates a milestone stream with `milestone_count` of zero, THE Vestalink SHALL reject the stream with error code 6012
3. WHEN `authority_milestone` calls `unlock_milestone` on a milestone stream, THE Vestalink SHALL increment `milestones_reached` by one
4. WHEN the unlocked amount is calculated for a milestone stream, THE Vestalink SHALL return `total_amount * milestones_reached / milestone_count` using floor division
5. WHEN `milestones_reached` equals `milestone_count`, THE Vestalink SHALL return `total_amount` as the unlocked amount
6. WHEN `authority_milestone` calls `unlock_milestone` after all milestones are already reached, THE Vestalink SHALL reject the call with error code 6013
7. WHEN a non-authorized signer calls `unlock_milestone`, THE Vestalink SHALL reject the call with error code 6003

### Requirement 3: Cancel Stream Instruction

**User Story:** As a funder, I want to cancel a stream so that the recipient keeps already-vested tokens and I receive back the unvested portion, with clear error codes for edge cases.

#### Acceptance Criteria

1. WHEN the `authority_revoker` calls `cancel_stream` on an active stream, THE Vestalink SHALL transfer unvested tokens to the `treasury_return_address`, set `is_revoked` to true, and record `vested_amount_at_revocation`
2. WHEN `cancel_stream` is called on an already-cancelled stream, THE Vestalink SHALL reject the call with error code 6014
3. WHEN `cancel_stream` is called on a stream where all tokens are fully vested, THE Vestalink SHALL reject the call with error code 6015
4. WHEN a non-authorized signer calls `cancel_stream`, THE Vestalink SHALL reject the call with error code 6003
5. WHEN a cancelled stream's recipient calls `withdraw`, THE Vestalink SHALL allow withdrawal of the amount that was vested at the time of cancellation

### Requirement 4: Error Code Completeness

**User Story:** As a developer integrating with Vestalink, I want distinct error codes for every failure case so that I can handle errors precisely in my client application.

#### Acceptance Criteria

1. THE Vestalink SHALL define error code 6011 with message "Cliff time must not exceed end time"
2. THE Vestalink SHALL define error code 6012 with message "Milestone count must be greater than zero"
3. THE Vestalink SHALL define error code 6013 with message "All milestones have already been reached"
4. THE Vestalink SHALL define error code 6014 with message "Stream has already been cancelled"
5. THE Vestalink SHALL define error code 6015 with message "Stream is fully vested and cannot be cancelled"
6. THE Vestalink SHALL define error code 6016 with message "Stream has expired"

### Requirement 5: Backward Compatibility

**User Story:** As a developer maintaining existing integrations, I want all existing tests and behaviors to continue working so that my current deployments are not disrupted.

#### Acceptance Criteria

1. WHEN a stream is created with `VestingType::Linear`, THE Vestalink SHALL behave identically to the current implementation
2. WHEN `revoke_vesting` or `cancel_vesting` is called, THE Vestalink SHALL behave identically to the current implementation
3. WHEN `withdraw`, `claim`, or `claim_tokens` is called on a linear stream, THE Vestalink SHALL behave identically to the current implementation
4. THE Vestalink SHALL preserve all existing error codes (6000-6010) with their current messages and semantics