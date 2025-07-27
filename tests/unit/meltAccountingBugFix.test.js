import walletRepositoryService from "../../src/services/walletRepository.service.js";
import CashuWallet from "../../src/models/CashuWallet.model.js";
import CashuToken from "../../src/models/CashuToken.model.js";
import { setupTestDB, teardownTestDB } from "../setup.js";
import mongoose from "mongoose";

describe("Melt Accounting Bug Fix Tests", () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  beforeEach(async () => {
    await CashuWallet.deleteMany({});
    await CashuToken.deleteMany({});
  });

  const mockWalletData = {
    npub: "npub1qy88wumn8ghj7mn0wd68ytnhd9hx2tcpydkx2efwdahkcmn4wfkx2ps3h2n8h",
    mint_url: "https://mint.example.com",
    p2pk_pubkey:
      "02a1633cafcc01ebfb6d78e39f687a1f0995c62fc95f51ead10a02ee0be551b5dc",
    p2pk_privkey:
      "5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb",
    wallet_config: {
      unit: "sat",
      created_via: "api",
    },
  };

  const createMockProofs = (amounts) => {
    return amounts.map((amount, index) => ({
      id: `proof_${index}`,
      amount,
      secret: `secret_${index}_${Date.now()}`,
      C: `commitment_${index}`,
    }));
  };

  describe("Fixed executeAtomicMelt Function", () => {
    let wallet;
    let initialTokens;

    beforeEach(async () => {
      // Create wallet
      wallet = await walletRepositoryService.createWallet(mockWalletData);

      // Create initial unspent tokens
      const initialProofs = createMockProofs([1000, 2000, 5000]);
      initialTokens = [];

      for (const proof of initialProofs) {
        const token = await walletRepositoryService.storeTokens({
          npub: mockWalletData.npub,
          wallet_id: wallet._id,
          proofs: [proof],
          mint_url: mockWalletData.mint_url,
          transaction_type: "minted",
          transaction_id: `tx_initial_${proof.id}`,
          metadata: {
            source: "mint",
            quote_id: `quote_${proof.id}`,
          },
        });
        initialTokens.push(token);
      }
    });

    it("should not create melted tokens with unspent status", async () => {
      const sendProofs = createMockProofs([8000]);
      const keepProofs = createMockProofs([250]); // Change from selection
      const meltChangeProofs = createMockProofs([65]); // Change from melt

      const meltData = {
        npub: mockWalletData.npub,
        walletId: wallet._id,
        tokenIds: initialTokens.map((t) => t._id),
        sendProofs,
        keepProofs,
        meltChangeProofs,
        transactionId: "tx_melt_test_001",
        meltQuote: {
          quote: "quote_melt_001",
          amount: 8750,
          fee_reserve: 10,
        },
        mintUrl: mockWalletData.mint_url,
      };

      const result = await walletRepositoryService.executeAtomicMelt(meltData);

      // Verify no melted tokens were created
      const meltedTokens = await CashuToken.find({
        npub: mockWalletData.npub,
        transaction_type: "melted",
      });

      expect(meltedTokens).toHaveLength(0);

      // Verify original tokens are marked as spent
      const spentTokens = await CashuToken.find({
        _id: { $in: initialTokens.map((t) => t._id) },
        status: "spent",
      });

      expect(spentTokens).toHaveLength(initialTokens.length);

      // Verify change tokens are created with unspent status
      const changeTokens = await CashuToken.find({
        npub: mockWalletData.npub,
        transaction_type: "change",
        transaction_id: { $regex: `^${meltData.transactionId}_` },
      });

      expect(changeTokens).toHaveLength(2); // Send change + melt change
      changeTokens.forEach((token) => {
        expect(token.status).toBe("unspent");
      });

      // Verify result structure
      expect(result).toMatchObject({
        transactionId: meltData.transactionId,
        spentTokensCount: initialTokens.length,
        keepProofsCount: 1,
        meltChangeProofsCount: 1,
        amountSent: 8750,
        feePaid: 10,
        totalDeducted: 8760,
      });

      expect(result.transactionRecord).toBeDefined();
      expect(result.transactionRecord.transaction_type).toBe("melted");
      expect(result.transactionRecord.status).toBe("completed");
    });

    it("should correctly calculate balance after melt operation", async () => {
      // Initial balance: 1000 + 2000 + 5000 = 8000 sats
      const initialBalance = await walletRepositoryService.calculateBalance(
        mockWalletData.npub
      );
      expect(initialBalance.total_balance).toBe(8000);

      const sendProofs = createMockProofs([7500]);
      const keepProofs = createMockProofs([500]); // Change from selection
      const meltChangeProofs = createMockProofs([25]); // Change from melt

      const meltData = {
        npub: mockWalletData.npub,
        walletId: wallet._id,
        tokenIds: initialTokens.map((t) => t._id),
        sendProofs,
        keepProofs,
        meltChangeProofs,
        transactionId: "tx_balance_test_001",
        meltQuote: {
          quote: "quote_balance_001",
          amount: 7500,
          fee_reserve: 15,
        },
        mintUrl: mockWalletData.mint_url,
      };

      await walletRepositoryService.executeAtomicMelt(meltData);

      // Final balance should be: change from selection + change from melt
      // = 500 + 25 = 525 sats
      const finalBalance = await walletRepositoryService.calculateBalance(
        mockWalletData.npub
      );

      expect(finalBalance.total_balance).toBe(525);
      expect(finalBalance.unspent_balance).toBe(525);
      expect(finalBalance.spent_balance).toBe(8000); // Original tokens
    });

    it("should handle melt operation with no change proofs", async () => {
      const sendProofs = createMockProofs([8000]);
      const keepProofs = []; // No change from selection
      const meltChangeProofs = []; // No change from melt

      const meltData = {
        npub: mockWalletData.npub,
        walletId: wallet._id,
        tokenIds: initialTokens.map((t) => t._id),
        sendProofs,
        keepProofs,
        meltChangeProofs,
        transactionId: "tx_no_change_001",
        meltQuote: {
          quote: "quote_no_change_001",
          amount: 8000,
          fee_reserve: 0,
        },
        mintUrl: mockWalletData.mint_url,
      };

      const result = await walletRepositoryService.executeAtomicMelt(meltData);

      // Verify no change tokens were created
      const changeTokens = await CashuToken.find({
        npub: mockWalletData.npub,
        transaction_type: "change",
        transaction_id: meltData.transactionId,
      });

      expect(changeTokens).toHaveLength(0);

      // Final balance should be 0
      const finalBalance = await walletRepositoryService.calculateBalance(
        mockWalletData.npub
      );

      expect(finalBalance.total_balance).toBe(0);

      expect(result.sendChangeTokenId).toBeNull();
      expect(result.meltChangeTokenId).toBeNull();
      expect(result.keepProofsCount).toBe(0);
      expect(result.meltChangeProofsCount).toBe(0);
    });

    it("should rollback on error and maintain atomicity", async () => {
      const sendProofs = createMockProofs([8000]);
      const keepProofs = createMockProofs([250]);
      const meltChangeProofs = createMockProofs([65]);

      // Create invalid melt data that will cause an error
      const invalidMeltData = {
        npub: mockWalletData.npub,
        walletId: wallet._id,
        tokenIds: ["invalid_token_id"], // This will cause an error
        sendProofs,
        keepProofs,
        meltChangeProofs,
        transactionId: "tx_rollback_test_001",
        meltQuote: {
          quote: "quote_rollback_001",
          amount: 8000,
          fee_reserve: 10,
        },
        mintUrl: mockWalletData.mint_url,
      };

      await expect(
        walletRepositoryService.executeAtomicMelt(invalidMeltData)
      ).rejects.toThrow();

      // Verify original tokens are still unspent
      const originalTokens = await CashuToken.find({
        _id: { $in: initialTokens.map((t) => t._id) },
      });

      originalTokens.forEach((token) => {
        expect(token.status).toBe("unspent");
      });

      // Verify no change tokens were created
      const changeTokens = await CashuToken.find({
        npub: mockWalletData.npub,
        transaction_type: "change",
        transaction_id: invalidMeltData.transactionId,
      });

      expect(changeTokens).toHaveLength(0);

      // Verify balance is unchanged
      const balance = await walletRepositoryService.calculateBalance(
        mockWalletData.npub
      );
      expect(balance.total_balance).toBe(8000);
    });
  });

  describe("Enhanced storeTokens Function", () => {
    let wallet;

    beforeEach(async () => {
      wallet = await walletRepositoryService.createWallet(mockWalletData);
    });

    it("should apply explicit status parameter correctly", async () => {
      const proofs = createMockProofs([1000]);

      const tokenData = {
        npub: mockWalletData.npub,
        wallet_id: wallet._id,
        proofs,
        mint_url: mockWalletData.mint_url,
        transaction_type: "melted",
        transaction_id: "tx_explicit_status_001",
        metadata: {
          source: "lightning",
          quote_id: "quote_001",
        },
      };

      // Store with explicit spent status
      const token = await walletRepositoryService.storeTokens(tokenData, {
        explicitStatus: "spent",
      });

      expect(token.status).toBe("spent");
      expect(token.spent_at).toBeDefined();
    });

    it("should apply status rules based on transaction type", async () => {
      const proofs = createMockProofs([1000]);

      const testCases = [
        { transaction_type: "change", expectedStatus: "unspent" },
        { transaction_type: "melted", expectedStatus: "spent" },
        { transaction_type: "received", expectedStatus: "unspent" },
        { transaction_type: "minted", expectedStatus: "unspent" },
        { transaction_type: "sent", expectedStatus: "spent" },
      ];

      for (const testCase of testCases) {
        const tokenData = {
          npub: mockWalletData.npub,
          wallet_id: wallet._id,
          proofs,
          mint_url: mockWalletData.mint_url,
          transaction_type: testCase.transaction_type,
          transaction_id: `tx_${testCase.transaction_type}_001`,
          metadata: {
            source: "test",
            quote_id: "quote_001",
          },
        };

        const token = await walletRepositoryService.storeTokens(tokenData);
        expect(token.status).toBe(testCase.expectedStatus);

        // Clean up for next iteration
        await CashuToken.deleteOne({ _id: token._id });
      }
    });

    it("should validate explicit status parameter", async () => {
      const proofs = createMockProofs([1000]);

      const tokenData = {
        npub: mockWalletData.npub,
        wallet_id: wallet._id,
        proofs,
        mint_url: mockWalletData.mint_url,
        transaction_type: "minted",
        transaction_id: "tx_invalid_status_001",
        metadata: {
          source: "mint",
          quote_id: "quote_001",
        },
      };

      await expect(
        walletRepositoryService.storeTokens(tokenData, {
          explicitStatus: "invalid_status",
        })
      ).rejects.toThrow("Invalid explicit status");
    });

    it("should override transaction type rules with explicit status", async () => {
      const proofs = createMockProofs([1000]);

      const tokenData = {
        npub: mockWalletData.npub,
        wallet_id: wallet._id,
        proofs,
        mint_url: mockWalletData.mint_url,
        transaction_type: "melted", // Would normally be "spent"
        transaction_id: "tx_override_001",
        metadata: {
          source: "lightning",
          quote_id: "quote_001",
        },
      };

      // Override with explicit unspent status (for testing purposes)
      const token = await walletRepositoryService.storeTokens(tokenData, {
        explicitStatus: "unspent",
      });

      expect(token.status).toBe("unspent");
      expect(token.spent_at).toBeNull();
    });
  });

  describe("Balance Validation Functions", () => {
    let wallet;

    beforeEach(async () => {
      wallet = await walletRepositoryService.createWallet(mockWalletData);
    });

    it("should detect problematic melted tokens with unspent status", async () => {
      // Create a problematic melted token with unspent status (simulating the bug)
      const problematicToken = new CashuToken({
        npub: mockWalletData.npub,
        wallet_id: wallet._id,
        proofs: createMockProofs([1000]),
        mint_url: mockWalletData.mint_url,
        transaction_type: "melted",
        transaction_id: "tx_problematic_001",
        status: "unspent", // This is the bug!
        metadata: {
          source: "lightning",
          quote_id: "quote_001",
        },
      });
      await problematicToken.save();

      const validation =
        await walletRepositoryService.validateBalanceConsistency(
          mockWalletData.npub
        );

      expect(validation.isValid).toBe(false);
      expect(validation.issues.problematicMeltedTokens).toBe(1);
      expect(validation.details.problematicMeltedTokens).toHaveLength(1);
      expect(validation.details.problematicMeltedTokens[0].transaction_id).toBe(
        "tx_problematic_001"
      );
    });

    it("should detect duplicate proof secrets", async () => {
      const duplicateProof = createMockProofs([1000])[0];

      // Create two tokens with the same proof secret
      const token1 = new CashuToken({
        npub: mockWalletData.npub,
        wallet_id: wallet._id,
        proofs: [duplicateProof],
        mint_url: mockWalletData.mint_url,
        transaction_type: "minted",
        transaction_id: "tx_duplicate_001",
        status: "unspent",
        metadata: {
          source: "mint",
          quote_id: "quote_001",
        },
      });

      const token2 = new CashuToken({
        npub: mockWalletData.npub,
        wallet_id: wallet._id,
        proofs: [duplicateProof], // Same proof!
        mint_url: mockWalletData.mint_url,
        transaction_type: "received",
        transaction_id: "tx_duplicate_002",
        status: "unspent",
        metadata: {
          source: "receive",
          quote_id: "quote_002",
        },
      });

      await token1.save();
      await token2.save();

      const validation =
        await walletRepositoryService.validateBalanceConsistency(
          mockWalletData.npub
        );

      expect(validation.isValid).toBe(false);
      expect(validation.issues.duplicateSecrets).toBe(1);
      expect(validation.details.duplicateSecrets).toContain(
        duplicateProof.secret
      );
    });

    it("should pass validation for clean wallet state", async () => {
      // Create properly structured tokens
      const token1 = await walletRepositoryService.storeTokens({
        npub: mockWalletData.npub,
        wallet_id: wallet._id,
        proofs: createMockProofs([1000]),
        mint_url: mockWalletData.mint_url,
        transaction_type: "minted",
        transaction_id: "tx_clean_001",
        metadata: {
          source: "mint",
          quote_id: "quote_001",
        },
      });

      const token2 = await walletRepositoryService.storeTokens({
        npub: mockWalletData.npub,
        wallet_id: wallet._id,
        proofs: createMockProofs([2000]),
        mint_url: mockWalletData.mint_url,
        transaction_type: "received",
        transaction_id: "tx_clean_002",
        metadata: {
          source: "receive",
          quote_id: "quote_002",
        },
      });

      const validation =
        await walletRepositoryService.validateBalanceConsistency(
          mockWalletData.npub
        );

      expect(validation.isValid).toBe(true);
      expect(validation.issues.problematicMeltedTokens).toBe(0);
      expect(validation.issues.duplicateSecrets).toBe(0);
      expect(validation.issues.hasNegativeBalance).toBe(false);
    });
  });

  describe("checkForUnmigratedTokens Function", () => {
    let wallet;

    beforeEach(async () => {
      wallet = await walletRepositoryService.createWallet(mockWalletData);
    });

    it("should identify tokens needing migration", async () => {
      // Create tokens with various issues
      const problematicMeltedToken = new CashuToken({
        npub: mockWalletData.npub,
        wallet_id: wallet._id,
        proofs: createMockProofs([1000]),
        mint_url: mockWalletData.mint_url,
        transaction_type: "melted",
        transaction_id: "tx_migration_001",
        status: "unspent", // Issue: melted with unspent status
        metadata: {
          source: "lightning",
          quote_id: "quote_001",
        },
      });

      const missingMetadataToken = new CashuToken({
        npub: mockWalletData.npub,
        wallet_id: wallet._id,
        proofs: createMockProofs([2000]),
        mint_url: mockWalletData.mint_url,
        transaction_type: "minted",
        transaction_id: "tx_migration_002",
        status: "unspent",
        metadata: {}, // Issue: missing source
      });

      await problematicMeltedToken.save();
      await missingMetadataToken.save();

      const migrationCheck =
        await walletRepositoryService.checkForUnmigratedTokens(
          mockWalletData.npub
        );

      expect(migrationCheck.migrationNeeded).toBe(true);
      expect(migrationCheck.suspiciousTokensCount).toBe(2);
      expect(migrationCheck.recommendations).toContain(
        "Fix 1 melted tokens with incorrect unspent status"
      );
      expect(migrationCheck.recommendations).toContain(
        "Update metadata for 1 tokens missing source information"
      );

      const suspiciousTokenIds = migrationCheck.suspiciousTokens.map(
        (t) => t.transaction_id
      );
      expect(suspiciousTokenIds).toContain("tx_migration_001");
      expect(suspiciousTokenIds).toContain("tx_migration_002");
    });

    it("should return no migration needed for clean tokens", async () => {
      // Create properly structured tokens
      await walletRepositoryService.storeTokens({
        npub: mockWalletData.npub,
        wallet_id: wallet._id,
        proofs: createMockProofs([1000]),
        mint_url: mockWalletData.mint_url,
        transaction_type: "minted",
        transaction_id: "tx_clean_migration_001",
        metadata: {
          source: "mint",
          quote_id: "quote_001",
        },
      });

      const migrationCheck =
        await walletRepositoryService.checkForUnmigratedTokens(
          mockWalletData.npub
        );

      expect(migrationCheck.migrationNeeded).toBe(false);
      expect(migrationCheck.suspiciousTokensCount).toBe(0);
      expect(migrationCheck.recommendations).toHaveLength(0);
    });
  });
});
