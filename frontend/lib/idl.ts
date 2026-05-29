import type { Idl } from "@coral-xyz/anchor";

export const VESTALINK_IDL = {
  address: "8q5LLVTGNUS16AV4xj6KPLet1M7y4xpa8XjxV7cHH98r",
  metadata: {
    name: "vestalink",
    version: "0.1.0",
    spec: "0.1.0",
    description: "Created with Anchor"
  },
  instructions: [
    {
      name: "create_stream",
      discriminator: [71, 188, 111, 127, 108, 40, 229, 158],
      accounts: [
        { name: "vesting_state", writable: true },
        { name: "funder", writable: true, signer: true },
        { name: "recipient" },
        { name: "funder_token_account", writable: true },
        { name: "vesting_token_account", writable: true },
        { name: "token_program", address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
        { name: "system_program", address: "11111111111111111111111111111111" }
      ],
      args: [{ name: "params", type: { defined: { name: "CreateVestingParams" } } }]
    },
    {
      name: "withdraw",
      discriminator: [183, 18, 70, 156, 148, 109, 161, 34],
      accounts: [
        { name: "vesting_state", writable: true },
        { name: "recipient", signer: true },
        { name: "recipient_token_account", writable: true },
        { name: "vesting_token_account", writable: true },
        { name: "token_program", address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" }
      ],
      args: []
    },
    {
      name: "cancel_stream",
      discriminator: [218, 221, 38, 25, 177, 207, 188, 91],
      accounts: [
        { name: "vesting_state", writable: true },
        { name: "authority_revoker", signer: true },
        { name: "treasury_return_address", writable: true },
        { name: "vesting_token_account", writable: true },
        { name: "token_program", address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" }
      ],
      args: []
    }
  ],
  accounts: [
    {
      name: "VestingState",
      discriminator: [225, 34, 190, 79, 98, 226, 144, 101]
    }
  ],
  errors: [
    { code: 6000, name: "InvalidTimeRange", msg: "Start time must be before end time" },
    { code: 6001, name: "InvalidAmount", msg: "Amount must be greater than zero" },
    { code: 6002, name: "UnsupportedVestingType", msg: "Only linear vesting is supported" },
    { code: 6003, name: "UnauthorizedClaimant", msg: "Only the stream recipient can withdraw from this stream" },
    { code: 6004, name: "InsufficientUnlockedTokens", msg: "No unlocked tokens are available to withdraw" },
    { code: 6005, name: "StreamRevoked", msg: "Vesting stream has already been revoked" },
    { code: 6006, name: "ArithmeticOverflow", msg: "Arithmetic overflow" },
    { code: 6007, name: "InvalidVaultOwner", msg: "Vault token account must be owned by the vesting PDA" },
    { code: 6008, name: "InvalidTokenMint", msg: "Token account mint does not match the vesting mint" },
    { code: 6009, name: "InvalidTokenOwner", msg: "Token account owner is invalid" },
    { code: 6010, name: "InvalidTreasuryReturnAddress", msg: "Treasury return address does not match the stream" }
  ],
  types: [
    {
      name: "CreateVestingParams",
      type: {
        kind: "struct",
        fields: [
          { name: "total_amount", type: "u64" },
          { name: "vesting_type", type: { defined: { name: "VestingType" } } },
          { name: "start_time", type: "i64" },
          { name: "end_time", type: "i64" },
          { name: "cliff_time", type: "i64" },
          { name: "milestone_count", type: "u8" },
          { name: "nonce", type: "u64" }
        ]
      }
    },
    {
      name: "VestingState",
      type: {
        kind: "struct",
        fields: [
          { name: "recipient", type: "pubkey" },
          { name: "funder", type: "pubkey" },
          { name: "total_amount", type: "u64" },
          { name: "claimed_amount", type: "u64" },
          { name: "authority_revoker", type: "pubkey" },
          { name: "authority_milestone", type: "pubkey" },
          { name: "treasury_return_address", type: "pubkey" },
          { name: "vesting_type", type: { defined: { name: "VestingType" } } },
          { name: "is_revoked", type: "bool" },
          { name: "start_time", type: "i64" },
          { name: "end_time", type: "i64" },
          { name: "cliff_time", type: "i64" },
          { name: "milestone_count", type: "u8" },
          { name: "milestones_reached", type: "u8" },
          { name: "bump", type: "u8" },
          { name: "nonce", type: "u64" },
          { name: "vested_amount_at_revocation", type: "u64" }
        ]
      }
    },
    {
      name: "VestingType",
      type: {
        kind: "enum",
        variants: [{ name: "Cliff" }, { name: "Linear" }, { name: "Milestone" }]
      }
    }
  ]
} as const satisfies Idl;
