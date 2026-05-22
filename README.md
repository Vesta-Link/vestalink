# VestaLink

Token distribution protocol on Solana that automates vesting, streaming, and scheduled token distribution.

> **Beta phase** — This project contains a fully implemented Anchor program supporting Linear, Cliff, and Milestone-based vesting schedules.

## Monorepo Structure

```
vestalink/
├── contract/            # Anchor (Solana) program
│   ├── programs/
│   │   └── vestalink/
│   │       └── src/
│   │           └── lib.rs
│   ├── tests/
│   │   └── vestalink.ts
│   ├── migrations/
│   ├── target/
│   ├── Anchor.toml
│   ├── Cargo.toml
│   ├── package.json
│   └── ...
├── frontend/            # Next.js app (coming soon)
├── raw_docs/            # Research and architecture documents
├── .github/
│   └── workflows/
│       └── ci.yml
└── README.md
```

## Prerequisites

| Tool       | Version       | Install                                                                                                       |
| ---------- | ------------- | ------------------------------------------------------------------------------------------------------------- |
| Rust       | 1.89.0        | Pinned via `rust-toolchain.toml` — install with [rustup](https://rustup.rs/)                                  |
| Solana CLI | 1.18.x        | `sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"`                                               |
| Anchor CLI | 0.32.1        | `cargo install --git https://github.com/coral-xyz/anchor avm --force && avm install 0.32.1 && avm use 0.32.1` |
| Node.js    | 20.x          | [nodejs.org](https://nodejs.org/) or via `nvm`                                                                |
| Yarn       | 1.x (Classic) | `npm install -g yarn`                                                                                         |

> **Note:** This project uses Anchor 0.32.1 (both the Rust crate and the TypeScript client). Solana CLI 1.18.x is recommended; Solana CLI 2.x is also compatible.

## Setup

### 1. Clone the repository

```bash
git clone <repo-url> vestalink
cd vestalink
```

### 2. Install contract dependencies

```bash
cd contract
yarn install
```

### 3. Configure Solana CLI for local development

Generate a keypair if you don't already have one:

```bash
solana-keygen new --no-bip39-passphrase
```

Set the CLI to use localhost:

```bash
solana config set --url localhost
```

### 4. Start a local validator (for testing)

```bash
solana-test-validator --reset
```

Leave this running in a separate terminal, or use `anchor test` which starts and stops a validator automatically.

## Build

From the `contract/` directory:

```bash
cd contract
anchor build
```

This produces:

- `target/deploy/vestalink.so` — compiled program binary
- `target/idl/vestalink.json` — program IDL
- `target/types/vestalink.ts` — TypeScript type definitions

## Deploy

From the `contract/` directory:

### Localnet (default)

```bash
anchor deploy
```

### Devnet

```bash
anchor deploy --provider.cluster devnet
```

Make sure your wallet has enough SOL on devnet:

```bash
solana airdrop 2 --url devnet
```

### Mainnet

```bash
anchor deploy --provider.cluster mainnet
```

> **Warning:** Mainnet deployment costs SOL and is irreversible. Only deploy to mainnet after thorough testing on devnet.

## Test

From the `contract/` directory:

```bash
cd contract
anchor test
```

To run tests against a specific cluster:

```bash
anchor test --provider.cluster devnet
```

To skip the validator and run tests against a running local validator:

```bash
anchor test --skip-local-validator
```

## Program Overview

VestaLink defines the following core instructions (with aliases for convenience):

| Instruction               | Aliases                                  | Description                                              |
| ------------------------- | ---------------------------------------- | -------------------------------------------------------- |
| `create_vesting_schedule` | `create_stream`                          | Create a new vesting schedule for a recipient            |
| `unlock_milestone`        |                                          | Unlock a milestone in a milestone-based vesting schedule |
| `claim`                   | `withdraw`, `claim_tokens`               | Claim vested tokens                                      |
| `cancel_vesting`          | `revoke_vesting`, `cancel_stream`        | Revoke a vesting schedule and return unvested tokens     |

### VestingState Account

Each vesting schedule is stored in a PDA account seeded by `["vesting", funder, recipient]` with the following fields:

| Field                     | Type        | Description                                              |
| ------------------------- | ----------- | -------------------------------------------------------- |
| `recipient`               | Pubkey      | Wallet address of the token recipient                    |
| `funder`                  | Pubkey      | Wallet address that funded the vesting schedule          |
| `total_amount`            | u64         | Total token amount to be distributed                     |
| `claimed_amount`          | u64         | Amount already claimed by recipient                      |
| `authority_revoker`       | Pubkey      | Authority that can revoke the vesting schedule           |
| `authority_milestone`     | Pubkey      | Authority that can unlock milestones                     |
| `treasury_return_address` | Pubkey      | Address where unvested tokens are returned on revocation |
| `vesting_type`            | VestingType | Enum: `Cliff`, `Linear`, or `Milestone`                  |
| `is_revoked`              | bool        | Whether the vesting schedule has been revoked            |
| `start_time`              | i64         | Unix timestamp when vesting begins                       |
| `end_time`                | i64         | Unix timestamp when vesting ends                         |
| `cliff_time`              | i64         | Unix timestamp for cliff unlock                          |
| `milestone_count`         | u8          | Total number of milestones                               |
| `milestones_reached`      | u8          | Number of milestones unlocked so far                     |
| `bump`                    | u8          | PDA bump seed                                            |
| `nonce`                   | u64         | Unique identifier to allow multiple schedules per pair   |
| `vested_amount_at_revocation` | u64     | Amount vested at the time of revocation                  |

## License

ISC
