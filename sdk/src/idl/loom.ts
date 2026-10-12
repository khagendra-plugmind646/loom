/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/loom.json`.
 */
export type Loom = {
  "address": "wrCPKEKsMDgLdpNFJwGK8LSvWVRUnuEsbQVAZAXkoBQ",
  "metadata": {
    "name": "loom",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Loom — SOL-collateralized stablecoin lending with on-chain escrow and ZK repayment certificates"
  },
  "instructions": [
    {
      "name": "addCollateral",
      "discriminator": [
        127,
        82,
        121,
        42,
        161,
        176,
        249,
        206
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
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
          "name": "loan",
          "writable": true
        },
        {
          "name": "escrow",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  115,
                  99,
                  114,
                  111,
                  119
                ]
              },
              {
                "kind": "account",
                "path": "loan"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "lamports",
          "type": "u64"
        }
      ]
    },
    {
      "name": "claimCertificate",
      "discriminator": [
        45,
        124,
        106,
        139,
        156,
        89,
        153,
        233
      ],
      "accounts": [
        {
          "name": "holder",
          "docs": [
            "Usually a fresh wallet with no on-chain link to the borrower."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
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
          "name": "creditTree",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  114,
                  101,
                  100,
                  105,
                  116,
                  95,
                  116,
                  114,
                  101,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "certificate",
          "docs": [
            "Seeded by the nullifier hash: a second claim for the same loan fails here."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  101,
                  114,
                  116,
                  105,
                  102,
                  105,
                  99,
                  97,
                  116,
                  101
                ]
              },
              {
                "kind": "arg",
                "path": "args.nullifier_hash"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "claimCertificateArgs"
            }
          }
        }
      ]
    },
    {
      "name": "deposit",
      "discriminator": [
        242,
        35,
        198,
        137,
        82,
        225,
        242,
        182
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "mint",
          "relations": [
            "pool"
          ]
        },
        {
          "name": "ownerToken",
          "writable": true
        },
        {
          "name": "position",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  101,
                  110,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "fundReserve",
      "discriminator": [
        17,
        82,
        71,
        222,
        117,
        210,
        58,
        12
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
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
          "name": "reserve",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  115,
                  101,
                  114,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "mint",
          "relations": [
            "reserve"
          ]
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "reserve"
          ]
        },
        {
          "name": "adminToken",
          "writable": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "initPool",
      "discriminator": [
        116,
        233,
        199,
        204,
        115,
        159,
        171,
        36
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
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
          "name": "reserve",
          "docs": [
            "Pools exist only for stablecoins Loom lends (those with a reserve)."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  115,
                  101,
                  114,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "mint",
          "relations": [
            "reserve"
          ]
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "initReserve",
      "discriminator": [
        138,
        245,
        71,
        225,
        153,
        4,
        3,
        43
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
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
          "name": "mint"
        },
        {
          "name": "reserve",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  115,
                  101,
                  114,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "treasury",
          "relations": [
            "config"
          ]
        },
        {
          "name": "treasuryToken",
          "docs": [
            "Treasury token account that will receive repayments in this stablecoin."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "treasury"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
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
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "initialize",
      "discriminator": [
        175,
        175,
        109,
        31,
        13,
        152,
        155,
        237
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
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
          "name": "creditTree",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  114,
                  101,
                  100,
                  105,
                  116,
                  95,
                  116,
                  114,
                  101,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "initializeParams"
            }
          }
        }
      ]
    },
    {
      "name": "liquidate",
      "discriminator": [
        223,
        179,
        226,
        125,
        48,
        46,
        39,
        74
      ],
      "accounts": [
        {
          "name": "caller",
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
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
          "name": "loan",
          "writable": true
        },
        {
          "name": "escrow",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  115,
                  99,
                  114,
                  111,
                  119
                ]
              },
              {
                "kind": "account",
                "path": "loan"
              }
            ]
          }
        },
        {
          "name": "borrower",
          "writable": true,
          "relations": [
            "loan"
          ]
        },
        {
          "name": "treasury",
          "writable": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "priceUpdate"
        },
        {
          "name": "chainlinkFeed",
          "address": "99B2bTijsU6f1GCT73HmdR7HCFFjGMBcPZY6jZ96ynrR"
        },
        {
          "name": "pool",
          "writable": true,
          "optional": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "loan.mint",
                "account": "loan"
              }
            ]
          }
        },
        {
          "name": "poolVault",
          "writable": true,
          "optional": true
        },
        {
          "name": "reserve",
          "docs": [
            "Signs the buy-out as the delegate the treasury approved on its token account."
          ],
          "optional": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  115,
                  101,
                  114,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "loan.mint",
                "account": "loan"
              }
            ]
          }
        },
        {
          "name": "mint",
          "optional": true
        },
        {
          "name": "treasuryToken",
          "writable": true,
          "optional": true
        },
        {
          "name": "tokenProgram",
          "optional": true
        }
      ],
      "args": []
    },
    {
      "name": "openLoan",
      "discriminator": [
        49,
        29,
        234,
        76,
        192,
        61,
        108,
        20
      ],
      "accounts": [
        {
          "name": "borrower",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
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
          "name": "reserve",
          "docs": [
            "Signs payouts as the delegate the treasury approved on its token account."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  115,
                  101,
                  114,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "mint",
          "relations": [
            "reserve",
            "pool"
          ]
        },
        {
          "name": "treasury",
          "relations": [
            "config"
          ]
        },
        {
          "name": "treasuryToken",
          "docs": [
            "Payouts come straight from the treasury's token account, up to the amount it approved."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "treasury"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
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
          "name": "recipient"
        },
        {
          "name": "recipientToken",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "recipient"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
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
          "name": "loan",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  111,
                  97,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "borrower"
              },
              {
                "kind": "arg",
                "path": "args.nonce"
              }
            ]
          }
        },
        {
          "name": "escrow",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  115,
                  99,
                  114,
                  111,
                  119
                ]
              },
              {
                "kind": "account",
                "path": "loan"
              }
            ]
          }
        },
        {
          "name": "priceUpdate",
          "docs": [
            "verification level, staleness and confidence are checked in `load_sol_usd_prices`."
          ]
        },
        {
          "name": "chainlinkFeed",
          "address": "99B2bTijsU6f1GCT73HmdR7HCFFjGMBcPZY6jZ96ynrR"
        },
        {
          "name": "creditCertificate",
          "docs": [
            "Optional ZK repayment certificate held by the borrower: unlocks CREDIT_INTEREST_BPS on loans",
            "up to CREDIT_LIMIT_MULTIPLE x the repaid principal it proves. Only `claim_certificate` can create one."
          ],
          "optional": true
        },
        {
          "name": "pool",
          "docs": [
            "Lending pool for this stablecoin, if one exists: loans are funded from it first."
          ],
          "writable": true,
          "optional": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "poolVault",
          "writable": true,
          "optional": true
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "openLoanArgs"
            }
          }
        }
      ]
    },
    {
      "name": "repay",
      "discriminator": [
        234,
        103,
        67,
        82,
        208,
        234,
        219,
        166
      ],
      "accounts": [
        {
          "name": "payer",
          "docs": [
            "Anyone may repay on the borrower's behalf; collateral always goes back to the borrower."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
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
          "name": "loan",
          "writable": true
        },
        {
          "name": "borrower",
          "writable": true,
          "relations": [
            "loan"
          ]
        },
        {
          "name": "escrow",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  115,
                  99,
                  114,
                  111,
                  119
                ]
              },
              {
                "kind": "account",
                "path": "loan"
              }
            ]
          }
        },
        {
          "name": "creditTree",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  114,
                  101,
                  100,
                  105,
                  116,
                  95,
                  116,
                  114,
                  101,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "reserve",
          "docs": [
            "Reserve of the stablecoin used for this payment (USDC or USDT — either is accepted)."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  115,
                  101,
                  114,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "mint",
          "relations": [
            "reserve"
          ]
        },
        {
          "name": "payerToken",
          "writable": true
        },
        {
          "name": "treasury",
          "relations": [
            "config"
          ]
        },
        {
          "name": "treasuryToken",
          "docs": [
            "Repayments go directly to the admin treasury's token account."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "treasury"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
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
          "name": "pool",
          "docs": [
            "Lending pool of the payment coin: required for pool-funded loans (repayments go back to it)."
          ],
          "writable": true,
          "optional": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "poolVault",
          "writable": true,
          "optional": true
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "updateConfig",
      "discriminator": [
        29,
        158,
        252,
        191,
        10,
        83,
        219,
        99
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
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
        }
      ],
      "args": [
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "updateConfigParams"
            }
          }
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
          "name": "owner",
          "signer": true,
          "relations": [
            "position"
          ]
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "mint",
          "relations": [
            "pool"
          ]
        },
        {
          "name": "destination",
          "writable": true
        },
        {
          "name": "position",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  101,
                  110,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "shares",
          "type": "u64"
        }
      ]
    },
    {
      "name": "withdrawReserve",
      "discriminator": [
        165,
        158,
        228,
        5,
        114,
        119,
        194,
        14
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
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
          "name": "reserve",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  115,
                  101,
                  114,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "mint",
          "relations": [
            "reserve"
          ]
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "reserve"
          ]
        },
        {
          "name": "destination",
          "writable": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "collateralEscrow",
      "discriminator": [
        14,
        253,
        59,
        135,
        205,
        136,
        1,
        239
      ]
    },
    {
      "name": "config",
      "discriminator": [
        155,
        12,
        170,
        224,
        30,
        250,
        204,
        130
      ]
    },
    {
      "name": "creditCertificate",
      "discriminator": [
        52,
        104,
        3,
        55,
        91,
        236,
        39,
        118
      ]
    },
    {
      "name": "creditTree",
      "discriminator": [
        171,
        169,
        219,
        224,
        180,
        211,
        230,
        248
      ]
    },
    {
      "name": "lenderPosition",
      "discriminator": [
        165,
        98,
        244,
        204,
        209,
        158,
        88,
        19
      ]
    },
    {
      "name": "loan",
      "discriminator": [
        20,
        195,
        70,
        117,
        165,
        227,
        182,
        1
      ]
    },
    {
      "name": "pool",
      "discriminator": [
        241,
        154,
        109,
        4,
        17,
        177,
        109,
        188
      ]
    },
    {
      "name": "reserve",
      "discriminator": [
        43,
        242,
        204,
        202,
        26,
        247,
        59,
        127
      ]
    }
  ],
  "events": [
    {
      "name": "certificateIssued",
      "discriminator": [
        62,
        59,
        26,
        207,
        181,
        234,
        201,
        52
      ]
    },
    {
      "name": "collateralAdded",
      "discriminator": [
        172,
        68,
        58,
        249,
        157,
        64,
        74,
        141
      ]
    },
    {
      "name": "creditLeafInserted",
      "discriminator": [
        74,
        38,
        17,
        161,
        136,
        110,
        108,
        128
      ]
    },
    {
      "name": "loanLiquidated",
      "discriminator": [
        1,
        29,
        28,
        96,
        66,
        95,
        8,
        204
      ]
    },
    {
      "name": "loanOpened",
      "discriminator": [
        66,
        100,
        157,
        177,
        1,
        226,
        123,
        151
      ]
    },
    {
      "name": "loanRepaid",
      "discriminator": [
        202,
        183,
        88,
        60,
        211,
        54,
        142,
        243
      ]
    },
    {
      "name": "poolDeposited",
      "discriminator": [
        148,
        17,
        86,
        50,
        113,
        125,
        70,
        132
      ]
    },
    {
      "name": "poolLoanBoughtOut",
      "discriminator": [
        41,
        163,
        120,
        204,
        170,
        1,
        153,
        153
      ]
    },
    {
      "name": "poolWithdrawn",
      "discriminator": [
        23,
        62,
        221,
        23,
        53,
        222,
        69,
        207
      ]
    },
    {
      "name": "repaymentMade",
      "discriminator": [
        209,
        145,
        250,
        183,
        236,
        244,
        125,
        166
      ]
    },
    {
      "name": "reserveFunded",
      "discriminator": [
        15,
        45,
        175,
        239,
        65,
        137,
        203,
        230
      ]
    },
    {
      "name": "reserveWithdrawn",
      "discriminator": [
        186,
        11,
        109,
        7,
        117,
        246,
        188,
        249
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "paused",
      "msg": "Protocol is paused for new loans"
    },
    {
      "code": 6001,
      "name": "invalidParameter",
      "msg": "Invalid protocol parameter"
    },
    {
      "code": 6002,
      "name": "invalidMintDecimals",
      "msg": "Stablecoin mint must have 6 decimals"
    },
    {
      "code": 6003,
      "name": "principalOutOfRange",
      "msg": "Principal is outside the allowed range"
    },
    {
      "code": 6004,
      "name": "insufficientCollateral",
      "msg": "Collateral must be worth at least 200% of the principal"
    },
    {
      "code": 6005,
      "name": "insufficientLiquidity",
      "msg": "Not enough USDC/USDT available to pay out this loan"
    },
    {
      "code": 6006,
      "name": "zeroAmount",
      "msg": "Amount must be greater than zero"
    },
    {
      "code": 6007,
      "name": "loanNotActive",
      "msg": "Loan is not active"
    },
    {
      "code": 6008,
      "name": "loanMatured",
      "msg": "Loan term (12 months) has ended; it can no longer be repaid"
    },
    {
      "code": 6009,
      "name": "notLiquidatable",
      "msg": "Loan is healthy (SOL above 60% of its opening price) and not past maturity; it cannot be settled"
    },
    {
      "code": 6010,
      "name": "invalidOracle",
      "msg": "Oracle account is not a Pyth PriceUpdateV2 account"
    },
    {
      "code": 6011,
      "name": "wrongPriceFeed",
      "msg": "Oracle price feed is not SOL/USD"
    },
    {
      "code": 6012,
      "name": "oracleNotFullyVerified",
      "msg": "Oracle price update is not fully verified"
    },
    {
      "code": 6013,
      "name": "stalePrice",
      "msg": "Oracle price is stale"
    },
    {
      "code": 6014,
      "name": "invalidPrice",
      "msg": "Oracle price is invalid"
    },
    {
      "code": 6015,
      "name": "priceTooUncertain",
      "msg": "Oracle confidence interval is too wide"
    },
    {
      "code": 6016,
      "name": "mathOverflow",
      "msg": "Math overflow"
    },
    {
      "code": 6017,
      "name": "invalidCommitment",
      "msg": "Identity commitment is not a valid BN254 field element"
    },
    {
      "code": 6018,
      "name": "poseidonFailed",
      "msg": "Poseidon hashing failed"
    },
    {
      "code": 6019,
      "name": "creditTreeFull",
      "msg": "Credit tree is full"
    },
    {
      "code": 6020,
      "name": "unknownRoot",
      "msg": "Unknown credit tree root"
    },
    {
      "code": 6021,
      "name": "invalidProof",
      "msg": "Zero-knowledge proof verification failed"
    },
    {
      "code": 6022,
      "name": "payoutNotApproved",
      "msg": "The payout wallet has not approved enough USDC/USDT for this loan"
    },
    {
      "code": 6023,
      "name": "invalidRecipient",
      "msg": "The payout wallet cannot receive a loan"
    },
    {
      "code": 6024,
      "name": "invalidChainlinkFeed",
      "msg": "Oracle account is not the Chainlink SOL/USD data feed"
    },
    {
      "code": 6025,
      "name": "staleChainlinkPrice",
      "msg": "Chainlink price is stale"
    },
    {
      "code": 6026,
      "name": "notCertificateHolder",
      "msg": "This credit certificate belongs to another wallet"
    },
    {
      "code": 6027,
      "name": "aboveCreditLimit",
      "msg": "Loan is above this credit certificate's limit (2x the repaid loan it proves)"
    },
    {
      "code": 6028,
      "name": "invalidPool",
      "msg": "Lending pool account does not match this stablecoin"
    },
    {
      "code": 6029,
      "name": "poolAccountsRequired",
      "msg": "This loan was funded by the lending pool; pass the pool accounts"
    },
    {
      "code": 6030,
      "name": "insufficientPoolLiquidity",
      "msg": "The lending pool doesn't have that much available right now (it is lent out)"
    },
    {
      "code": 6031,
      "name": "poolBackstopUnfunded",
      "msg": "The treasury must approve enough USDC/USDT to buy out this pool-funded loan before it can be settled"
    },
    {
      "code": 6032,
      "name": "depositTooSmall",
      "msg": "Deposit is too small to mint a pool share"
    },
    {
      "code": 6033,
      "name": "insufficientShares",
      "msg": "You don't have that many pool shares"
    },
    {
      "code": 6034,
      "name": "repayInLoanCoin",
      "msg": "Repay a pool-funded loan in the stablecoin you borrowed"
    },
    {
      "code": 6035,
      "name": "duplicateCertificate",
      "msg": "The same credit certificate was passed twice"
    },
    {
      "code": 6036,
      "name": "invalidCertificate",
      "msg": "Account is not a Loom credit certificate"
    }
  ],
  "types": [
    {
      "name": "certificateIssued",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "certificate",
            "type": "pubkey"
          },
          {
            "name": "holder",
            "type": "pubkey"
          },
          {
            "name": "nullifierHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "minPrincipal",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "claimCertificateArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "proofA",
            "docs": [
              "Groth16 proof (A negated, B in EIP-197 order, C)."
            ],
            "type": {
              "array": [
                "u8",
                64
              ]
            }
          },
          {
            "name": "proofB",
            "type": {
              "array": [
                "u8",
                128
              ]
            }
          },
          {
            "name": "proofC",
            "type": {
              "array": [
                "u8",
                64
              ]
            }
          },
          {
            "name": "root",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "nullifierHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "minPrincipal",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "collateralAdded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "loan",
            "type": "pubkey"
          },
          {
            "name": "payer",
            "type": "pubkey"
          },
          {
            "name": "lamports",
            "type": "u64"
          },
          {
            "name": "collateralLamports",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "collateralEscrow",
      "docs": [
        "Holds the SOL collateral of exactly one loan. Only the program can move these",
        "lamports, and only according to `repay` (back to borrower) or `liquidate`."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "loan",
            "type": "pubkey"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "config",
      "docs": [
        "Global protocol configuration and public, on-chain accounting."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "treasury",
            "docs": [
              "Admin wallet that pays out loans (from its USDC/USDT token accounts, up to the",
              "amount it approved to each reserve PDA), receives repayments and seized SOL."
            ],
            "type": "pubkey"
          },
          {
            "name": "liquidationThresholdBps",
            "docs": [
              "A loan becomes liquidatable when collateral value < outstanding debt * this."
            ],
            "type": "u16"
          },
          {
            "name": "liquidationPenaltyBps",
            "docs": [
              "Extra collateral (on top of the outstanding debt) seized on liquidation/default."
            ],
            "type": "u16"
          },
          {
            "name": "maxPriceAgeSecs",
            "type": "u32"
          },
          {
            "name": "maxConfidenceBps",
            "type": "u16"
          },
          {
            "name": "minPrincipal",
            "type": "u64"
          },
          {
            "name": "maxPrincipal",
            "type": "u64"
          },
          {
            "name": "paused",
            "type": "bool"
          },
          {
            "name": "nextLoanId",
            "type": "u64"
          },
          {
            "name": "stats",
            "type": {
              "defined": {
                "name": "protocolStats"
              }
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "creditCertificate",
      "docs": [
        "A zero-knowledge repayment certificate. Its address is derived from the",
        "nullifier hash, so each repaid loan can mint at most one certificate."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "holder",
            "type": "pubkey"
          },
          {
            "name": "nullifierHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "root",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "minPrincipal",
            "docs": [
              "Publicly proven lower bound on the repaid loan's principal."
            ],
            "type": "u64"
          },
          {
            "name": "issuedAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "creditLeafInserted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "loan",
            "type": "pubkey"
          },
          {
            "name": "leaf",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "index",
            "type": "u64"
          },
          {
            "name": "root",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "creditTree",
      "docs": [
        "Append-only Poseidon Merkle tree of fully-repaid loans (\"credit leaves\")."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "nextIndex",
            "type": "u64"
          },
          {
            "name": "currentRootIndex",
            "type": "u32"
          },
          {
            "name": "roots",
            "type": {
              "array": [
                {
                  "array": [
                    "u8",
                    32
                  ]
                },
                32
              ]
            }
          },
          {
            "name": "filledSubtrees",
            "type": {
              "array": [
                {
                  "array": [
                    "u8",
                    32
                  ]
                },
                20
              ]
            }
          },
          {
            "name": "zeros",
            "type": {
              "array": [
                {
                  "array": [
                    "u8",
                    32
                  ]
                },
                20
              ]
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "initializeParams",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "treasury",
            "type": "pubkey"
          },
          {
            "name": "liquidationThresholdBps",
            "type": "u16"
          },
          {
            "name": "liquidationPenaltyBps",
            "type": "u16"
          },
          {
            "name": "maxPriceAgeSecs",
            "type": "u32"
          },
          {
            "name": "maxConfidenceBps",
            "type": "u16"
          },
          {
            "name": "minPrincipal",
            "type": "u64"
          },
          {
            "name": "maxPrincipal",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "lenderPosition",
      "docs": [
        "One depositor's share of a pool."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "shares",
            "type": "u64"
          },
          {
            "name": "deposited",
            "docs": [
              "Lifetime deposits and withdrawals, so earnings = value + withdrawn - deposited."
            ],
            "type": "u64"
          },
          {
            "name": "withdrawn",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "loan",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "id",
            "type": "u64"
          },
          {
            "name": "borrower",
            "type": "pubkey"
          },
          {
            "name": "nonce",
            "type": "u64"
          },
          {
            "name": "mint",
            "docs": [
              "Stablecoin the principal was disbursed in."
            ],
            "type": "pubkey"
          },
          {
            "name": "principal",
            "type": "u64"
          },
          {
            "name": "totalDue",
            "docs": [
              "The most this loan can cost: principal + interest for the whole term. Fixed at open."
            ],
            "type": "u64"
          },
          {
            "name": "repaid",
            "docs": [
              "Everything paid so far (interest + principal)."
            ],
            "type": "u64"
          },
          {
            "name": "collateralLamports",
            "type": "u64"
          },
          {
            "name": "openPrice",
            "docs": [
              "Pyth SOL/USD price used at origination (audit trail)."
            ],
            "type": "i64"
          },
          {
            "name": "openPriceExpo",
            "type": "i32"
          },
          {
            "name": "startTs",
            "type": "i64"
          },
          {
            "name": "maturityTs",
            "type": "i64"
          },
          {
            "name": "closedTs",
            "type": "i64"
          },
          {
            "name": "liquidationThresholdBps",
            "docs": [
              "Risk parameters snapshotted at open so the admin cannot change them later."
            ],
            "type": "u16"
          },
          {
            "name": "liquidationPenaltyBps",
            "type": "u16"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "loanStatus"
              }
            }
          },
          {
            "name": "identityCommitment",
            "docs": [
              "Poseidon(secret, nullifier) chosen by the borrower; zero = opted out of ZK credit."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "creditLeaf",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "creditLeafIndex",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "escrowBump",
            "type": "u8"
          },
          {
            "name": "recipient",
            "docs": [
              "Wallet that received the stablecoin (the borrower unless they chose another)."
            ],
            "type": "pubkey"
          },
          {
            "name": "rateBps",
            "docs": [
              "Annual interest rate: INTEREST_BPS, or CREDIT_INTEREST_BPS with a credit certificate."
            ],
            "type": "u16"
          },
          {
            "name": "principalRepaid",
            "docs": [
              "Principal repaid so far (each payment covers interest first)."
            ],
            "type": "u64"
          },
          {
            "name": "interestAccrued",
            "docs": [
              "Interest accrued from opening until `accrued_ts` (paid and unpaid)."
            ],
            "type": "u64"
          },
          {
            "name": "accruedTs",
            "type": "i64"
          },
          {
            "name": "creditCertificate",
            "docs": [
              "Credit certificate that unlocked the credit rate, or the default key."
            ],
            "type": "pubkey"
          },
          {
            "name": "fromPool",
            "docs": [
              "Funded by the lending pool (repayments go back to it) rather than the treasury."
            ],
            "type": "bool"
          },
          {
            "name": "openingCollateralLamports",
            "docs": [
              "SOL locked when the loan opened; `collateral_lamports` grows when the borrower adds SOL."
            ],
            "type": "u64"
          },
          {
            "name": "creditLevel",
            "docs": [
              "Number of credit certificates presented at opening (0 = standard rate)."
            ],
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "loanLiquidated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "loan",
            "type": "pubkey"
          },
          {
            "name": "borrower",
            "type": "pubkey"
          },
          {
            "name": "defaulted",
            "type": "bool"
          },
          {
            "name": "outstandingDebt",
            "type": "u64"
          },
          {
            "name": "seizedLamports",
            "type": "u64"
          },
          {
            "name": "returnedLamports",
            "type": "u64"
          },
          {
            "name": "price",
            "type": "i64"
          },
          {
            "name": "priceExpo",
            "type": "i32"
          }
        ]
      }
    },
    {
      "name": "loanOpened",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "loan",
            "type": "pubkey"
          },
          {
            "name": "id",
            "type": "u64"
          },
          {
            "name": "borrower",
            "type": "pubkey"
          },
          {
            "name": "recipient",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "principal",
            "type": "u64"
          },
          {
            "name": "totalDue",
            "type": "u64"
          },
          {
            "name": "collateralLamports",
            "type": "u64"
          },
          {
            "name": "price",
            "type": "i64"
          },
          {
            "name": "priceExpo",
            "type": "i32"
          },
          {
            "name": "maturityTs",
            "type": "i64"
          },
          {
            "name": "rateBps",
            "type": "u16"
          },
          {
            "name": "creditCertificate",
            "type": "pubkey"
          },
          {
            "name": "fromPool",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "loanRepaid",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "loan",
            "type": "pubkey"
          },
          {
            "name": "borrower",
            "type": "pubkey"
          },
          {
            "name": "collateralReturned",
            "type": "u64"
          },
          {
            "name": "creditLeafIndex",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "loanStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "active"
          },
          {
            "name": "repaid"
          },
          {
            "name": "liquidated"
          },
          {
            "name": "defaulted"
          }
        ]
      }
    },
    {
      "name": "openLoanArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "nonce",
            "docs": [
              "Client-chosen nonce; makes the loan PDA unique per borrower."
            ],
            "type": "u64"
          },
          {
            "name": "principal",
            "docs": [
              "Stablecoin amount to borrow (6 decimals)."
            ],
            "type": "u64"
          },
          {
            "name": "collateralLamports",
            "docs": [
              "SOL to lock in escrow. Must be worth >= 2x principal."
            ],
            "type": "u64"
          },
          {
            "name": "identityCommitment",
            "docs": [
              "Poseidon(secret, nullifier) for ZK credit certificates, or all-zero to opt out."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "pool",
      "docs": [
        "A lending pool for one stablecoin. Depositors supply liquidity and own shares of it; new loans are",
        "funded from it first and depositors earn their interest, minus PROTOCOL_FEE_BPS. When a pool-funded",
        "loan is settled, the treasury buys it out at what is owed, so depositors are repaid in full and the",
        "treasury takes the SOL (and its price risk)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "vault",
            "docs": [
              "PDA token account (seeds: [\"pool_vault\", mint]) owned by this pool."
            ],
            "type": "pubkey"
          },
          {
            "name": "cash",
            "docs": [
              "Stablecoin the pool holds, tracked internally: tokens sent straight to the vault don't change share value."
            ],
            "type": "u64"
          },
          {
            "name": "principalOut",
            "docs": [
              "Principal lent out and not yet repaid."
            ],
            "type": "u64"
          },
          {
            "name": "totalShares",
            "type": "u64"
          },
          {
            "name": "totalDeposited",
            "type": "u64"
          },
          {
            "name": "totalWithdrawn",
            "type": "u64"
          },
          {
            "name": "interestEarned",
            "docs": [
              "Interest earned by depositors (after the protocol fee)."
            ],
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "vaultBump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "poolDeposited",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "shares",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "poolLoanBoughtOut",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "loan",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "docs": [
              "What the treasury paid the pool: everything the loan still owed."
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "poolWithdrawn",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "shares",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "protocolStats",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "loansOpened",
            "type": "u64"
          },
          {
            "name": "loansRepaid",
            "type": "u64"
          },
          {
            "name": "loansLiquidated",
            "type": "u64"
          },
          {
            "name": "loansDefaulted",
            "type": "u64"
          },
          {
            "name": "activeLoans",
            "type": "u64"
          },
          {
            "name": "collateralLockedLamports",
            "docs": [
              "SOL currently locked in loan escrows (excludes escrow rent)."
            ],
            "type": "u64"
          },
          {
            "name": "totalPrincipalIssued",
            "type": "u64"
          },
          {
            "name": "totalRepaid",
            "type": "u64"
          },
          {
            "name": "outstandingDebt",
            "docs": [
              "Principal still owed on active loans (interest accrues on top, per loan)."
            ],
            "type": "u64"
          },
          {
            "name": "certificatesIssued",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "repaymentMade",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "loan",
            "type": "pubkey"
          },
          {
            "name": "payer",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "repaid",
            "type": "u64"
          },
          {
            "name": "remaining",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "reserve",
      "docs": [
        "A stablecoin reserve (one per mint: USDC, USDT). Its PDA is the delegate the treasury",
        "approves to pay out loans; the legacy vault can still be funded and withdrawn."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "vault",
            "docs": [
              "PDA token account (seeds: [\"vault\", mint]) owned by this reserve."
            ],
            "type": "pubkey"
          },
          {
            "name": "decimals",
            "type": "u8"
          },
          {
            "name": "totalFunded",
            "type": "u64"
          },
          {
            "name": "totalWithdrawn",
            "type": "u64"
          },
          {
            "name": "totalDisbursed",
            "type": "u64"
          },
          {
            "name": "totalRepaid",
            "docs": [
              "Repayments made in this stablecoin (to the treasury, or to the lending pool for pool-funded loans)."
            ],
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "vaultBump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "reserveFunded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "vaultBalance",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "reserveWithdrawn",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "destination",
            "type": "pubkey"
          },
          {
            "name": "vaultBalance",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "updateConfigParams",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "newAdmin",
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "treasury",
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "liquidationThresholdBps",
            "type": {
              "option": "u16"
            }
          },
          {
            "name": "liquidationPenaltyBps",
            "type": {
              "option": "u16"
            }
          },
          {
            "name": "maxPriceAgeSecs",
            "type": {
              "option": "u32"
            }
          },
          {
            "name": "maxConfidenceBps",
            "type": {
              "option": "u16"
            }
          },
          {
            "name": "minPrincipal",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "maxPrincipal",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "paused",
            "type": {
              "option": "bool"
            }
          }
        ]
      }
    }
  ]
};
