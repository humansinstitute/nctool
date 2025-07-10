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
      npub: "npub1test123456789abcdefghijklmnopqrstuvwxyz0123456789abcd",
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
      npub: "npub1test123456789abcdefghijklmnopqrstuvwxyz0123456789abcdef",
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
      expect(savedToken.created_at).toBeDefined();
      expect(savedToken.updated_at).toBeDefined();
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

    it("should require status field", async () => {
      const tokenData = { ...validTokenData, wallet_id: testWalletId };
      delete tokenData.status;

      const token = new CashuToken(tokenData);

      await expect(token.save()).rejects.toThrow(/status.*required/);
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

      await expect(token.save()).rejects.toThrow(/proofs.*required/);
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
        custom_field: "custom_value",
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
      expect(savedToken.metadata.custom_field).toBe("custom_value");
    });

    it("should automatically set created_at and updated_at", async () => {
      const tokenData = { ...validTokenData, wallet_id: testWalletId };
      const token = new CashuToken(tokenData);
      const savedToken = await token.save();

      expect(savedToken.created_at).toBeInstanceOf(Date);
      expect(savedToken.updated_at).toBeInstanceOf(Date);
      expect(savedToken.created_at.getTime()).toBeLessThanOrEqual(Date.now());
      expect(savedToken.updated_at.getTime()).toBeLessThanOrEqual(Date.now());
    });

    it("should update updated_at on save", async () => {
      const tokenData = { ...validTokenData, wallet_id: testWalletId };
      const token = new CashuToken(tokenData);
      const savedToken = await token.save();
      const originalUpdatedAt = savedToken.updated_at;

      // Wait a bit to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10));

      savedToken.total_amount = 2000;
      const updatedToken = await savedToken.save();

      expect(updatedToken.updated_at.getTime()).toBeGreaterThan(
        originalUpdatedAt.getTime()
      );
    });
  });

  describe("Model Indexes", () => {
    it("should have compound index on npub and mint_url", async () => {
      const indexes = await CashuToken.collection.getIndexes();

      expect(indexes).toHaveProperty("npub_1_mint_url_1");
    });

    it("should have index on transaction_id", async () => {
      const indexes = await CashuToken.collection.getIndexes();

      expect(indexes).toHaveProperty("transaction_id_1");
    });

    it("should have index on status", async () => {
      const indexes = await CashuToken.collection.getIndexes();

      expect(indexes).toHaveProperty("status_1");
    });

    it("should have index on created_at", async () => {
      const indexes = await CashuToken.collection.getIndexes();

      expect(indexes).toHaveProperty("created_at_1");
    });
  });

  describe("Model Methods", () => {
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
      expect(json).toHaveProperty("created_at");
      expect(json).toHaveProperty("updated_at");
    });
  });

  describe("Unique Constraints", () => {
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
});
