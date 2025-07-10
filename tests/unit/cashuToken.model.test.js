import mongoose from "mongoose";
import CashuToken from "../../src/models/CashuToken.model.js";
import CashuWallet from "../../src/models/CashuWallet.model.js";
import { setupTestDB, teardownTestDB } from "../setup.js";

describe("CashuToken Model", () => {
  let testWalletId;

  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  beforeEach(async () => {
    await CashuToken.deleteMany({});
    await CashuWallet.deleteMany({});

    // Create a test wallet for the tokens
    const testWallet = await CashuWallet.create({
      npub: "npub1test123456789abcdefghijklmnopqrstuvwxyz0123456789abcdefghijk",
      mint_url: "https://mint.example.com",
      p2pk_pubkey:
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      p2pk_privkey:
        "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210",
      wallet_config: {
        unit: "sat",
        created_via: "api",
      },
    });
    testWalletId = testWallet._id;
  });

  describe("Model Validation", () => {
    const validTokenData = {
      npub: "npub1test123456789abcdefghijklmnopqrstuvwxyz0123456789abcdefghijk",
      mint_url: "https://mint.example.com",
      transaction_id: "tx_123456789",
      transaction_type: "minted",
      status: "unspent",
      proofs: [
        {
          id: "proof1",
          amount: 500,
          secret: "secret1",
          C: "commitment1",
        },
        {
          id: "proof2",
          amount: 500,
          secret: "secret2",
          C: "commitment2",
        },
      ],
      metadata: {
        source: "lightning",
        lightning_invoice: "lnbc1000n1...",
      },
    };

    it("should create a valid CashuToken", async () => {
      const tokenData = { ...validTokenData, wallet_id: testWalletId };
      const token = new CashuToken(tokenData);
      const savedToken = await token.save();

      expect(savedToken._id).toBeDefined();
      expect(savedToken.npub).toBe(validTokenData.npub);
      expect(savedToken.wallet_id.toString()).toBe(testWalletId.toString());
      expect(savedToken.mint_url).toBe(validTokenData.mint_url);
      expect(savedToken.transaction_id).toBe(validTokenData.transaction_id);
      expect(savedToken.transaction_type).toBe(validTokenData.transaction_type);
      expect(savedToken.status).toBe(validTokenData.status);
      expect(savedToken.proofs).toHaveLength(2);
      expect(savedToken.total_amount).toBe(1000); // Sum of proof amounts
      expect(savedToken.metadata.source).toBe("lightning");
      expect(savedToken.createdAt).toBeDefined();
      expect(savedToken.updatedAt).toBeDefined();
    });

    it("should require npub field", async () => {
      const tokenData = { ...validTokenData, wallet_id: testWalletId };
      delete tokenData.npub;

      const token = new CashuToken(tokenData);

      await expect(token.save()).rejects.toThrow(/npub.*required/);
    });

    it("should require mint_url field", async () => {
      const tokenData = { ...validTokenData, wallet_id: testWalletId };
      delete tokenData.mint_url;

      const token = new CashuToken(tokenData);

      await expect(token.save()).rejects.toThrow(/mint_url.*required/);
    });

    it("should require transaction_id field", async () => {
      const tokenData = { ...validTokenData, wallet_id: testWalletId };
      delete tokenData.transaction_id;

      const token = new CashuToken(tokenData);

      await expect(token.save()).rejects.toThrow(/transaction_id.*required/);
    });

    it("should require transaction_type field", async () => {
      const tokenData = { ...validTokenData, wallet_id: testWalletId };
      delete tokenData.transaction_type;

      const token = new CashuToken(tokenData);

      await expect(token.save()).rejects.toThrow(/transaction_type.*required/);
    });

    it("should validate transaction_type enum values", async () => {
      const tokenData = {
        ...validTokenData,
        wallet_id: testWalletId,
        transaction_type: "invalid_type",
      };

      const token = new CashuToken(tokenData);

      await expect(token.save()).rejects.toThrow(/not a valid enum value/);
    });

    it("should accept valid transaction_type values", async () => {
      const validTypes = ["minted", "sent", "received", "melted", "change"];

      for (const type of validTypes) {
        const tokenData = {
          ...validTokenData,
          wallet_id: testWalletId,
          transaction_type: type,
          transaction_id: `tx_${type}_${Date.now()}`,
        };
        const token = new CashuToken(tokenData);
        const savedToken = await token.save();

        expect(savedToken.transaction_type).toBe(type);
      }
    });

    it("should require wallet_id field", async () => {
      const tokenData = { ...validTokenData };
      delete tokenData.wallet_id;

      const token = new CashuToken(tokenData);

      await expect(token.save()).rejects.toThrow(/Wallet ID is required/);
    });

    it("should default status to unspent when not provided", async () => {
      const tokenData = { ...validTokenData, wallet_id: testWalletId };
      delete tokenData.status;

      const token = new CashuToken(tokenData);
      const savedToken = await token.save();

      expect(savedToken.status).toBe("unspent");
    });

    it("should validate status enum values", async () => {
      const tokenData = {
        ...validTokenData,
        wallet_id: testWalletId,
        status: "invalid_status",
      };

      const token = new CashuToken(tokenData);

      await expect(token.save()).rejects.toThrow(/not a valid enum value/);
    });

    it("should accept valid status values", async () => {
      const validStatuses = ["unspent", "spent", "pending"];

      for (const status of validStatuses) {
        const tokenData = {
          ...validTokenData,
          wallet_id: testWalletId,
          status,
          transaction_id: `tx_${status}_${Date.now()}`,
        };
        const token = new CashuToken(tokenData);
        const savedToken = await token.save();

        expect(savedToken.status).toBe(status);
      }
    });

    it("should require proofs field", async () => {
      const tokenData = { ...validTokenData, wallet_id: testWalletId };
      delete tokenData.proofs;

      const token = new CashuToken(tokenData);

      await expect(token.save()).rejects.toThrow(
        /Proofs array must contain at least one proof/
      );
    });

    it("should validate proofs is an array", async () => {
      const tokenData = {
        ...validTokenData,
        wallet_id: testWalletId,
        proofs: "not_an_array",
      };

      const token = new CashuToken(tokenData);

      await expect(token.save()).rejects.toThrow();
    });

    it("should validate proof structure", async () => {
      const tokenData = {
        ...validTokenData,
        wallet_id: testWalletId,
        proofs: [
          {
            // missing required fields
            amount: 500,
          },
        ],
      };

      const token = new CashuToken(tokenData);

      await expect(token.save()).rejects.toThrow();
    });

    it("should validate proof amount is positive", async () => {
      const tokenData = {
        ...validTokenData,
        wallet_id: testWalletId,
        proofs: [
          {
            id: "proof1",
            amount: -100,
            secret: "secret1",
            C: "commitment1",
          },
        ],
      };

      const token = new CashuToken(tokenData);

      await expect(token.save()).rejects.toThrow(
        /Proof amount must be positive/
      );
    });

    it("should require metadata.source field", async () => {
      const tokenData = { ...validTokenData, wallet_id: testWalletId };
      delete tokenData.metadata.source;

      const token = new CashuToken(tokenData);

      await expect(token.save()).rejects.toThrow(/metadata.source.*required/);
    });

    it("should store metadata as object", async () => {
      const metadata = {
        source: "lightning",
        lightning_invoice: "lnbc1000n1...",
        recipient_info: "test@example.com",
        parent_transaction_id: "parent_tx_123",
      };
      const tokenData = {
        ...validTokenData,
        wallet_id: testWalletId,
        metadata,
      };

      const token = new CashuToken(tokenData);
      const savedToken = await token.save();

      expect(savedToken.metadata.source).toBe("lightning");
      expect(savedToken.metadata.lightning_invoice).toBe("lnbc1000n1...");
      expect(savedToken.metadata.recipient_info).toBe("test@example.com");
      expect(savedToken.metadata.parent_transaction_id).toBe("parent_tx_123");
    });

    it("should automatically set created_at and updated_at", async () => {
      const tokenData = {
        ...validTokenData,
        wallet_id: testWalletId,
        metadata: { source: "lightning" },
      };
      const token = new CashuToken(tokenData);
      const savedToken = await token.save();

      expect(savedToken.createdAt).toBeInstanceOf(Date);
      expect(savedToken.updatedAt).toBeInstanceOf(Date);
      expect(savedToken.createdAt.getTime()).toBeLessThanOrEqual(Date.now());
      expect(savedToken.updatedAt.getTime()).toBeLessThanOrEqual(Date.now());
    });

    it("should update updated_at on save", async () => {
      const tokenData = {
        ...validTokenData,
        wallet_id: testWalletId,
        metadata: { source: "lightning" },
      };
      const token = new CashuToken(tokenData);
      const savedToken = await token.save();
      const originalUpdatedAt = savedToken.updatedAt;

      // Wait a bit to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Update proofs to change total_amount
      savedToken.proofs = [
        {
          id: "proof_updated",
          amount: 2000,
          secret: "secret_updated",
          C: "commitment_updated",
        },
      ];
      const updatedToken = await savedToken.save();

      expect(updatedToken.updatedAt.getTime()).toBeGreaterThan(
        originalUpdatedAt.getTime()
      );
    });
  });

  describe("Model Indexes", () => {
    it("should have index on transaction_id", async () => {
      const indexes = await CashuToken.collection.getIndexes();

      expect(indexes).toHaveProperty("transaction_id_1");
    });

    it("should have compound indexes for performance", async () => {
      const indexes = await CashuToken.collection.getIndexes();

      // Check for compound indexes that actually exist
      expect(indexes).toHaveProperty("npub_1_status_1");
      expect(indexes).toHaveProperty("wallet_id_1_status_1");
      expect(indexes).toHaveProperty("mint_url_1_status_1");
    });

    it("should have index on npub and created_at", async () => {
      const indexes = await CashuToken.collection.getIndexes();

      expect(indexes).toHaveProperty("npub_1_created_at_-1");
    });
  });

  describe("Model Methods", () => {
    const validTokenData = {
      npub: "npub1test123456789abcdefghijklmnopqrstuvwxyz0123456789abcdefghijk",
      mint_url: "https://mint.example.com",
      transaction_id: "tx_123456789",
      transaction_type: "minted",
      status: "unspent",
      proofs: [
        {
          id: "proof1",
          amount: 500,
          secret: "secret1",
          C: "commitment1",
        },
        {
          id: "proof2",
          amount: 500,
          secret: "secret2",
          C: "commitment2",
        },
      ],
      metadata: {
        source: "lightning",
        lightning_invoice: "lnbc1000n1...",
      },
    };

    it("should convert to JSON properly", async () => {
      const tokenData = { ...validTokenData, wallet_id: testWalletId };
      const token = new CashuToken(tokenData);
      const savedToken = await token.save();

      const json = savedToken.toJSON();

      expect(json).toHaveProperty("_id");
      expect(json).toHaveProperty("npub");
      expect(json).toHaveProperty("wallet_id");
      expect(json).toHaveProperty("mint_url");
      expect(json).toHaveProperty("transaction_id");
      expect(json).toHaveProperty("transaction_type");
      expect(json).toHaveProperty("total_amount");
      expect(json).toHaveProperty("status");
      expect(json).toHaveProperty("proofs");
      expect(json).toHaveProperty("metadata");
      expect(json).toHaveProperty("createdAt");
      expect(json).toHaveProperty("updatedAt");
    });
  });

  describe("Unique Constraints", () => {
    const validTokenData = {
      npub: "npub1test123456789abcdefghijklmnopqrstuvwxyz0123456789abcdefghijk",
      mint_url: "https://mint.example.com",
      transaction_id: "tx_123456789",
      transaction_type: "minted",
      status: "unspent",
      proofs: [
        {
          id: "proof1",
          amount: 500,
          secret: "secret1",
          C: "commitment1",
        },
        {
          id: "proof2",
          amount: 500,
          secret: "secret2",
          C: "commitment2",
        },
      ],
      metadata: {
        source: "lightning",
        lightning_invoice: "lnbc1000n1...",
      },
    };

    it("should allow multiple tokens with different transaction_ids", async () => {
      const token1 = new CashuToken({
        ...validTokenData,
        wallet_id: testWalletId,
        transaction_id: "tx_1",
      });
      const token2 = new CashuToken({
        ...validTokenData,
        wallet_id: testWalletId,
        transaction_id: "tx_2",
      });

      await token1.save();
      await token2.save();

      const count = await CashuToken.countDocuments();
      expect(count).toBe(2);
    });

    it("should allow same npub with different mint_urls", async () => {
      const token1 = new CashuToken({
        ...validTokenData,
        wallet_id: testWalletId,
        mint_url: "https://mint1.example.com",
        transaction_id: "tx_1",
      });
      const token2 = new CashuToken({
        ...validTokenData,
        wallet_id: testWalletId,
        mint_url: "https://mint2.example.com",
        transaction_id: "tx_2",
      });

      await token1.save();
      await token2.save();

      const count = await CashuToken.countDocuments();
      expect(count).toBe(2);
    });
  });

  describe("Static Methods", () => {
    const validTokenData = {
      npub: "npub1test123456789abcdefghijklmnopqrstuvwxyz0123456789abcdefghijk",
      mint_url: "https://mint.example.com",
      transaction_id: "tx_123456789",
      transaction_type: "minted",
      status: "unspent",
      proofs: [
        {
          id: "proof1",
          amount: 500,
          secret: "secret1",
          C: "commitment1",
        },
        {
          id: "proof2",
          amount: 500,
          secret: "secret2",
          C: "commitment2",
        },
      ],
      metadata: {
        source: "lightning",
        lightning_invoice: "lnbc1000n1...",
      },
    };

    describe("calculateBalance", () => {
      beforeEach(async () => {
        await CashuToken.deleteMany({});
      });

      describe("Basic functionality", () => {
        it("should calculate total balance for all tokens when status is null", async () => {
          // Create tokens with different statuses
          const token1 = new CashuToken({
            ...validTokenData,
            wallet_id: testWalletId,
            transaction_id: "tx_1",
            status: "unspent",
            proofs: [
              {
                id: "proof1",
                amount: 500,
                secret: "secret1",
                C: "commitment1",
              },
              {
                id: "proof2",
                amount: 500,
                secret: "secret2",
                C: "commitment2",
              },
            ],
          });

          const token2 = new CashuToken({
            ...validTokenData,
            wallet_id: testWalletId,
            transaction_id: "tx_2",
            status: "spent",
            proofs: [
              {
                id: "proof3",
                amount: 500,
                secret: "secret3",
                C: "commitment3",
              },
            ],
          });

          const token3 = new CashuToken({
            ...validTokenData,
            wallet_id: testWalletId,
            transaction_id: "tx_3",
            status: "pending",
            proofs: [
              {
                id: "proof_pending",
                amount: 250,
                secret: "secret_pending",
                C: "commitment_pending",
              },
            ],
          });

          await token1.save();
          await token2.save();
          await token3.save();

          // Test with status = null (should include all tokens)
          const totalBalance = await CashuToken.calculateBalance(
            validTokenData.npub,
            null
          );
          expect(totalBalance).toBe(1750); // 1000 + 500 + 250
        });

        it("should calculate balance for specific status values", async () => {
          // Create tokens with different statuses
          const token1 = new CashuToken({
            ...validTokenData,
            wallet_id: testWalletId,
            transaction_id: "tx_1",
            status: "unspent",
            proofs: [
              {
                id: "proof1",
                amount: 500,
                secret: "secret1",
                C: "commitment1",
              },
              {
                id: "proof2",
                amount: 500,
                secret: "secret2",
                C: "commitment2",
              },
            ],
          });

          const token2 = new CashuToken({
            ...validTokenData,
            wallet_id: testWalletId,
            transaction_id: "tx_2",
            status: "spent",
            proofs: [
              {
                id: "proof3",
                amount: 500,
                secret: "secret3",
                C: "commitment3",
              },
            ],
          });

          const token3 = new CashuToken({
            ...validTokenData,
            wallet_id: testWalletId,
            transaction_id: "tx_3",
            status: "pending",
            proofs: [
              {
                id: "proof_pending",
                amount: 250,
                secret: "secret_pending",
                C: "commitment_pending",
              },
            ],
          });

          await token1.save();
          await token2.save();
          await token3.save();

          // Test with specific status values
          const unspentBalance = await CashuToken.calculateBalance(
            validTokenData.npub,
            "unspent"
          );
          expect(unspentBalance).toBe(1000);

          const spentBalance = await CashuToken.calculateBalance(
            validTokenData.npub,
            "spent"
          );
          expect(spentBalance).toBe(500);

          const pendingBalance = await CashuToken.calculateBalance(
            validTokenData.npub,
            "pending"
          );
          expect(pendingBalance).toBe(250);
        });

        it("should return 0 when no tokens exist", async () => {
          const balance = await CashuToken.calculateBalance(
            validTokenData.npub,
            null
          );
          expect(balance).toBe(0);
        });

        it("should return 0 for non-existent npub", async () => {
          // Create a token for the test npub
          const token = new CashuToken({
            ...validTokenData,
            wallet_id: testWalletId,
            transaction_id: "tx_1",
            status: "unspent",
          });
          await token.save();

          // Test with different npub
          const balance = await CashuToken.calculateBalance(
            "npub1different123456789abcdefghijklmnopqrstuvwxyz0123456789abcdef",
            null
          );
          expect(balance).toBe(0);
        });
      });

      describe("Mint URL filtering", () => {
        beforeEach(async () => {
          // Create tokens for different mints
          const mint1Token1 = new CashuToken({
            ...validTokenData,
            wallet_id: testWalletId,
            transaction_id: "tx_mint1_1",
            mint_url: "https://mint1.example.com",
            status: "unspent",
          });

          const mint1Token2 = new CashuToken({
            ...validTokenData,
            wallet_id: testWalletId,
            transaction_id: "tx_mint1_2",
            mint_url: "https://mint1.example.com",
            status: "spent",
          });

          const mint2Token1 = new CashuToken({
            ...validTokenData,
            wallet_id: testWalletId,
            transaction_id: "tx_mint2_1",
            mint_url: "https://mint2.example.com",
            status: "unspent",
            proofs: [
              {
                id: "proof_mint2_1",
                amount: 750,
                secret: "secret_mint2_1",
                C: "commitment_mint2_1",
              },
            ],
          });

          const mint2Token2 = new CashuToken({
            ...validTokenData,
            wallet_id: testWalletId,
            transaction_id: "tx_mint2_2",
            mint_url: "https://mint2.example.com",
            status: "pending",
            proofs: [
              {
                id: "proof_mint2_pending",
                amount: 250,
                secret: "secret_mint2_pending",
                C: "commitment_mint2_pending",
              },
            ],
          });

          await mint1Token1.save();
          await mint1Token2.save();
          await mint2Token1.save();
          await mint2Token2.save();
        });

        it("should calculate balance for specific mint URL with status=null", async () => {
          const mint1Balance = await CashuToken.calculateBalance(
            validTokenData.npub,
            null,
            "https://mint1.example.com"
          );
          expect(mint1Balance).toBe(2000); // 1000 + 1000 (both use default proofs)

          const mint2Balance = await CashuToken.calculateBalance(
            validTokenData.npub,
            null,
            "https://mint2.example.com"
          );
          expect(mint2Balance).toBe(1000); // 750 + 250
        });

        it("should calculate balance for specific mint URL and status", async () => {
          const mint1UnspentBalance = await CashuToken.calculateBalance(
            validTokenData.npub,
            "unspent",
            "https://mint1.example.com"
          );
          expect(mint1UnspentBalance).toBe(1000);

          const mint1SpentBalance = await CashuToken.calculateBalance(
            validTokenData.npub,
            "spent",
            "https://mint1.example.com"
          );
          expect(mint1SpentBalance).toBe(1000);

          const mint2UnspentBalance = await CashuToken.calculateBalance(
            validTokenData.npub,
            "unspent",
            "https://mint2.example.com"
          );
          expect(mint2UnspentBalance).toBe(750);

          const mint2PendingBalance = await CashuToken.calculateBalance(
            validTokenData.npub,
            "pending",
            "https://mint2.example.com"
          );
          expect(mint2PendingBalance).toBe(250);
        });

        it("should return 0 for non-existent mint URL", async () => {
          const balance = await CashuToken.calculateBalance(
            validTokenData.npub,
            null,
            "https://nonexistent.mint.com"
          );
          expect(balance).toBe(0);
        });
      });

      describe("Edge cases and error handling", () => {
        it("should handle minimal token amounts correctly", async () => {
          const token = new CashuToken({
            ...validTokenData,
            wallet_id: testWalletId,
            transaction_id: "tx_minimal",
            status: "pending",
            proofs: [
              {
                id: "proof_minimal",
                amount: 1, // Minimal positive amount
                secret: "secret_minimal",
                C: "commitment_minimal",
              },
            ],
          });
          await token.save();

          const balance = await CashuToken.calculateBalance(
            validTokenData.npub,
            "pending"
          );
          expect(balance).toBe(1);
        });

        it("should handle mixed token amounts correctly", async () => {
          const tokens = [
            {
              transaction_id: "tx_1",
              status: "unspent",
              proofs: [{ id: "p1", amount: 1, secret: "s1", C: "c1" }],
            },
            {
              transaction_id: "tx_2",
              status: "unspent",
              proofs: [{ id: "p2", amount: 10, secret: "s2", C: "c2" }],
            },
            {
              transaction_id: "tx_3",
              status: "unspent",
              proofs: [{ id: "p3", amount: 100, secret: "s3", C: "c3" }],
            },
            {
              transaction_id: "tx_4",
              status: "unspent",
              proofs: [{ id: "p4", amount: 1000, secret: "s4", C: "c4" }],
            },
            {
              transaction_id: "tx_5",
              status: "unspent",
              proofs: [{ id: "p5", amount: 10000, secret: "s5", C: "c5" }],
            },
          ];

          for (const tokenData of tokens) {
            const token = new CashuToken({
              ...validTokenData,
              wallet_id: testWalletId,
              ...tokenData,
            });
            await token.save();
          }

          const balance = await CashuToken.calculateBalance(
            validTokenData.npub,
            "unspent"
          );
          expect(balance).toBe(11111); // 1 + 10 + 100 + 1000 + 10000
        });

        it("should handle large numbers correctly", async () => {
          const token = new CashuToken({
            ...validTokenData,
            wallet_id: testWalletId,
            transaction_id: "tx_large",
            status: "unspent",
            proofs: [
              {
                id: "large_proof",
                amount: 21000000, // 21 million sats (max Bitcoin supply)
                secret: "large_secret",
                C: "large_commitment",
              },
            ],
          });
          await token.save();

          const balance = await CashuToken.calculateBalance(
            validTokenData.npub,
            "unspent"
          );
          expect(balance).toBe(21000000);
        });

        it("should handle multiple tokens with same status correctly", async () => {
          const tokenCount = 10;
          const amountPerToken = 100;

          for (let i = 0; i < tokenCount; i++) {
            const token = new CashuToken({
              ...validTokenData,
              wallet_id: testWalletId,
              transaction_id: `tx_${i}`,
              status: "unspent",
              proofs: [
                {
                  id: `proof_${i}`,
                  amount: amountPerToken,
                  secret: `secret_${i}`,
                  C: `commitment_${i}`,
                },
              ],
            });
            await token.save();
          }

          const balance = await CashuToken.calculateBalance(
            validTokenData.npub,
            "unspent"
          );
          expect(balance).toBe(tokenCount * amountPerToken);
        });

        it("should handle undefined status parameter", async () => {
          const token = new CashuToken({
            ...validTokenData,
            wallet_id: testWalletId,
            transaction_id: "tx_1",
            status: "unspent",
          });
          await token.save();

          // Test with undefined status (should default to "unspent")
          const balance = await CashuToken.calculateBalance(
            validTokenData.npub,
            undefined
          );
          expect(balance).toBe(1000);
        });

        it("should handle null mintUrl parameter", async () => {
          const token = new CashuToken({
            ...validTokenData,
            wallet_id: testWalletId,
            transaction_id: "tx_1",
            status: "unspent",
          });
          await token.save();

          const balance = await CashuToken.calculateBalance(
            validTokenData.npub,
            "unspent",
            null
          );
          expect(balance).toBe(1000);
        });
      });

      describe("Performance and aggregation", () => {
        it("should efficiently aggregate large numbers of tokens", async () => {
          const tokenCount = 100;
          let expectedTotal = 0;

          // Create many tokens one by one to ensure proper validation
          for (let i = 0; i < tokenCount; i++) {
            const amount = (i + 1) * 10;
            const proofAmount = i % 3 === 2 ? 1 : amount; // 1 sat minimum for pending
            expectedTotal += proofAmount;

            const token = new CashuToken({
              ...validTokenData,
              wallet_id: testWalletId,
              transaction_id: `tx_${i}`,
              status:
                i % 3 === 0 ? "unspent" : i % 3 === 1 ? "spent" : "pending",
              proofs: [
                {
                  id: `proof_${i}`,
                  amount: proofAmount,
                  secret: `secret_${i}`,
                  C: `commitment_${i}`,
                },
              ],
            });
            await token.save();
          }

          const startTime = Date.now();
          const totalBalance = await CashuToken.calculateBalance(
            validTokenData.npub,
            null
          );
          const endTime = Date.now();

          // Verify the calculation is correct
          expect(totalBalance).toBe(expectedTotal);

          // Verify it completes in reasonable time (should be very fast with aggregation)
          expect(endTime - startTime).toBeLessThan(1000); // Less than 1 second
        });

        it("should return consistent results across multiple calls", async () => {
          const token = new CashuToken({
            ...validTokenData,
            wallet_id: testWalletId,
            transaction_id: "tx_1",
            status: "unspent",
          });
          await token.save();

          // Call multiple times and verify consistency
          const results = [];
          for (let i = 0; i < 5; i++) {
            const balance = await CashuToken.calculateBalance(
              validTokenData.npub,
              "unspent"
            );
            results.push(balance);
          }

          // All results should be the same
          expect(results.every((result) => result === 1000)).toBe(true);
        });
      });
    });
  });
});
