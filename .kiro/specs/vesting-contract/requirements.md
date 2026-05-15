# Requirements Document

## Introduction

VestaLink is a token distribution protocol on Solana. This spec covers the **vesting-contract** feature — implementing the core on-chain business logic for creating linear vesting streams and claiming unlocked tokens. The scaffold phase (completed) established the Anchor project structure, account definitions, and empty instruction handlers. This phase fills in the real logic: token transfers, linear unlock calculations, claim mechanics, and authorization enforcement.

The scope is limited to **linear vesting** (tokens unlock continuously over time). Cliff and Milestone vesting types are deferred to future specs.

## Glossary

- **VestaLink**: The token distribution protocol on Solana
- **VestingState**: The PDA account storing vesting schedule data, seeded by `["vesting", funder, recipient, nonce]`
- **Nonce**: A u64 value that differentiates multiple vesting streams between the same funder and recipient
- **Creator**: The wallet that funds a vesting stream (called `funder` in the on-chain account)
- **Recipient**: The wallet designated to receive vested tokens over time
- **Stream**: A vesting schedule — tokens locked in a PDA vault that unlock linearly for a recipient
- **Linear Unlock**: Unlock formula: `unlocked_amount = total_amount × (elapsed_time / duration)`, where `elapsed_time = max(0, current_time - start_time)` and `duration = end_time - start_time`
- **Claim**: The instruction that allows a recipient to withdraw unlocked tokens from the vesting PDA vault
- **PDA Vault**: The Associated Token Account owned by the VestingState PDA, holding the locked SPL tokens
- **Anchor**: Solana development framework for writing Rust programs with IDL generation
- **CPI**: Cross-Program Invocation — Solana's mechanism for programs calling other programs (used for SPL Token transfers)
- **SPL Token Program**: Solana's standard program for managing fungible tokens
- **Clock Sysvar**: Solana's on-chain clock providing the current Unix timestamp

## Requirements

### Requirement 1: Create Vesting Stream

**User Story:** As a creator, I want to lock tokens into a vesting stream for a recipient, so that tokens are distributed to them linearly over time.

#### Acceptance Criteria

1. WHEN a creator calls `create_vesting_schedule` with a valid recipient, total_amount, start_time, end_time, and nonce, THE VestingContract SHALL create a VestingState PDA account with the specified parameters and set `vesting_type` to `Linear`
2. WHEN `create_vesting_schedule` is invoked, THE VestingContract SHALL transfer `total_amount` SPL tokens from the funder's token account to the PDA vault
3. WHEN `create_vesting_schedule` succeeds, THE VestingContract SHALL set `claimed_amount` to 0 and `is_revoked` to false on the VestingState account
4. WHEN `create_vesting_schedule` is invoked with `start_time` greater than or equal to `end_time`, THE VestingContract SHALL reject the transaction and return error `InvalidTimeRange`
5. WHEN `create_vesting_schedule` is invoked with `total_amount` of 0, THE VestingContract SHALL reject the transaction and return error `InvalidAmount`
6. WHEN `create_vesting_schedule` is invoked with `vesting_type` set to a value other than `Linear`, THE VestingContract SHALL reject the transaction and return error `UnsupportedVestingType`
7. WHEN `create_vesting_schedule` is invoked with `start_time` equal to `end_time`, THE VestingContract SHALL reject the transaction and return error `InvalidTimeRange`
8. WHEN `create_vesting_schedule` is invoked with `total_amount` that exceeds the funder's token balance, THE VestingContract SHALL reject the transaction and the SPL Token Program SHALL return an insufficient balance error

### Requirement 2: Multiple Streams Per Recipient

**User Story:** As a creator, I want to create multiple vesting streams for the same recipient, so that I can set up different vesting schedules (e.g., monthly grants with different durations).

#### Acceptance Criteria

1. WHEN a creator creates multiple vesting streams for the same recipient with different nonces, THE VestingContract SHALL create each stream as a separate VestingState PDA account
2. WHEN a creator creates multiple streams for the same recipient, THE VestingContract SHALL allow each stream to be claimed independently by the recipient

### Requirement 3: Token Locking in PDA

**User Story:** As a recipient, I want tokens locked in a PDA-controlled vault, so that the creator cannot withdraw them back.

#### Acceptance Criteria

1. WHEN tokens are transferred into the PDA vault via `create_vesting_schedule`, THE VestingContract SHALL store them in an Associated Token Account owned by the VestingState PDA
2. WHILE the vesting stream is active (not revoked), THE VestingContract SHALL prevent the creator from withdrawing tokens from the PDA vault
3. WHEN a VestingState account exists, THE VestingContract SHALL ensure that only the `claim` instruction can move tokens out of the PDA vault (for a non-revoked stream)

### Requirement 4: Linear Unlock Calculation

**User Story:** As a recipient, I want tokens to unlock linearly over time, so that I can claim a fair portion of my tokens at any point during the vesting period.

#### Acceptance Criteria

1. WHEN the current time is before `start_time`, THE VestingContract SHALL calculate `unlocked_amount` as 0
2. WHEN the current time is between `start_time` and `end_time`, THE VestingContract SHALL calculate `unlocked_amount` as `total_amount × (current_time - start_time) / (end_time - start_time)` using integer arithmetic
3. WHEN the current time is at or after `end_time`, THE VestingContract SHALL calculate `unlocked_amount` as `total_amount`
4. WHEN calculating `unlocked_amount`, THE VestingContract SHALL use the Solana `Clock` sysvar to obtain the current Unix timestamp
5. WHEN calculating `unlocked_amount` with integer division, THE VestingContract SHALL truncate (floor) the result, ensuring `unlocked_amount` never exceeds the true proportional share

### Requirement 5: Claim (Withdraw) Unlocked Tokens

**User Story:** As a recipient, I want to claim my unlocked tokens at any time, so that I have access to tokens as they vest.

#### Acceptance Criteria

1. WHEN a recipient calls `claim` on an active vesting stream, THE VestingContract SHALL transfer `unlocked_amount - claimed_amount` tokens from the PDA vault to the recipient's token account
2. WHEN `claim` succeeds, THE VestingContract SHALL update `claimed_amount` on the VestingState account to reflect the total claimed so far
3. WHEN `unlocked_amount` equals `claimed_amount` (nothing new to claim), THE VestingContract SHALL complete the `claim` instruction successfully without transferring any tokens

### Requirement 6: Partial Withdrawals

**User Story:** As a recipient, I want to claim some of my unlocked tokens now and more later, so that I have flexibility in when I access my tokens.

#### Acceptance Criteria

1. WHEN a recipient claims a portion of their unlocked tokens and later calls `claim` again, THE VestingContract SHALL transfer only the newly unlocked amount (`unlocked_amount - claimed_amount`)
2. WHEN multiple partial claims are made over time, THE VestingContract SHALL ensure the sum of all claimed amounts equals the total unlocked amount at each claim point

### Requirement 7: Unauthorized Withdrawal Prevention

**User Story:** As a recipient, I want only myself to be able to claim tokens from my vesting stream, so that my tokens are secure from unauthorized access.

#### Acceptance Criteria

1. WHEN a wallet that is not the recipient calls `claim` on a vesting stream, THE VestingContract SHALL reject the transaction and return error `UnauthorizedClaimant`
2. WHEN a wallet that is not the recipient calls `claim`, THE VestingContract SHALL not transfer any tokens

### Requirement 8: Over-Withdrawal Prevention

**User Story:** As a creator, I want recipients to only claim tokens that have actually unlocked, so that the vesting schedule is enforced on-chain.

#### Acceptance Criteria

1. WHEN a recipient attempts to claim more tokens than `unlocked_amount - claimed_amount`, THE VestingContract SHALL reject the transaction and return error `InsufficientUnlockedTokens`
2. WHEN the `claim` instruction is invoked, THE VestingContract SHALL verify that the transfer amount does not exceed `unlocked_amount - claimed_amount`

### Requirement 9: Revoked Stream Handling

**User Story:** As a recipient, I want clarity on what happens if my vesting stream is revoked, so that I understand my claim rights.

#### Acceptance Criteria

1. WHEN `claim` is called on a revoked vesting stream, THE VestingContract SHALL reject the transaction and return error `StreamRevoked`
2. WHEN a stream is revoked, THE VestingContract SHALL not allow any further claims regardless of how many tokens remain unlocked

### Requirement 10: Unit Tests

**User Story:** As a developer, I want comprehensive unit tests covering all vesting logic and edge cases, so that I can verify correctness before deploying to devnet.

#### Acceptance Criteria

1. THE TestSuite SHALL include a test that creates a vesting stream and verifies the VestingState account fields
2. THE TestSuite SHALL include a test that verifies `unlocked_amount` is 0 at 0% elapsed time (before start)
3. THE TestSuite SHALL include a test that verifies `unlocked_amount` is approximately 25% of `total_amount` at 25% elapsed time
4. THE TestSuite SHALL include a test that verifies `unlocked_amount` is approximately 50% of `total_amount` at 50% elapsed time
5. THE TestSuite SHALL include a test that verifies `unlocked_amount` equals `total_amount` at 100% elapsed time
6. THE TestSuite SHALL include a test that verifies a partial claim transfers the correct amount and updates `claimed_amount`
7. THE TestSuite SHALL include a test that verifies a full claim (after vesting ends) transfers the entire `total_amount`
8. THE TestSuite SHALL include a test that verifies an unauthorized claim attempt returns error `UnauthorizedClaimant`
9. THE TestSuite SHALL include a test that verifies claiming before any tokens unlock returns error `InsufficientUnlockedTokens`
10. THE TestSuite SHALL include a test that verifies creating a stream with `total_amount` of 0 returns error `InvalidAmount`
11. THE TestSuite SHALL include a test that verifies creating a stream with `start_time` >= `end_time` returns error `InvalidTimeRange`
12. THE TestSuite SHALL include a test that verifies creating a stream with `start_time` equal to `end_time` returns error `InvalidTimeRange`
13. THE TestSuite SHALL include a test that verifies creating multiple streams for the same funder-recipient pair with different nonces succeeds independently
14. THE TestSuite SHALL include a test that verifies claiming from a revoked stream returns error `StreamRevoked`
15. THE TestSuite SHALL include a test that verifies claiming with zero newly unlocked tokens completes successfully without transferring tokens
16. THE TestSuite SHALL include a test that verifies integer truncation in the unlock calculation never yields an amount exceeding the true proportional share

### Requirement 11: Devnet Deployment

**User Story:** As a developer, I want the contract deployed to devnet, so that I can manually test the on-chain behavior end-to-end.

#### Acceptance Criteria

1. WHEN the deployment process is executed, THE VestingContract SHALL compile and deploy to Solana devnet without errors
2. WHEN deployed to devnet, THE VestingContract SHALL respond to `create_vesting_schedule` and `claim` instructions with the same behavior as localnet tests