import mongoose from "mongoose";
import CashuToken from "../../src/models/CashuToken.model.js";
import CashuWallet from "../../src/models/CashuWallet.model.js";
import migration from "../../src/migrations/004_fix_melted_token_status_simple.js";
import { setupTestDB, teardownTestDB } from "../setup.js";

describe("Migration 004: Fix Melted Token Status - Integration Tests", () => {
  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  beforeEach(async () => {
    // Clean up all collections before each test
    await CashuWallet.deleteMany({});
    await CashuToken.deleteMany({});

    // Clean up migration state
    const MigrationState = mongoose.model("MigrationState");
    await MigrationState.deleteMany({});
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
      id: `proof_${index}_${Date.now()}`,
      amount,
      secret: `secret_${index}_${Date.now()}_${Math.random()}`,
      C: `commitment_${index}`,
    }));
  };

  const createTestWallet = async () => {
    return await CashuWallet.create(mockWalletData);
  };

  const createProblematicMeltedToken = async (
    wallet,
    amount = 1000,
    transactionId = null
  ) => {
    const proofs = createMockProofs([amount]);
    const token = new CashuToken({
      npub: mockWalletData.npub,
      wallet_id: wallet._id,
      proofs,
      mint_url: mockWalletData.mint_url,
      transaction_type: "melted",
      transaction_id:
        transactionId || `tx_melted_${Date.now()}_${Math.random()}`,
      status: "unspent", // This is the bug!
      metadata: {
        source: "lightning",
        quote_id: `quote_${Date.now()}`,
      },
    });
    return await token.save();
  };

  const createCorrectMeltedToken = async (
    wallet,
    amount = 1000,
    transactionId = null
  ) => {
    const proofs = createMockProofs([amount]);
    const token = new CashuToken({
      npub: mockWalletData.npub,
      wallet_id: wallet._id,
      proofs,
      mint_url: mockWalletData.mint_url,
      transaction_type: "melted",
      transaction_id:
        transactionId || `tx_melted_correct_${Date.now()}_${Math.random()}`,
      status: "spent", // Correct status
      spent_at: new Date(),
      metadata: {
        source: "lightning",
        quote_id: `quote_${Date.now()}`,
      },
    });
    return await token.save();
  };

  describe("Migration Status and Preview", () => {
    it("should correctly identify tokens needing migration", async () => {
      const wallet = await createTestWallet();

      // Create problematic tokens
      await createProblematicMeltedToken(wallet, 1000);
      await createProblematicMeltedToken(wallet, 2000);

      // Create correct tokens
      await createCorrectMeltedToken(wallet, 500);

      const status = await migration.getStatus();

      expect(status.migrationNeeded).toBe(true);
      expect(status.stats.problematicTokens).toBe(2);
      expect(status.stats.totalMeltedTokens).toBe(3);
      expect(status.stats.spentMeltedTokens).toBe(1);
    });

    it("should generate comprehensive migration preview", async () => {
      const wallet = await createTestWallet();

      // Create test data
      await createProblematicMeltedToken(wallet, 1000, "tx_preview_1");
      await createProblematicMeltedToken(wallet, 2000, "tx_preview_2");

      const preview = await migration.preview();

      expect(preview.migration_name).toBe("004_fix_melted_token_status");
      expect(preview.stats.tokensToMigrate).toBe(2);
      expect(preview.stats.totalAmountAffected).toBe(3000);
      expect(preview.userImpact[mockWalletData.npub]).toBeDefined();
      expect(preview.userImpact[mockWalletData.npub].tokenCount).toBe(2);
      expect(preview.userImpact[mockWalletData.npub].totalAmount).toBe(3000);
      expect(preview.sampleTokens).toHaveLength(2);
    });

    it("should return no migration needed when all tokens are correct", async () => {
      const wallet = await createTestWallet();

      // Create only correct tokens
      await createCorrectMeltedToken(wallet, 1000);
      await createCorrectMeltedToken(wallet, 2000);

      const status = await migration.getStatus();

      expect(status.migrationNeeded).toBe(false);
      expect(status.stats.problematicTokens).toBe(0);
      expect(status.stats.totalMeltedTokens).toBe(2);
      expect(status.stats.spentMeltedTokens).toBe(2);
    });
  });

  describe("Migration UP (Forward Migration)", () => {
    it("should successfully migrate problematic tokens", async () => {
      const wallet = await createTestWallet();

      // Create problematic tokens
      const token1 = await createProblematicMeltedToken(
        wallet,
        1000,
        "tx_up_1"
      );
      const token2 = await createProblematicMeltedToken(
        wallet,
        2000,
        "tx_up_2"
      );

      // Create correct token (should not be affected)
      const correctToken = await createCorrectMeltedToken(
        wallet,
        500,
        "tx_up_correct"
      );

      // Execute migration
      const result = await migration.up();

      expect(result.success).toBe(true);
      expect(result.affectedTokens).toBe(2);
      expect(result.executionTimeMs).toBeGreaterThan(0);

      // Verify tokens were updated
      const updatedToken1 = await CashuToken.findById(token1._id);
      const updatedToken2 = await CashuToken.findById(token2._id);
      const unchangedToken = await CashuToken.findById(correctToken._id);

      expect(updatedToken1.status).toBe("spent");
      expect(updatedToken1.spent_at).toBeDefined();
      expect(updatedToken2.status).toBe("spent");
      expect(updatedToken2.spent_at).toBeDefined();

      // Correct token should remain unchanged
      expect(unchangedToken.status).toBe("spent");
      expect(unchangedToken.spent_at).toEqual(correctToken.spent_at);

      // Verify no problematic tokens remain
      const remainingProblematic = await CashuToken.countDocuments({
        transaction_type: "melted",
        status: "unspent",
      });
      expect(remainingProblematic).toBe(0);
    });

    it("should create migration state and backup", async () => {
      const wallet = await createTestWallet();
      await createProblematicMeltedToken(wallet, 1000, "tx_backup_test");

      const result = await migration.up();

      expect(result.success).toBe(true);

      // Check migration state was created
      const MigrationState = mongoose.model("MigrationState");
      const migrationState = await MigrationState.findOne({
        migration_name: "004_fix_melted_token_status",
      });

      expect(migrationState).toBeDefined();
      expect(migrationState.status).toBe("completed");
      expect(migrationState.affected_tokens).toBe(1);
      expect(migrationState.backup_data).toBeDefined();
      expect(migrationState.backup_data.tokens).toHaveLength(1);
      expect(migrationState.execution_time_ms).toBeGreaterThan(0);
    });

    it("should handle empty dataset gracefully", async () => {
      // No tokens created
      const result = await migration.up();

      expect(result.success).toBe(true);
      expect(result.affectedTokens).toBe(0);
    });

    it("should prevent duplicate migration execution", async () => {
      const wallet = await createTestWallet();
      await createProblematicMeltedToken(wallet, 1000);

      // First migration
      const result1 = await migration.up();
      expect(result1.success).toBe(true);

      // Second migration should fail
      await expect(migration.up()).rejects.toThrow(
        "Migration has already been completed"
      );
    });

    it("should rollback on error and maintain atomicity", async () => {
      const wallet = await createTestWallet();
      const token = await createProblematicMeltedToken(wallet, 1000);

      // Mock a database error during migration
      const originalUpdateMany = CashuToken.updateMany;
      CashuToken.updateMany = jest
        .fn()
        .mockRejectedValue(new Error("Database error"));

      try {
        await expect(migration.up()).rejects.toThrow("Database error");

        // Verify token was not modified
        const unchangedToken = await CashuToken.findById(token._id);
        expect(unchangedToken.status).toBe("unspent");

        // Verify migration state shows failure
        const MigrationState = mongoose.model("MigrationState");
        const migrationState = await MigrationState.findOne({
          migration_name: "004_fix_melted_token_status",
        });
        expect(migrationState.status).toBe("failed");
        expect(migrationState.error_message).toBe("Database error");
      } finally {
        // Restore original method
        CashuToken.updateMany = originalUpdateMany;
      }
    });
  });

  describe("Migration DOWN (Rollback)", () => {
    it("should successfully rollback migration", async () => {
      const wallet = await createTestWallet();

      // Create and migrate tokens
      const token1 = await createProblematicMeltedToken(
        wallet,
        1000,
        "tx_down_1"
      );
      const token2 = await createProblematicMeltedToken(
        wallet,
        2000,
        "tx_down_2"
      );

      // Store original states
      const originalToken1 = { ...token1.toObject() };
      const originalToken2 = { ...token2.toObject() };

      // Execute migration UP
      await migration.up();

      // Verify tokens were migrated
      const migratedToken1 = await CashuToken.findById(token1._id);
      const migratedToken2 = await CashuToken.findById(token2._id);
      expect(migratedToken1.status).toBe("spent");
      expect(migratedToken2.status).toBe("spent");

      // Execute rollback
      const rollbackResult = await migration.down();

      expect(rollbackResult.success).toBe(true);
      expect(rollbackResult.restoredTokens).toBe(2);

      // Verify tokens were restored
      const restoredToken1 = await CashuToken.findById(token1._id);
      const restoredToken2 = await CashuToken.findById(token2._id);

      expect(restoredToken1.status).toBe(originalToken1.status);
      expect(restoredToken1.spent_at).toEqual(originalToken1.spent_at);
      expect(restoredToken2.status).toBe(originalToken2.status);
      expect(restoredToken2.spent_at).toEqual(originalToken2.spent_at);

      // Verify migration state was updated
      const MigrationState = mongoose.model("MigrationState");
      const migrationState = await MigrationState.findOne({
        migration_name: "004_fix_melted_token_status",
      });
      expect(migrationState.status).toBe("rolled_back");
    });

    it("should fail rollback when no migration exists", async () => {
      await expect(migration.down()).rejects.toThrow(
        "Migration state not found"
      );
    });

    it("should fail rollback when migration is not completed", async () => {
      // Create migration state with non-completed status
      const MigrationState = mongoose.model("MigrationState");
      await MigrationState.create({
        migration_name: "004_fix_melted_token_status",
        version: "1.0.0",
        status: "failed",
        started_at: new Date(),
        affected_tokens: 0,
      });

      await expect(migration.down()).rejects.toThrow(
        "Cannot rollback migration with status: failed"
      );
    });

    it("should fail rollback when backup data is missing", async () => {
      // Create migration state without backup data
      const MigrationState = mongoose.model("MigrationState");
      await MigrationState.create({
        migration_name: "004_fix_melted_token_status",
        version: "1.0.0",
        status: "completed",
        started_at: new Date(),
        completed_at: new Date(),
        affected_tokens: 1,
        // No backup_data
      });

      await expect(migration.down()).rejects.toThrow("No backup data found");
    });
  });

  describe("Edge Cases and Error Handling", () => {
    it("should handle large datasets efficiently", async () => {
      const wallet = await createTestWallet();

      // Create many problematic tokens
      const tokenPromises = [];
      for (let i = 0; i < 100; i++) {
        tokenPromises.push(
          createProblematicMeltedToken(wallet, 100, `tx_large_${i}`)
        );
      }
      await Promise.all(tokenPromises);

      const startTime = Date.now();
      const result = await migration.up();
      const executionTime = Date.now() - startTime;

      expect(result.success).toBe(true);
      expect(result.affectedTokens).toBe(100);
      expect(executionTime).toBeLessThan(10000); // Should complete within 10 seconds
    });

    it("should handle tokens with zero amounts", async () => {
      const wallet = await createTestWallet();

      // Create token with zero amount (edge case) - use pending status to allow empty proofs
      const token = new CashuToken({
        npub: mockWalletData.npub,
        wallet_id: wallet._id,
        proofs: [], // Empty proofs array
        mint_url: mockWalletData.mint_url,
        transaction_type: "melted",
        transaction_id: "tx_zero_amount",
        status: "pending", // Use pending to allow empty proofs
        total_amount: 0,
        metadata: {
          source: "lightning",
          quote_id: "quote_zero",
        },
      });
      await token.save();

      // Update to unspent after saving (simulating the bug scenario)
      await CashuToken.findByIdAndUpdate(token._id, { status: "unspent" });

      const result = await migration.up();

      expect(result.success).toBe(true);
      expect(result.affectedTokens).toBe(1);

      const updatedToken = await CashuToken.findById(token._id);
      expect(updatedToken.status).toBe("spent");
    });

    it("should handle corrupted token data gracefully", async () => {
      const wallet = await createTestWallet();

      // Create token with missing required fields (simulating corruption)
      const corruptedToken = new CashuToken({
        npub: mockWalletData.npub,
        wallet_id: wallet._id,
        proofs: createMockProofs([1000]),
        mint_url: mockWalletData.mint_url,
        transaction_type: "melted",
        transaction_id: "tx_corrupted",
        status: "unspent",
        // Missing metadata (required field)
      });

      // Save bypassing validation
      await corruptedToken.save({ validateBeforeSave: false });

      // Migration should still work
      const result = await migration.up();

      expect(result.success).toBe(true);
      expect(result.affectedTokens).toBe(1);
    });

    it("should maintain referential integrity during migration", async () => {
      const wallet = await createTestWallet();
      const token = await createProblematicMeltedToken(wallet, 1000);

      // Execute migration
      await migration.up();

      // Verify wallet reference is maintained
      const updatedToken = await CashuToken.findById(token._id).populate(
        "wallet_id"
      );
      expect(updatedToken.wallet_id).toBeDefined();
      expect(updatedToken.wallet_id._id.toString()).toBe(wallet._id.toString());
    });

    it("should handle concurrent access gracefully", async () => {
      const wallet = await createTestWallet();
      await createProblematicMeltedToken(wallet, 1000);

      // Simulate concurrent migration attempts
      const migrationPromises = [
        migration.up(),
        migration.up(),
        migration.up(),
      ];

      const results = await Promise.allSettled(migrationPromises);

      // Only one should succeed
      const successful = results.filter((r) => r.status === "fulfilled");
      const failed = results.filter((r) => r.status === "rejected");

      expect(successful).toHaveLength(1);
      expect(failed).toHaveLength(2);

      // All failures should be due to duplicate migration
      failed.forEach((result) => {
        expect(result.reason.message).toMatch(
          /Migration (has already been completed|is already running)/
        );
      });
    });
  });

  describe("Performance and Monitoring", () => {
    it("should track execution metrics", async () => {
      const wallet = await createTestWallet();
      await createProblematicMeltedToken(wallet, 1000);

      const result = await migration.up();

      expect(result.executionTimeMs).toBeGreaterThan(0);
      expect(result.affectedTokens).toBe(1);

      // Check migration state has metrics
      const MigrationState = mongoose.model("MigrationState");
      const migrationState = await MigrationState.findOne({
        migration_name: "004_fix_melted_token_status",
      });

      expect(migrationState.execution_time_ms).toBeGreaterThan(0);
      expect(migrationState.started_at).toBeDefined();
      expect(migrationState.completed_at).toBeDefined();
    });

    it("should provide detailed backup information", async () => {
      const wallet = await createTestWallet();
      const token1 = await createProblematicMeltedToken(
        wallet,
        1000,
        "tx_backup_1"
      );
      const token2 = await createProblematicMeltedToken(
        wallet,
        2000,
        "tx_backup_2"
      );

      await migration.up();

      const MigrationState = mongoose.model("MigrationState");
      const migrationState = await MigrationState.findOne({
        migration_name: "004_fix_melted_token_status",
      });

      expect(migrationState.backup_data).toBeDefined();
      expect(migrationState.backup_data.timestamp).toBeDefined();
      expect(migrationState.backup_data.tokens).toHaveLength(2);

      const backup = migrationState.backup_data;
      expect(backup.tokens[0]).toMatchObject({
        _id: expect.any(mongoose.Types.ObjectId),
        status: "unspent",
        spent_at: null,
        npub: mockWalletData.npub,
        total_amount: expect.any(Number),
      });
    });
  });
});
