# VestaLink

Token distribution protocol on Solana that automates vesting, streaming, and scheduled token distribution.

> **Beta phase** — This project contains a fully implemented Anchor program supporting Linear, Cliff, and Milestone-based vesting schedules. It also includes a modern Next.js frontend with bulk stream creation, admin fee processing, and multi-language support.

## Monorepo Structure

```
vestalink/
├── contract/            # Anchor (Solana) program
│   ├── programs/
│   │   └── vestalink/
│   │       └── src/
│   │           └── lib.rs
│   ├── tests/
│   ├── migrations/
│   ├── target/
│   ├── Anchor.toml
│   ├── Cargo.toml
│   ├── package.json
│   └── ...
├── frontend/            # Next.js app
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
| Yarn / npm | 1.x / 10.x    | `npm install -g yarn` (contract uses Yarn, frontend uses npm)                                                 |

> **Note:** This project uses Anchor 0.32.1 (both the Rust crate and the TypeScript client). Solana CLI 1.18.x is recommended; Solana CLI 2.x is also compatible.

## Setup

### 1. Clone the repository

```bash
git clone <repo-url> vestalink
cd vestalink
```

### 2. Install dependencies

**Contract:**

```bash
cd contract
yarn install
```

**Frontend:**

```bash
cd ../frontend
npm install
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

## Frontend

The Next.js application is located in the `frontend/` directory.

### Running locally

```bash
cd frontend
cp .env.example .env.local
# Set NEXT_PUBLIC_ADMIN_ADDRESS to your devnet wallet or local test key
npm run dev
```

The app will be available at [http://localhost:3000](http://localhost:3000).

## Instruction Reference

VestaLink defines the following core instructions.

### 1. `create_stream`
Creates a new vesting schedule and locks tokens in a program-derived vault.

- **Parameters (`CreateVestingParams`)**:
  - `total_amount` (`u64`): Total token amount to vest.
  - `vesting_type` (`VestingType`): `Linear`, `Cliff`, or `Milestone`.
  - `start_time` (`i64`): Unix timestamp when vesting begins.
  - `end_time` (`i64`): Unix timestamp when vesting ends.
  - `cliff_time` (`i64`): Unix timestamp for the cliff (if applicable).
  - `milestone_count` (`u8`): Total number of milestones (if applicable).
  - `nonce` (`u64`): Unique ID to allow multiple streams between the same funder and recipient.
- **Expected Behavior**: Initializes a `VestingState` PDA. Transfers `total_amount` of tokens from the funder's token account to the vesting PDA's token vault, while processing a protocol fee (e.g., 0.5%) sent to the admin address.
- **Error Codes**: `InvalidAmount`, `InvalidTimeRange`, `CliffTimeExceedsEndTime`, `MilestoneCountZero`, `InvalidVaultOwner`, `InvalidTokenMint`, `InvalidTokenOwner`.
- **Example Usage**:
  ```typescript
  await program.methods.createStream({
    totalAmount: new anchor.BN(1000000),
    vestingType: { linear: {} },
    startTime: new anchor.BN(Math.floor(Date.now() / 1000)),
    endTime: new anchor.BN(Math.floor(Date.now() / 1000) + 86400),
    cliffTime: new anchor.BN(Math.floor(Date.now() / 1000)),
    milestoneCount: 0,
    nonce: new anchor.BN(1),
  })
  .accountsPartial({
    vestingState: vestingStatePda,
    funder: funderPublicKey,
    recipient: recipientPublicKey,
    funderTokenAccount: funderTokenAccountAddress,
    mint: tokenMintAddress,
    vestingTokenAccount: vaultTokenAccountAddress,
    globalConfig: globalConfigPda,
    adminAddress: adminPublicKey,
    adminTokenAccount: adminTokenAccountAddress,
    tokenProgram: TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: anchor.web3.SystemProgram.programId,
  })
  .rpc();
  ```

### 2. `unlock_milestone`
Unlocks the next milestone for a milestone-based vesting schedule.

- **Parameters**: None.
- **Expected Behavior**: Increments `milestones_reached` by 1. Only callable by the `authority_milestone`.
- **Error Codes**: `UnsupportedVestingType`, `AllMilestonesReached`, `StreamCancelled`.
- **Example Usage**:
  ```typescript
  await program.methods.unlockMilestone()
    .accountsPartial({
      vestingState: vestingStatePda,
      authorityMilestone: funderPublicKey,
    })
    .rpc();
  ```

### 3. `withdraw`
Allows the recipient to claim their currently unlocked tokens.

- **Parameters**: None.
- **Expected Behavior**: Calculates the currently unlocked tokens, subtracts already claimed tokens, and transfers the difference from the vault to the recipient's token account. Updates `claimed_amount`.
- **Error Codes**: `UnauthorizedClaimant`, `InvalidTokenOwner`, `InvalidTokenMint`, `InvalidVaultOwner`, `InsufficientUnlockedTokens`, `ArithmeticOverflow`.
- **Example Usage**:
  ```typescript
  await program.methods.withdraw()
    .accountsPartial({
      vestingState: vestingStatePda,
      recipient: recipientPublicKey,
      recipientTokenAccount: recipientTokenAccountAddress,
      vestingTokenAccount: vaultTokenAccountAddress,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([recipientKeypair])
    .rpc();
  ```

### 4. `revoke_vesting`
Revokes an active vesting schedule.

- **Parameters**: None.
- **Expected Behavior**: Marks the stream as revoked (`is_revoked = true`) and transfers any unvested tokens from the vault to the `treasury_return_address`. Unlocked tokens remain in the vault for the recipient to claim later.
- **Error Codes**: `InvalidTreasuryReturnAddress`, `InvalidTokenMint`, `InvalidVaultOwner`, `StreamRevoked`, `ArithmeticOverflow`.
- **Example Usage**:
  ```typescript
  await program.methods.revokeVesting()
    .accountsPartial({
      vestingState: vestingStatePda,
      authorityRevoker: funderPublicKey,
      treasuryReturnAddress: funderTokenAccountAddress,
      vestingTokenAccount: vaultTokenAccountAddress,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
  ```

### 5. `cancel_stream`
A stricter version of revoking a stream.

- **Parameters**: None.
- **Expected Behavior**: Functions identical to `revoke_vesting` but explicitly fails if the stream has already been cancelled or is already fully vested.
- **Error Codes**: `StreamCancelled`, `StreamFullyVested` (plus all errors from `revoke_vesting`).
- **Example Usage**:
  ```typescript
  await program.methods.cancelStream()
    .accountsPartial({
      vestingState: vestingStatePda,
      authorityRevoker: funderPublicKey,
      treasuryReturnAddress: funderTokenAccountAddress,
      vestingTokenAccount: vaultTokenAccountAddress,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
  ```

### 6. `request_vesta`
Requests test tokens from the VESTA faucet (localnet/devnet only).

- **Parameters**: None.
- **Expected Behavior**: Mints 10,000 VESTA tokens to the requester's token account.
- **Error Codes**: `InvalidTokenOwner`, `InvalidTokenMint`.
- **Example Usage**:
  ```typescript
  await program.methods.requestVesta()
    .accountsPartial({
      requester: requesterPublicKey,
      vestaMint: vestaMintAddress,
      requesterTokenAccount: requesterTokenAccountAddress,
      faucetAuthority: faucetPda,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
  ```

### 7. `initialize_config`
Initializes the global configuration for the program, setting the admin address that will receive protocol fees.

- **Parameters**: None.
- **Expected Behavior**: Initializes the `GlobalConfig` PDA and sets the admin to the payer of the transaction. Must be called by the program upgrade authority.
- **Error Codes**: `Unauthorized`.
- **Example Usage**:
  ```typescript
  await program.methods.initializeConfig()
    .accountsPartial({
      globalConfig: globalConfigPda,
      admin: upgradeAuthorityPublicKey,
      programData: programDataAddress,
      program: programId,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();
  ```

### 8. `update_admin`
Updates the admin address in the global configuration.

- **Parameters**: `new_admin` (`Pubkey`)
- **Expected Behavior**: Updates the `admin` field in the `GlobalConfig` PDA. Must be called by the current admin.
- **Error Codes**: `Unauthorized`.
- **Example Usage**:
  ```typescript
  await program.methods.updateAdmin(newAdminPublicKey)
    .accountsPartial({
      globalConfig: globalConfigPda,
      admin: currentAdminPublicKey,
    })
    .rpc();
  ```

## Integration Guide

To create a stream using the VestaLink program in your own project, follow these steps.

### Step 1: Install Dependencies

Ensure you have `@coral-xyz/anchor` and `@solana/spl-token` installed.

```bash
npm install @coral-xyz/anchor @solana/spl-token
```

### Step 2: Set Up Provider and Program

```typescript
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Vestalink } from "./target/types/vestalink"; // Path to your generated types

const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);

// Initialize the program using the IDL and provider
const program = anchor.workspace.vestalink as Program<Vestalink>;
```

### Step 3: Derive PDAs and Token Accounts

You need to derive the PDA for the `VestingState` and prepare the associated token accounts.

```typescript
import { getAssociatedTokenAddressSync } from "@solana/spl-token";

const funderPublicKey = provider.wallet.publicKey;
const recipientPublicKey = new anchor.web3.PublicKey("..."); // The recipient's wallet
const tokenMint = new anchor.web3.PublicKey("..."); // The token being vested
const nonce = new anchor.BN(Date.now()); // Unique identifier for this stream

// Derive the VestingState PDA
const [vestingStatePda] = anchor.web3.PublicKey.findProgramAddressSync(
  [
    Buffer.from("vesting"),
    funderPublicKey.toBuffer(),
    recipientPublicKey.toBuffer(),
    nonce.toArrayLike(Buffer, "le", 8),
  ],
  program.programId
);

// Determine the vault token account (owned by the PDA)
const vaultTokenAccount = getAssociatedTokenAddressSync(
  tokenMint,
  vestingStatePda,
  true // allowOwnerOffCurve = true for PDAs
);

// Determine the recipient's token account
const recipientTokenAccount = getAssociatedTokenAddressSync(
  tokenMint,
  recipientPublicKey
);

// Determine the funder's token account
const funderTokenAccount = getAssociatedTokenAddressSync(
  tokenMint,
  funderPublicKey
);

// Derive admin fee accounts
const adminPublicKey = new anchor.web3.PublicKey("...");
const adminTokenAccount = getAssociatedTokenAddressSync(
  tokenMint,
  adminPublicKey
);
const [globalConfigPda] = anchor.web3.PublicKey.findProgramAddressSync(
  [Buffer.from("global_config")],
  program.programId
);
```

### Step 4: Create the Stream

Execute the `createStream` instruction. Ensure that the associated token accounts are created (e.g., via `createAssociatedTokenAccountIdempotentInstruction`) if they don't already exist.

```typescript
import { 
  createAssociatedTokenAccountIdempotentInstruction, 
  TOKEN_PROGRAM_ID, 
  ASSOCIATED_TOKEN_PROGRAM_ID 
} from "@solana/spl-token";

// Define the vesting schedule
const totalAmount = new anchor.BN(1_000_000); // 1 Token (assuming 6 decimals)
const startTime = new anchor.BN(Math.floor(Date.now() / 1000));
const endTime = new anchor.BN(startTime.toNumber() + (30 * 24 * 60 * 60)); // 30 days

// Prepare pre-instructions to create token accounts if needed
const preInstructions = [
  createAssociatedTokenAccountIdempotentInstruction(
    funderPublicKey, // Payer
    vaultTokenAccount, // ATA
    vestingStatePda, // Owner
    tokenMint,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  ),
  createAssociatedTokenAccountIdempotentInstruction(
    funderPublicKey, // Payer
    recipientTokenAccount, // ATA
    recipientPublicKey, // Owner
    tokenMint,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  )
];

// Execute the transaction
const txHash = await program.methods.createStream({
  totalAmount,
  vestingType: { linear: {} }, // or { cliff: {} }, { milestone: {} }
  startTime,
  endTime,
  cliffTime: startTime, // Only relevant for Cliff vesting
  milestoneCount: 0, // Only relevant for Milestone vesting
  nonce,
})
.accountsPartial({
  vestingState: vestingStatePda,
  funder: funderPublicKey,
  recipient: recipientPublicKey,
  funderTokenAccount: funderTokenAccount,
  mint: tokenMint,
  vestingTokenAccount: vaultTokenAccount,
  globalConfig: globalConfigPda,
  adminAddress: adminPublicKey,
  adminTokenAccount: adminTokenAccount,
  tokenProgram: TOKEN_PROGRAM_ID,
  associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
  systemProgram: anchor.web3.SystemProgram.programId,
})
.preInstructions(preInstructions)
.rpc();

console.log("Stream created successfully! Tx Hash:", txHash);
```

### VestingState Account

Each vesting schedule is stored in a PDA account seeded by `["vesting", funder, recipient, nonce]` with the following fields:

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
