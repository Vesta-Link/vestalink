# Requirements Document

## Introduction

VestaLink is a token distribution protocol on Solana that automates vesting, streaming, and scheduled token distribution. This spec covers the **scaffold phase only** — initializing the Anchor project, defining account structs and empty instruction handlers, setting up documentation, CI, and a basic passing test. No business logic is implemented at this stage.

## Glossary

- **VestaLink**: The token distribution protocol on Solana
- **Anchor**: Solana development framework for writing Rust programs with IDL generation
- **PDA**: Program Derived Address — deterministic Solana addresses derived from seeds
- **VestingState**: The PDA account storing vesting schedule data per recipient
- **ATA**: Associated Token Account — standard SPL token account for a wallet
- **CPI**: Cross-Program Invocation — Solana's mechanism for programs calling other programs
- **SPL Token Program**: Solana's standard program for managing fungible tokens
- **Instruction Handler**: An Anchor program function that processes a specific instruction
- **Scaffold**: The initial project setup with structure but no business logic

## Requirements

### Requirement 1: Anchor Project Initialization

**User Story:** As a developer, I want an Anchor project that compiles cleanly, so that I have a reliable starting point for building the VestaLink protocol.

#### Acceptance Criteria

1. THE Scaffold SHALL initialize an Anchor project with the standard directory layout (`programs/`, `tests/`, `migrations/`)
2. WHEN the `anchor build` command is executed, THE Scaffold SHALL produce a compiled `.so` file without errors
3. WHEN the `anchor test` command is executed, THE Scaffold SHALL complete without compilation errors

### Requirement 2: Instruction Handlers

**User Story:** As a developer, I want empty instruction handlers for each protocol action, so that I can implement business logic incrementally without breaking the build.

#### Acceptance Criteria

1. THE Scaffold SHALL define an instruction handler named `create_vesting_schedule` that compiles without business logic
2. THE Scaffold SHALL define an instruction handler named `unlock_milestone` that compiles without business logic
3. THE Scaffold SHALL define an instruction handler named `claim` that compiles without business logic
4. THE Scaffold SHALL define an instruction handler named `cancel_vesting` that compiles without business logic
5. WHEN any instruction handler is invoked, THE Scaffold SHALL accept the call without modifying account data

### Requirement 3: Account Structs

**User Story:** As a developer, I want the VestingState account struct defined upfront, so that the data model is established before implementing business logic.

#### Acceptance Criteria

1. THE Scaffold SHALL define a `VestingState` account struct with a `recipient` field of type `Pubkey`
2. THE Scaffold SHALL define a `VestingState` account struct with a `funder` field of type `Pubkey`
3. THE Scaffold SHALL define a `VestingState` account struct with a `total_amount` field of type `u64`
4. THE Scaffold SHALL define a `VestingState` account struct with a `claimed_amount` field of type `u64`
5. THE Scaffold SHALL define a `VestingState` account struct with an `authority_revoker` field of type `Pubkey`
6. THE Scaffold SHALL define a `VestingState` account struct with an `authority_milestone` field of type `Pubkey`
7. THE Scaffold SHALL define a `VestingState` account struct with a `treasury_return_address` field of type `Pubkey`
8. THE Scaffold SHALL define a `VestingState` account struct with a `vesting_type` field as an enum with variants `Cliff`, `Linear`, and `Milestone`
9. THE Scaffold SHALL define a `VestingState` account struct with an `is_revoked` field of type `bool`
10. THE Scaffold SHALL define a `VestingState` account struct with a `start_time` field of type `i64`
11. THE Scaffold SHALL define a `VestingState` account struct with an `end_time` field of type `i64`
12. THE Scaffold SHALL define a `VestingState` account struct with a `cliff_time` field of type `i64`
13. THE Scaffold SHALL define a `VestingState` account struct with a `milestone_count` field of type `u8`
14. THE Scaffold SHALL define a `VestingState` account struct with a `milestones_reached` field of type `u8`

### Requirement 4: README Documentation

**User Story:** As a developer joining the project, I want a comprehensive README, so that I can set up my environment and start contributing without tribal knowledge.

#### Acceptance Criteria

1. THE Scaffold SHALL include a README.md file in the project root
2. THE README SHALL document all prerequisites (Rust, Solana CLI, Anchor CLI, Node.js)
3. THE README SHALL include setup steps for cloning and installing dependencies
4. THE README SHALL include instructions for building the project (`anchor build`)
5. THE README SHALL include instructions for deploying to devnet (`anchor deploy`)
6. THE README SHALL include instructions for running tests (`anchor test`)

### Requirement 5: Passing Test

**User Story:** As a developer, I want at least one passing test, so that I can verify the program deploys correctly and the test infrastructure works.

#### Acceptance Criteria

1. THE Scaffold SHALL include at least one test file in the `tests/` directory
2. WHEN the test suite is executed, THE Scaffold SHALL include at least one test that passes
3. THE passing test SHALL verify that the program deploys successfully to a local validator

### Requirement 6: CI Pipeline

**User Story:** As a developer, I want automated builds and tests on every push, so that regressions are caught early.

#### Acceptance Criteria

1. THE Scaffold SHALL include a GitHub Actions workflow file in `.github/workflows/`
2. WHEN code is pushed to the repository, THE CI Pipeline SHALL trigger a build
3. WHEN the CI Pipeline runs, THE CI Pipeline SHALL execute `anchor build` and `anchor test`
4. THE CI Pipeline SHALL use a Solana/Anchor-compatible runner environment

### Requirement 7: Cloneability

**User Story:** As a developer joining the project, I want the scaffold to be fully reproducible, so that I can build and deploy by following the README alone.

#### Acceptance Criteria

1. WHEN a developer clones the repository and follows the README setup steps, THE Scaffold SHALL enable successful `anchor build`
2. WHEN a developer follows the README deploy steps, THE Scaffold SHALL enable successful deployment to devnet