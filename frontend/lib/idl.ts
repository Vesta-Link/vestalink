import type { Idl } from "@coral-xyz/anchor";

export const VESTALINK_IDL = {
  "address": "8q5LLVTGNUS16AV4xj6KPLet1M7y4xpa8XjxV7cHH98r",
  "metadata": {
    "name": "vestalink",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "instructions": [
    {
      "name": "cancel_stream",
      "discriminator": [
        218,
        221,
        38,
        25,
        177,
        207,
        188,
        91
      ],
      "accounts": [
        {
          "name": "vesting_state",
          "writable": true
        },
        {
          "name": "authority_revoker",
          "signer": true,
          "relations": [
            "vesting_state"
          ]
        },
        {
          "name": "treasury_return_address",
          "writable": true
        },
        {
          "name": "vesting_token_account",
          "writable": true
        },
        {
          "name": "token_program",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "cancel_vesting",
      "discriminator": [
        171,
        166,
        241,
        72,
        155,
        48,
        30,
        253
      ],
      "accounts": [
        {
          "name": "vesting_state",
          "writable": true
        },
        {
          "name": "authority_revoker",
          "signer": true,
          "relations": [
            "vesting_state"
          ]
        },
        {
          "name": "treasury_return_address",
          "writable": true
        },
        {
          "name": "vesting_token_account",
          "writable": true
        },
        {
          "name": "token_program",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "claim",
      "discriminator": [
        62,
        198,
        214,
        193,
        213,
        159,
        108,
        210
      ],
      "accounts": [
        {
          "name": "vesting_state",
          "writable": true
        },
        {
          "name": "recipient",
          "signer": true
        },
        {
          "name": "recipient_token_account",
          "writable": true
        },
        {
          "name": "vesting_token_account",
          "writable": true
        },
        {
          "name": "token_program",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "claim_tokens",
      "discriminator": [
        108,
        216,
        210,
        231,
        0,
        212,
        42,
        64
      ],
      "accounts": [
        {
          "name": "vesting_state",
          "writable": true
        },
        {
          "name": "recipient",
          "signer": true
        },
        {
          "name": "recipient_token_account",
          "writable": true
        },
        {
          "name": "vesting_token_account",
          "writable": true
        },
        {
          "name": "token_program",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "create_stream",
      "discriminator": [
        71,
        188,
        111,
        127,
        108,
        40,
        229,
        158
      ],
      "accounts": [
        {
          "name": "vesting_state",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  101,
                  115,
                  116,
                  105,
                  110,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "funder"
              },
              {
                "kind": "account",
                "path": "recipient"
              },
              {
                "kind": "arg",
                "path": "params.nonce"
              }
            ]
          }
        },
        {
          "name": "funder",
          "writable": true,
          "signer": true
        },
        {
          "name": "recipient"
        },
        {
          "name": "funder_token_account",
          "writable": true
        },
        {
          "name": "mint"
        },
        {
          "name": "vesting_token_account",
          "writable": true
        },
        {
          "name": "global_config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "admin_address"
        },
        {
          "name": "admin_token_account",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "admin_address"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "token_program",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associated_token_program",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "CreateVestingParams"
            }
          }
        }
      ]
    },
    {
      "name": "create_vesting_schedule",
      "discriminator": [
        195,
        30,
        184,
        253,
        77,
        154,
        187,
        66
      ],
      "accounts": [
        {
          "name": "vesting_state",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  101,
                  115,
                  116,
                  105,
                  110,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "funder"
              },
              {
                "kind": "account",
                "path": "recipient"
              },
              {
                "kind": "arg",
                "path": "params.nonce"
              }
            ]
          }
        },
        {
          "name": "funder",
          "writable": true,
          "signer": true
        },
        {
          "name": "recipient"
        },
        {
          "name": "funder_token_account",
          "writable": true
        },
        {
          "name": "mint"
        },
        {
          "name": "vesting_token_account",
          "writable": true
        },
        {
          "name": "global_config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "admin_address"
        },
        {
          "name": "admin_token_account",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "admin_address"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "token_program",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associated_token_program",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "CreateVestingParams"
            }
          }
        }
      ]
    },
    {
      "name": "initialize_config",
      "discriminator": [
        208,
        127,
        21,
        1,
        194,
        190,
        196,
        70
      ],
      "accounts": [
        {
          "name": "global_config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "program_data"
        },
        {
          "name": "program",
          "address": "8q5LLVTGNUS16AV4xj6KPLet1M7y4xpa8XjxV7cHH98r"
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "request_vesta",
      "discriminator": [
        86,
        132,
        89,
        241,
        247,
        252,
        249,
        46
      ],
      "accounts": [
        {
          "name": "requester",
          "writable": true,
          "signer": true
        },
        {
          "name": "vesta_mint",
          "writable": true
        },
        {
          "name": "requester_token_account",
          "writable": true
        },
        {
          "name": "faucet_authority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  101,
                  115,
                  116,
                  97,
                  95,
                  102,
                  97,
                  117,
                  99,
                  101,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "token_program",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "revoke_vesting",
      "discriminator": [
        12,
        252,
        252,
        168,
        39,
        101,
        98,
        9
      ],
      "accounts": [
        {
          "name": "vesting_state",
          "writable": true
        },
        {
          "name": "authority_revoker",
          "signer": true,
          "relations": [
            "vesting_state"
          ]
        },
        {
          "name": "treasury_return_address",
          "writable": true
        },
        {
          "name": "vesting_token_account",
          "writable": true
        },
        {
          "name": "token_program",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "unlock_milestone",
      "discriminator": [
        131,
        196,
        6,
        134,
        153,
        130,
        248,
        238
      ],
      "accounts": [
        {
          "name": "vesting_state",
          "writable": true
        },
        {
          "name": "authority_milestone",
          "signer": true,
          "relations": [
            "vesting_state"
          ]
        }
      ],
      "args": []
    },
    {
      "name": "update_admin",
      "discriminator": [
        161,
        176,
        40,
        213,
        60,
        184,
        179,
        228
      ],
      "accounts": [
        {
          "name": "global_config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "global_config"
          ]
        }
      ],
      "args": [
        {
          "name": "new_admin",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "withdraw",
      "discriminator": [
        183,
        18,
        70,
        156,
        148,
        109,
        161,
        34
      ],
      "accounts": [
        {
          "name": "vesting_state",
          "writable": true
        },
        {
          "name": "recipient",
          "signer": true
        },
        {
          "name": "recipient_token_account",
          "writable": true
        },
        {
          "name": "vesting_token_account",
          "writable": true
        },
        {
          "name": "token_program",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    }
  ],
  "accounts": [
    {
      "name": "GlobalConfig",
      "discriminator": [
        149,
        8,
        156,
        202,
        160,
        252,
        176,
        217
      ]
    },
    {
      "name": "VestingState",
      "discriminator": [
        225,
        34,
        190,
        79,
        98,
        226,
        144,
        101
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "InvalidTimeRange",
      "msg": "Start time must be before end time"
    },
    {
      "code": 6001,
      "name": "InvalidAmount",
      "msg": "Amount must be greater than zero"
    },
    {
      "code": 6002,
      "name": "UnsupportedVestingType",
      "msg": "Only linear vesting is supported"
    },
    {
      "code": 6003,
      "name": "UnauthorizedClaimant",
      "msg": "Only the stream recipient can withdraw from this stream"
    },
    {
      "code": 6004,
      "name": "InsufficientUnlockedTokens",
      "msg": "No unlocked tokens are available to withdraw"
    },
    {
      "code": 6005,
      "name": "StreamRevoked",
      "msg": "Vesting stream has already been revoked"
    },
    {
      "code": 6006,
      "name": "ArithmeticOverflow",
      "msg": "Arithmetic overflow"
    },
    {
      "code": 6007,
      "name": "InvalidVaultOwner",
      "msg": "Vault token account must be owned by the vesting PDA"
    },
    {
      "code": 6008,
      "name": "InvalidTokenMint",
      "msg": "Token account mint does not match the vesting mint"
    },
    {
      "code": 6009,
      "name": "InvalidTokenOwner",
      "msg": "Token account owner is invalid"
    },
    {
      "code": 6010,
      "name": "InvalidTreasuryReturnAddress",
      "msg": "Treasury return address does not match the stream"
    },
    {
      "code": 6011,
      "name": "CliffTimeExceedsEndTime",
      "msg": "Cliff time must not exceed end time"
    },
    {
      "code": 6012,
      "name": "MilestoneCountZero",
      "msg": "Milestone count must be greater than zero"
    },
    {
      "code": 6013,
      "name": "AllMilestonesReached",
      "msg": "All milestones have already been reached"
    },
    {
      "code": 6014,
      "name": "StreamCancelled",
      "msg": "Stream has already been cancelled"
    },
    {
      "code": 6015,
      "name": "StreamFullyVested",
      "msg": "Stream is fully vested and cannot be cancelled"
    },
    {
      "code": 6016,
      "name": "StreamExpired",
      "msg": "Stream has expired"
    },
    {
      "code": 6017,
      "name": "Unauthorized",
      "msg": "Unauthorized access"
    }
  ],
  "types": [
    {
      "name": "CreateVestingParams",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "total_amount",
            "type": "u64"
          },
          {
            "name": "vesting_type",
            "type": {
              "defined": {
                "name": "VestingType"
              }
            }
          },
          {
            "name": "start_time",
            "type": "i64"
          },
          {
            "name": "end_time",
            "type": "i64"
          },
          {
            "name": "cliff_time",
            "type": "i64"
          },
          {
            "name": "milestone_count",
            "type": "u8"
          },
          {
            "name": "nonce",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "GlobalConfig",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "VestingState",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "recipient",
            "type": "pubkey"
          },
          {
            "name": "funder",
            "type": "pubkey"
          },
          {
            "name": "total_amount",
            "type": "u64"
          },
          {
            "name": "claimed_amount",
            "type": "u64"
          },
          {
            "name": "authority_revoker",
            "type": "pubkey"
          },
          {
            "name": "authority_milestone",
            "type": "pubkey"
          },
          {
            "name": "treasury_return_address",
            "type": "pubkey"
          },
          {
            "name": "vesting_type",
            "type": {
              "defined": {
                "name": "VestingType"
              }
            }
          },
          {
            "name": "is_revoked",
            "type": "bool"
          },
          {
            "name": "start_time",
            "type": "i64"
          },
          {
            "name": "end_time",
            "type": "i64"
          },
          {
            "name": "cliff_time",
            "type": "i64"
          },
          {
            "name": "milestone_count",
            "type": "u8"
          },
          {
            "name": "milestones_reached",
            "type": "u8"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "nonce",
            "type": "u64"
          },
          {
            "name": "vested_amount_at_revocation",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "VestingType",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "Cliff"
          },
          {
            "name": "Linear"
          },
          {
            "name": "Milestone"
          }
        ]
      }
    }
  ]
} as const satisfies Idl;
