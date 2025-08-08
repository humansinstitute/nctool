import mongoose from "mongoose";
import { setupTestDB, teardownTestDB, clearTestDB } from "../setup.js";
import CashuWallet from "../../src/models/CashuWallet.model.js";
import CashuToken from "../../src/models/CashuToken.model.js";
import walletRepositoryService from "../../src/services/walletRepository.service.js";

describe("Melt Accounting Bug Fix Tests", () => {
  const testNpub = "npub1test123456789abcdefghijklmnopqrstuvwxyz0123456789abcdef";
  const testMintUrl = "https://mint.example.com";
  let testWallet;

  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();

    // Create test wallet
    testWallet = await CashuWallet.create({
      npub: testNpub,
      mint_url: testMintUrl,
      p2pk_pubkey: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      p2pk_privkey: "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210",
      wallet_config: {
        unit: "sat",
        created_via: "api",
      },
    });
  });

  describe("Double-Counting Prevention", () => {
    it("should prevent creation of melted token documents with consumed proofs", async () => {
      // Setup: Create source tokens
      const sourceToken = await CashuToken.create({
        npub: testNpub,
        wallet_id: testWallet._id,
        mint_url: testMintUrl,
        transaction_id: "tx_source_1",
        transaction_type: "minted",
        status: "unspent",
        proofs: [
          { id: "proof1", amount: 500, secret: "secret1", C: "commitment1" },
          { id: "proof2", amount: 300, secret: "secret2", C: "commitment2" },
        ],
        metadata: { source: "lightning" },
      });

      const keepProofs = [
        { id: "keep1", amount: 100, secret: "keep_secret1", C: "keep_commitment1" },
      ];

      const meltChangeProofs = [
        { id: "change1", amount: 50, secret: "change_secret1", C: "change_commitment1" },
      ];

      // Execute atomic melt operation
      const result = await walletRepositoryService.executeAtomicMelt(
        [sourceToken._id],
        keepProofs,
        meltChangeProofs,
        "tx_melt_123",
        {
          npub: testNpub,
          wallet_id: testWallet._id,
          mint_url: testMintUrl,
          parent_transaction_id: "tx_melt_123",
        }
      );

      expect(result.success).toBe(true);

      // CRITICAL: Verify no "melted" token documents were created with consumed proofs
      const meltedTokens = await CashuToken.find({
        npub: testNpub,
        transaction_type: "melted",
      });
      expect(meltedTokens).toHaveLength(0);

      // Verify source token was marked as spent
      const updatedSourceToken = await CashuToken.findById(sourceToken._id);
      expect(updatedSourceToken.status).toBe("spent");
      expect(updatedSourceToken.spent_at).toBeDefined();

      // Verify only change tokens were created
      const changeTokens = await CashuToken.find({
        npub: testNpub,
        transaction_type: "change",
        status: "unspent",
      });
      expect(changeTokens).toHaveLength(2); // keep + melt change

      // Verify no consumed proofs are stored in any new token documents
      const allNewTokens = await CashuToken.find({
        npub: testNpub,
        transaction_id: { $regex: /^tx_melt_123/ },
      });

      for (const token of allNewTokens) {
        const tokenSecrets = token.proofs.map(p => p.secret);
        expect(tokenSecrets).not.toContain("secret1"); // Original consumed proof
        expect(tokenSecrets).not.toContain("secret2"); // Original consumed proof
      }
    });

    it("should maintain accurate balance calculations after melt operations", async () => {
      // Setup: Create initial tokens with known amounts
      await CashuToken.create({
        npub: testNpub,
        wallet_id: testWallet._id,
        mint_url: testMintUrl,
        transaction_id: "tx_initial_1",
        transaction_type: "minted",
        status: "unspent",
        proofs: [
          { id: "proof1", amount: 1000, secret: "secret1", C: "commitment1" },
        ],
        metadata: { source: "lightning" },
      });

      await CashuToken.create({
        npub: testNpub,
        wallet_id: testWallet._id,
        mint_url: testMintUrl,
        transaction_id: "tx_initial_2",
        transaction_type: "minted",
        status: "unspent",
        proofs: [
          { id: "proof2", amount: 500, secret: "secret2", C: "commitment2" },
        ],
        metadata: { source: "lightning" },
      });

      // Calculate initial balance
      const initialBalance = await walletRepositoryService.calculateBalance(testNpub, testMintUrl);
      expect(initialBalance.unspent_balance).toBe(1500);
      expect(initialBalance.spent_balance).toBe(0);

      // Execute melt operation that consumes 1000 sats and creates 200 sats change
      const sourceTokenIds = await CashuToken.find({
        npub: testNpub,
        transaction_id: "tx_initial_1",
      }).distinct("_id");

      const keepProofs = [
        { id: "keep1", amount: 150, secret: "keep_secret1", C: "keep_commitment1" },
      ];

      const meltChangeProofs = [
        { id: "change1", amount: 50, secret: "change_secret1", C: "change_commitment1" },
      ];

      await walletRepositoryService.executeAtomicMelt(
        sourceTokenIds,
        keepProofs,
        meltChangeProofs,
        "tx_melt_123",
        {
          npub: testNpub,
          wallet_id: testWallet._id,
          mint_url: testMintUrl,
        }
      );

      // Calculate balance after melt
      const finalBalance = await walletRepositoryService.calculateBalance(testNpub, testMintUrl);

      // Expected: 500 (untouched) + 150 (keep) + 50 (melt change) = 700 unspent
      // Expected: 1000 (consumed in melt) = 1000 spent
      expect(finalBalance.unspent_balance).toBe(700);
      expect(finalBalance.spent_balance).toBe(1000);
      expect(finalBalance.total_balance).toBe(1700); // No double counting

      // Verify detailed balance breakdown
      const detailedBalance = await walletRepositoryService.getDetailedBalance(testNpub, testMintUrl);
      expect(detailedBalance.token_counts.unspent).toBe(3); // 1 original + 2 change tokens
      expect(detailedBalance.token_counts.spent).toBe(1); // 1 consumed token
      expect(detailedBalance.token_counts.pending).toBe(0);
    });

    it("should prevent double-counting when multiple melt operations occur", async () => {
      // Setup: Create initial tokens
      const token1 = await CashuToken.create({
        npub: testNpub,
        wallet_id: testWallet._id,
        mint_url: testMintUrl,
        transaction_id: "tx_initial_1",
        transaction_type: "minted",
        status: "unspent",
        proofs: [
          { id: "proof1", amount: 1000, secret: "secret1", C: "commitment1" },
        ],
        metadata: { source: "lightning" },
      });

      const token2 = await CashuToken.create({
        npub: testNpub,
        wallet_id: testWallet._id,
        mint_url: testMintUrl,
        transaction_id: "tx_initial_2",
        transaction_type: "minted",
        status: "unspent",
        proofs: [
          { id: "proof2", amount: 800, secret: "secret2", C: "commitment2" },
        ],
        metadata: { source: "lightning" },
      });

      // First melt operation
      await walletRepositoryService.executeAtomicMelt(
        [token1._id],
        [{ id: "keep1", amount: 200, secret: "keep1", C: "keep_c1" }],
        [{ id: "change1", amount: 50, secret: "change1", C: "change_c1" }],
        "tx_melt_1",
        {
          npub: testNpub,
          wallet_id: testWallet._id,
          mint_url: testMintUrl,
        }
      );

      // Second melt operation
      await walletRepositoryService.executeAtomicMelt(
        [token2._id],
        [{ id: "keep2", amount: 150, secret: "keep2", C: "keep_c2" }],
        [{ id: "change2", amount: 100, secret: "change2", C: "change_c2" }],
        "tx_melt_2",
        {
          npub: testNpub,
          wallet_id: testWallet._id,
          mint_url: testMintUrl,
        }
      );

      // Verify final balance accuracy
      const finalBalance = await walletRepositoryService.calculateBalance(testNpub, testMintUrl);

      // Expected unspent: 200 + 50 + 150 + 100 = 500
      // Expected spent: 1000 + 800 = 1800
      // Expected total: 500 + 1800 = 2300 (no double counting)
      expect(finalBalance.unspent_balance).toBe(500);
      expect(finalBalance.spent_balance).toBe(1800);
      expect(finalBalance.total_balance).toBe(2300);

      // Verify no melted tokens exist
      const meltedTokens = await CashuToken.find({
        npub: testNpub,
        transaction_type: "melted",
      });
      expect(meltedTokens).toHaveLength(0);

      // Verify all change tokens are properly categorized
      const changeTokens = await CashuToken.find({
        npub: testNpub,
        transaction_type: "change",
        status: "unspent",
      });
      expect(changeTokens).toHaveLength(4); // 2 keep + 2 melt change
    });
  });

  describe("Atomic Transaction Rollback Scenarios", () => {
    it("should rollback completely on database failure during atomic melt", async () => {
      // Setup: Create source token
      const sourceToken = await CashuToken.create({
        npub: testNpub,
        wallet_id: testWallet._id,
        mint_url: testMintUrl,
        transaction_id: "tx_source_1",
        transaction_type: "minted",
        status: "unspent",
        proofs: [
          { id: "proof1", amount: 1000, secret: "secret1", C: "commitment1" },
        ],
        metadata: { source: "lightning" },
      });

      // Mock a database error during token creation (simulate by providing invalid data)
      const invalidKeepProofs = [
        { 
          // Missing required fields to trigger validation error
          amount: 100, 
          secret: "keep_secret1", 
          C: "keep_commitment1" 
        },
      ];

      // Attempt atomic melt operation that should fail
      await expect(
        walletRepositoryService.executeAtomicMelt(
          [sourceToken._id],
          invalidKeepProofs,
          [],
          "tx_melt_fail",
          {
            npub: testNpub,
            wallet_id: testWallet._id,
            mint_url: testMintUrl,
          }
        )
      ).rejects.toThrow();

      // Verify rollback: source token should remain unspent
      const unchangedToken = await CashuToken.findById(sourceToken._id);
      expect(unchangedToken.status).toBe("unspent");
      expect(unchangedToken.spent_at).toBeNull();

      // Verify no partial state changes occurred
      const allTokens = await CashuToken.find({ npub: testNpub });
      expect(allTokens).toHaveLength(1); // Only original token
      expect(allTokens[0]._id.toString()).toBe(sourceToken._id.toString());
    });

    it("should handle concurrent melt operations with proper isolation", async () => {
      // Setup: Create source tokens
      const token1 = await CashuToken.create({
        npub: testNpub,
        wallet_id: testWallet._id,
        mint_url: testMintUrl,
        transaction_id: "tx_source_1",
        transaction_type: "minted",
        status: "unspent",
        proofs: [
          { id: "proof1", amount: 1000, secret: "secret1", C: "commitment1" },
        ],
        metadata: { source: "lightning" },
      });

      const token2 = await CashuToken.create({
        npub: testNpub,
        wallet_id: testWallet._id,
        mint_url: testMintUrl,
        transaction_id: "tx_source_2",
        transaction_type: "minted",
        status: "unspent",
        proofs: [
          { id: "proof2", amount: 800, secret: "secret2", C: "commitment2" },
        ],
        metadata: { source: "lightning" },
      });

      // Execute concurrent melt operations
      const melt1Promise = walletRepositoryService.executeAtomicMelt(
        [token1._id],
        [{ id: "keep1", amount: 200, secret: "keep1", C: "keep_c1" }],
        [{ id: "change1", amount: 50, secret: "change1", C: "change_c1" }],
        "tx_melt_1",
        {
          npub: testNpub,
          wallet_id: testWallet._id,
          mint_url: testMintUrl,
        }
      );

      const melt2Promise = walletRepositoryService.executeAtomicMelt(
        [token2._id],
        [{ id: "keep2", amount: 150, secret: "keep2", C: "keep_c2" }],
        [{ id: "change2", amount: 100, secret: "change2", C: "change_c2" }],
        "tx_melt_2",
        {
          npub: testNpub,
          wallet_id: testWallet._id,
          mint_url: testMintUrl,
        }
      );

      // Both operations should succeed independently
      const [result1, result2] = await Promise.all([melt1Promise, melt2Promise]);

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);

      // Verify both source tokens were spent
      const spentTokens = await CashuToken.find({
        npub: testNpub,
        status: "spent",
      });
      expect(spentTokens).toHaveLength(2);

      // Verify all change tokens were created
      const changeTokens = await CashuToken.find({
        npub: testNpub,
        transaction_type: "change",
        status: "unspent",
      });
      expect(changeTokens).toHaveLength(4); // 2 operations × 2 change types each

      // Verify balance consistency
      const finalBalance = await walletRepositoryService.calculateBalance(testNpub, testMintUrl);
      expect(finalBalance.unspent_balance).toBe(500); // 200+50+150+100
      expect(finalBalance.spent_balance).toBe(1800); // 1000+800
    });
  });

  describe("Change Handling Verification", () => {
    it("should correctly handle keep proofs without storing consumed proofs", async () => {
      // Setup: Create source token with multiple proofs
      const sourceToken = await CashuToken.create({
        npub: testNpub,
        wallet_id: testWallet._id,
        mint_url: testMintUrl,
        transaction_id: "tx_source_1",
        transaction_type: "minted",
        status: "unspent",
        proofs: [
          { id: "proof1", amount: 500, secret: "secret1", C: "commitment1" },
          { id: "proof2", amount: 300, secret: "secret2", C: "commitment2" },
          { id: "proof3", amount: 200, secret: "secret3", C: "commitment3" },
        ],
        metadata: { source: "lightning" },
      });

      const keepProofs = [
        { id: "keep1", amount: 150, secret: "keep_secret1", C: "keep_commitment1" },
        { id: "keep2", amount: 100, secret: "keep_secret2", C: "keep_commitment2" },
      ];

      // Execute atomic melt with only keep proofs (no melt change)
      const result = await walletRepositoryService.executeAtomicMelt(
        [sourceToken._id],
        keepProofs,
        [], // No melt change proofs
        "tx_melt_123",
        {
          npub: testNpub,
          wallet_id: testWallet._id,
          mint_url: testMintUrl,
        }
      );

      expect(result.success).toBe(true);
      expect(result.keep_amount).toBe(250); // 150 + 100
      expect(result.melt_change_amount).toBe(0);

      // Verify keep change token was created correctly
      const keepChangeTokens = await CashuToken.find({
        npub: testNpub,
        transaction_id: "tx_melt_123_keep",
      });
      expect(keepChangeTokens).toHaveLength(1);
      expect(keepChangeTokens[0].transaction_type).toBe("change");
      expect(keepChangeTokens[0].status).toBe("unspent");
      expect(keepChangeTokens[0].total_amount).toBe(250);
      expect(keepChangeTokens[0].proofs).toHaveLength(2);

      // Verify keep proofs are stored correctly (not consumed proofs)
      const keepSecrets = keepChangeTokens[0].proofs.map(p => p.secret);
      expect(keepSecrets).toContain("keep_secret1");
      expect(keepSecrets).toContain("keep_secret2");
      expect(keepSecrets).not.toContain("secret1"); // Original consumed
      expect(keepSecrets).not.toContain("secret2"); // Original consumed
      expect(keepSecrets).not.toContain("secret3"); // Original consumed
    });

    it("should correctly handle melt change proofs without storing consumed proofs", async () => {
      // Setup: Create source token
      const sourceToken = await CashuToken.create({
        npub: testNpub,
        wallet_id: testWallet._id,
        mint_url: testMintUrl,
        transaction_id: "tx_source_1",
        transaction_type: "minted",
        status: "unspent",
        proofs: [
          { id: "proof1", amount: 1000, secret: "secret1", C: "commitment1" },
        ],
        metadata: { source: "lightning" },
      });

      const meltChangeProofs = [
        { id: "change1", amount: 75, secret: "change_secret1", C: "change_commitment1" },
        { id: "change2", amount: 25, secret: "change_secret2", C: "change_commitment2" },
      ];

      // Execute atomic melt with only melt change proofs (no keep proofs)
      const result = await walletRepositoryService.executeAtomicMelt(
        [sourceToken._id],
        [], // No keep proofs
        meltChangeProofs,
        "tx_melt_123",
        {
          npub: testNpub,
          wallet_id: testWallet._id,
          mint_url: testMintUrl,
        }
      );

      expect(result.success).toBe(true);
      expect(result.keep_amount).toBe(0);
      expect(result.melt_change_amount).toBe(100); // 75 + 25

      // Verify melt change token was created correctly
      const meltChangeTokens = await CashuToken.find({
        npub: testNpub,
        transaction_id: "tx_melt_123_melt_change",
      });
      expect(meltChangeTokens).toHaveLength(1);
      expect(meltChangeTokens[0].transaction_type).toBe("change");
      expect(meltChangeTokens[0].status).toBe("unspent");
      expect(meltChangeTokens[0].total_amount).toBe(100);
      expect(meltChangeTokens[0].proofs).toHaveLength(2);

      // Verify melt change proofs are stored correctly (not consumed proofs)
      const changeSecrets = meltChangeTokens[0].proofs.map(p => p.secret);
      expect(changeSecrets).toContain("change_secret1");
      expect(changeSecrets).toContain("change_secret2");
      expect(changeSecrets).not.toContain("secret1"); // Original consumed
    });

    it("should handle both keep and melt change proofs in single operation", async () => {
      // Setup: Create source tokens
      const sourceToken1 = await CashuToken.create({
        npub: testNpub,
        wallet_id: testWallet._id,
        mint_url: testMintUrl,
        transaction_id: "tx_source_1",
        transaction_type: "minted",
        status: "unspent",
        proofs: [
          { id: "proof1", amount: 800, secret: "secret1", C: "commitment1" },
        ],
        metadata: { source: "lightning" },
      });

      const sourceToken2 = await CashuToken.create({
        npub: testNpub,
        wallet_id: testWallet._id,
        mint_url: testMintUrl,
        transaction_id: "tx_source_2",
        transaction_type: "minted",
        status: "unspent",
        proofs: [
          { id: "proof2", amount: 400, secret: "secret2", C: "commitment2" },
        ],
        metadata: { source: "lightning" },
      });

      const keepProofs = [
        { id: "keep1", amount: 200, secret: "keep_secret1", C: "keep_commitment1" },
      ];

      const meltChangeProofs = [
        { id: "change1", amount: 150, secret: "change_secret1", C: "change_commitment1" },
      ];

      // Execute atomic melt with both types of change
      const result = await walletRepositoryService.executeAtomicMelt(
        [sourceToken1._id, sourceToken2._id],
        keepProofs,
        meltChangeProofs,
        "tx_melt_123",
        {
          npub: testNpub,
          wallet_id: testWallet._id,
          mint_url: testMintUrl,
        }
      );

      expect(result.success).toBe(true);
      expect(result.source_tokens_spent).toBe(2);
      expect(result.keep_amount).toBe(200);
      expect(result.melt_change_amount).toBe(150);
      expect(result.operations).toHaveLength(2);

      // Verify both change tokens were created
      const allChangeTokens = await CashuToken.find({
        npub: testNpub,
        transaction_type: "change",
        status: "unspent",
      });
      expect(allChangeTokens).toHaveLength(2);

      // Verify balance accuracy
      const finalBalance = await walletRepositoryService.calculateBalance(testNpub, testMintUrl);
      expect(finalBalance.unspent_balance).toBe(350); // 200 + 150
      expect(finalBalance.spent_balance).toBe(1200); // 800 + 400
      expect(finalBalance.total_balance).toBe(1550);

      // Verify no consumed proofs are stored in change tokens
      const allChangeProofs = allChangeTokens.flatMap(token => 
        token.proofs.map(p => p.secret)
      );
      expect(allChangeProofs).not.toContain("secret1");
      expect(allChangeProofs).not.toContain("secret2");
      expect(allChangeProofs).toContain("keep_secret1");
      expect(allChangeProofs).toContain("change_secret1");
    });
  });

  describe("Balance Calculation Accuracy", () => {
    it("should maintain accurate balance after complex melt sequence", async () => {
      // Setup: Create initial balance
      const initialTokens = [
        {
          transaction_id: "tx_initial_1",
          amount: 1000,
          proofs: [{ id: "p1", amount: 1000, secret: "s1", C: "c1" }],
        },
        {
          transaction_id: "tx_initial_2", 
          amount: 500,
          proofs: [{ id: "p2", amount: 500, secret: "s2", C: "c2" }],
        },
        {
          transaction_id: "tx_initial_3",
          amount: 300,
          proofs: [{ id: "p3", amount: 300, secret: "s3", C: "c3" }],
        },
      ];

      const createdTokens = [];
      for (const tokenData of initialTokens) {
        const token = await CashuToken.create({
          npub: testNpub,
          wallet_id: testWallet._id,
          mint_url: testMintUrl,
          transaction_id: tokenData.transaction_id,
          transaction_type: "minted",
          status: "unspent",
          proofs: tokenData.proofs,
          metadata: { source: "lightning" },
        });
        createdTokens.push(token);
      }

      // Initial balance: 1800 sats
      const initialBalance = await walletRepositoryService.calculateBalance(testNpub, testMintUrl);
      expect(initialBalance.unspent_balance).toBe(1800);

      // Melt operation 1: Use 1000 sat token, get 200 sat change
      await walletRepositoryService.executeAtomicMelt(
        [createdTokens[0]._id],
        [{ id: "keep1", amount: 150, secret: "keep1", C: "keepc1" }],
        [{ id: "change1", amount: 50, secret: "change1", C: "changec1" }],
        "tx_melt_1",
        {
          npub: testNpub,
          wallet_id: testWallet._id,
          mint_url: testMintUrl,
        }
      );

      // Balance after melt 1: 500 + 300 + 150 + 50 = 1000 unspent, 1000 spent
      const balance1 = await walletRepositoryService.calculateBalance(testNpub, testMintUrl);
      expect(balance1.unspent_balance).toBe(1000);
      expect(balance1.spent_balance).toBe(1000);

      // Melt operation 2: Use 500 sat token, get 100 sat change
      await walletRepositoryService.executeAtomicMelt(
        [createdTokens[1]._id],
        [{ id: "keep2", amount: 75, secret: "keep2", C: "keepc2" }],
        [{ id: "change2", amount: 25, secret: "change2", C: "changec2" }],
        "tx_melt_2",
        {
          npub: testNpub,
          wallet_id: testWallet._id,
          mint_url: testMintUrl,
        }
      );

      // Balance after melt 2: 300 + 150 + 50 + 75 + 25 = 600 unspent, 1500 spent
      const balance2 = await walletRepositoryService.calculateBalance(testNpub, testMintUrl);
      expect(balance2.unspent_balance).toBe(600);
      expect(balance2.spent_balance).toBe(1500);

      // Final verification: Total should remain 1800 (no double counting)
      expect(balance2.total_balance).toBe(1800);

      // Verify token counts
      const detailedBalance = await walletRepositoryService.getDetailedBalance(testNpub, testMintUrl);
      expect(detailedBalance.token_counts.unspent).toBe(5); // 1 original + 4 change tokens
      expect(detailedBalance.token_counts.spent).toBe(2); // 2 consumed tokens
      expect(detailedBalance.token_counts.pending).toBe(0);
    });

    it("should prevent balance discrepancies from proof secret reuse", async () => {
      // Setup: Create source token
      const sourceToken = await CashuToken.create({
        npub: testNpub,
        wallet_id: testWallet._id,
        mint_url: testMintUrl,
        transaction_id: "tx_source_1",
        transaction_type: "minted",
        status: "unspent",
        proofs: [
          { id: "proof1", amount: 1000, secret: "unique_secret_1", C: "commitment1" },
        ],
        metadata: { source: "lightning" },
      });

      // Attempt to create change tokens with duplicate secrets (should be prevented)
      const duplicateSecretProofs = [
        { id: "keep1", amount: 200, secret: "unique_secret_1", C: "keep_commitment1" }, // Duplicate!
      ];

      // This should fail due to secret validation
      await expect(
        walletRepositoryService.executeAtomicMelt(
          [sourceToken._id],
          duplicateSecretProofs,
          [],
          "tx_melt_fail",
          {
            npub: testNpub,
            wallet_id: testWallet._id,
            mint_url: testMintUrl,
          }
        )
      ).rejects.toThrow();

      // Verify original token remains unchanged
      const unchangedToken = await CashuToken.findById(sourceToken._id);
      expect(unchangedToken.status).toBe("unspent");

      // Verify balance remains accurate
      const balance = await walletRepositoryService.calculateBalance(testNpub, testMintUrl);
      expect(balance.unspent_balance).toBe(1000);
      expect(balance.spent_balance).toBe(0);
    });
  });
});