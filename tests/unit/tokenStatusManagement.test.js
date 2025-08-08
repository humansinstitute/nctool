import mongoose from "mongoose";
import { setupTestDB, teardownTestDB, clearTestDB } from "../setup.js";
import CashuWallet from "../../src/models/CashuWallet.model.js";
import CashuToken from "../../src/models/CashuToken.model.js";
import walletRepositoryService from "../../src/services/walletRepository.service.js";

describe("Token Status Management Tests", () => {
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

  describe("Status Transition Validation", () => {
    it("should allow valid status transitions from unspent to spent", async () => {
      // Create unspent token
      const token = await CashuToken.create({
        npub: testNpub,
        wallet_id: testWallet._id,
        mint_url: testMintUrl,
        transaction_id: "tx_test_1",
        transaction_type: "minted",
        status: "unspent",
        proofs: [
          { id: "proof1", amount: 1000, secret: "secret1", C: "commitment1" },
        ],
        metadata: { source: "lightning" },
      });

      expect(token.status).toBe("unspent");
      expect(token.spent_at).toBeNull();

      // Transition to spent
      const updatedCount = await walletRepositoryService.markTokensAsSpent([token._id]);
      expect(updatedCount).toBe(1);

      // Verify status change
      const updatedToken = await CashuToken.findById(token._id);
      expect(updatedToken.status).toBe("spent");
      expect(updatedToken.spent_at).toBeDefined();
      expect(updatedToken.spent_at).toBeInstanceOf(Date);
    });

    it("should allow valid status transitions from pending to unspent", async () => {
      // Create pending token
      const token = await CashuToken.create({
        npub: testNpub,
        wallet_id: testWallet._id,
        mint_url: testMintUrl,
        transaction_id: "tx_pending_1",
        transaction_type: "minted",
        status: "pending",
        proofs: [], // Empty for pending
        total_amount: 0, // Zero for pending
        metadata: {
          source: "lightning",
          quote_id: "quote123",
          pending_amount: 1000,
        },
      });

      expect(token.status).toBe("pending");
      expect(token.total_amount).toBe(0);

      // Transition to unspent with proofs
      const updatedToken = await walletRepositoryService.updatePendingTransaction(
        token._id,
        {
          status: "unspent",
          proofs: [
            { id: "proof1", amount: 1000, secret: "secret1", C: "commitment1" },
          ],
          metadata: {
            ...token.metadata,
            completed_at: new Date(),
          },
        }
      );

      expect(updatedToken.status).toBe("unspent");
      expect(updatedToken.total_amount).toBe(1000);
      expect(updatedToken.proofs).toHaveLength(1);
      expect(updatedToken.metadata.completed_at).toBeDefined();
    });

    it("should allow valid status transitions from pending to spent", async () => {
      // Create pending token
      const token = await CashuToken.create({
        npub: testNpub,
        wallet_id: testWallet._id,
        mint_url: testMintUrl,
        transaction_id: "tx_pending_2",
        transaction_type: "minted",
        status: "pending",
        proofs: [],
        total_amount: 0,
        metadata: { source: "lightning" },
      });

      // Transition directly to spent (e.g., failed transaction cleanup)
      const updatedToken = await walletRepositoryService.updatePendingTransaction(
        token._id,
        {
          status: "spent",
          metadata: {
            ...token.metadata,
            failed_at: new Date(),
            failure_reason: "Transaction timeout",
          },
        }
      );

      expect(updatedToken.status).toBe("spent");
      expect(updatedToken.spent_at).toBeDefined();
      expect(updatedToken.metadata.failed_at).toBeDefined();
    });

    it("should prevent invalid status transitions from non-pending states", async () => {
      // Create unspent token
      const token = await CashuToken.create({
        npub: testNpub,
        wallet_id: testWallet._id,
        mint_url: testMintUrl,
        transaction_id: "tx_test_2",
        transaction_type: "minted",
        status: "unspent",
        proofs: [
          { id: "proof1", amount: 1000, secret: "secret1", C: "commitment1" },
        ],
        metadata: { source: "lightning" },
      });

      // Attempt invalid transition (unspent -> pending)
      await expect(
        walletRepositoryService.updatePendingTransaction(token._id, {
          status: "pending",
        })
      ).rejects.toThrow("Invalid status transition");
    });

    it("should prevent status transitions on non-existent tokens", async () => {
      const fakeId = new mongoose.Types.ObjectId();

      await expect(
        walletRepositoryService.updatePendingTransaction(fakeId, {
          status: "unspent",
        })
      ).rejects.toThrow("Token not found");
    });
  });

  describe("Change Token Creation with Proper Transaction Type", () => {
    it("should create change tokens with correct transaction_type during melt", async () => {
      // Create source token
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

      const keepProofs = [
        { id: "keep1", amount: 200, secret: "keep_secret1", C: "keep_commitment1" },
      ];

      const meltChangeProofs = [
        { id: "change1", amount: 100, secret: "change_secret1", C: "change_commitment1" },
      ];

      // Execute atomic melt to create change tokens
      const result = await walletRepositoryService.executeAtomicMelt(
        [sourceToken._id],
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

      // Verify change tokens have correct transaction_type
      const changeTokens = await CashuToken.find({
        npub: testNpub,
        transaction_type: "change",
      });

      expect(changeTokens).toHaveLength(2);

      // Verify keep change token
      const keepChangeToken = changeTokens.find(t => 
        t.transaction_id === "tx_melt_123_keep"
      );
      expect(keepChangeToken).toBeDefined();
      expect(keepChangeToken.transaction_type).toBe("change");
      expect(keepChangeToken.status).toBe("unspent");
      expect(keepChangeToken.total_amount).toBe(200);

      // Verify melt change token
      const meltChangeToken = changeTokens.find(t => 
        t.transaction_id === "tx_melt_123_melt_change"
      );
      expect(meltChangeToken).toBeDefined();
      expect(meltChangeToken.transaction_type).toBe("change");
      expect(meltChangeToken.status).toBe("unspent");
      expect(meltChangeToken.total_amount).toBe(100);
    });

    it("should create change tokens with proper metadata during send operations", async () => {
      // Create source tokens for send operation
      const sourceToken = await CashuToken.create({
        npub: testNpub,
        wallet_id: testWallet._id,
        mint_url: testMintUrl,
        transaction_id: "tx_source_send",
        transaction_type: "minted",
        status: "unspent",
        proofs: [
          { id: "proof1", amount: 1500, secret: "secret1", C: "commitment1" },
        ],
        metadata: { source: "lightning" },
      });

      // Simulate send operation creating change
      const changeProofs = [
        { id: "change1", amount: 500, secret: "change_secret1", C: "change_commitment1" },
      ];

      const changeToken = await CashuToken.create({
        npub: testNpub,
        wallet_id: testWallet._id,
        mint_url: testMintUrl,
        transaction_id: "tx_send_123",
        transaction_type: "change",
        status: "unspent",
        proofs: changeProofs,
        metadata: {
          source: "change",
          original_amount: 1500,
          sent_amount: 1000,
          change_amount: 500,
          parent_transaction_id: "tx_send_123",
        },
      });

      expect(changeToken.transaction_type).toBe("change");
      expect(changeToken.status).toBe("unspent");
      expect(changeToken.total_amount).toBe(500);
      expect(changeToken.metadata.source).toBe("change");
      expect(changeToken.metadata.parent_transaction_id).toBe("tx_send_123");
    });

    it("should validate transaction_type enum values", async () => {
      // Attempt to create token with invalid transaction_type
      await expect(
        CashuToken.create({
          npub: testNpub,
          wallet_id: testWallet._id,
          mint_url: testMintUrl,
          transaction_id: "tx_invalid",
          transaction_type: "invalid_type", // Invalid enum value
          status: "unspent",
          proofs: [
            { id: "proof1", amount: 1000, secret: "secret1", C: "commitment1" },
          ],
          metadata: { source: "lightning" },
        })
      ).rejects.toThrow();
    });
  });

  describe("Metadata Handling and Audit Trail", () => {
    it("should preserve metadata during status transitions", async () => {
      // Create token with rich metadata
      const originalMetadata = {
        source: "lightning",
        quote_id: "quote123",
        mint_amount: 1000,
        invoice: "lnbc1000n1...",
        created_via: "api",
        user_agent: "test-client",
      };

      const token = await CashuToken.create({
        npub: testNpub,
        wallet_id: testWallet._id,
        mint_url: testMintUrl,
        transaction_id: "tx_metadata_test",
        transaction_type: "minted",
        status: "pending",
        proofs: [],
        total_amount: 0,
        metadata: originalMetadata,
      });

      // Update to unspent with additional metadata
      const updatedToken = await walletRepositoryService.updatePendingTransaction(
        token._id,
        {
          status: "unspent",
          proofs: [
            { id: "proof1", amount: 1000, secret: "secret1", C: "commitment1" },
          ],
          metadata: {
            ...originalMetadata,
            completed_at: new Date(),
            completion_method: "background_polling",
            actual_minted_amount: 1000,
          },
        }
      );

      // Verify metadata preservation and enhancement
      expect(updatedToken.metadata.source).toBe("lightning");
      expect(updatedToken.metadata.quote_id).toBe("quote123");
      expect(updatedToken.metadata.completed_at).toBeDefined();
      expect(updatedToken.metadata.completion_method).toBe("background_polling");
      expect(updatedToken.metadata.actual_minted_amount).toBe(1000);
    });

    it("should create audit trail for melt operations", async () => {
      // Create source token
      const sourceToken = await CashuToken.create({
        npub: testNpub,
        wallet_id: testWallet._id,
        mint_url: testMintUrl,
        transaction_id: "tx_audit_source",
        transaction_type: "minted",
        status: "unspent",
        proofs: [
          { id: "proof1", amount: 1000, secret: "secret1", C: "commitment1" },
        ],
        metadata: {
          source: "lightning",
          original_quote: "quote456",
        },
      });

      // Execute melt with audit metadata
      const result = await walletRepositoryService.executeAtomicMelt(
        [sourceToken._id],
        [{ id: "keep1", amount: 150, secret: "keep1", C: "keepc1" }],
        [{ id: "change1", amount: 50, secret: "change1", C: "changec1" }],
        "tx_melt_audit",
        {
          npub: testNpub,
          wallet_id: testWallet._id,
          mint_url: testMintUrl,
          parent_transaction_id: "tx_melt_audit",
          quote_id: "melt_quote_789",
          invoice_amount: 800,
          fee_reserve: 50,
          total_amount: 850,
          payment_result: "PAID",
        }
      );

      expect(result.success).toBe(true);

      // Verify audit trail in result
      expect(result.audit_log).toBeDefined();
      expect(result.audit_log.transaction_id).toBe("tx_melt_audit");
      expect(result.audit_log.operation_type).toBe("atomic_melt");
      expect(result.audit_log.source_tokens_spent).toBe(1);
      expect(result.audit_log.operations_performed).toHaveLength(2);
      expect(result.audit_log.metadata.quote_id).toBe("melt_quote_789");

      // Verify change tokens have proper audit metadata
      const changeTokens = await CashuToken.find({
        npub: testNpub,
        transaction_type: "change",
      });

      for (const changeToken of changeTokens) {
        expect(changeToken.metadata.source).toBe("change");
        expect(changeToken.metadata.parent_transaction_id).toBe("tx_melt_audit");
      }
    });

    it("should track token lifecycle through metadata", async () => {
      // Create initial minted token
      const mintedToken = await CashuToken.create({
        npub: testNpub,
        wallet_id: testWallet._id,
        mint_url: testMintUrl,
        transaction_id: "tx_lifecycle_1",
        transaction_type: "minted",
        status: "unspent",
        proofs: [
          { id: "proof1", amount: 1000, secret: "secret1", C: "commitment1" },
        ],
        metadata: {
          source: "lightning",
          created_at: new Date(),
          lifecycle_stage: "minted",
        },
      });

      // Mark as spent (simulating use in melt)
      await walletRepositoryService.markTokensAsSpent([mintedToken._id]);

      // Create change token from the spent token
      const changeToken = await CashuToken.create({
        npub: testNpub,
        wallet_id: testWallet._id,
        mint_url: testMintUrl,
        transaction_id: "tx_lifecycle_2",
        transaction_type: "change",
        status: "unspent",
        proofs: [
          { id: "change1", amount: 200, secret: "change_secret1", C: "change_commitment1" },
        ],
        metadata: {
          source: "change",
          parent_transaction_id: "tx_lifecycle_1",
          lifecycle_stage: "change_from_melt",
          original_token_id: mintedToken._id,
          created_at: new Date(),
        },
      });

      // Verify lifecycle tracking
      const spentToken = await CashuToken.findById(mintedToken._id);
      expect(spentToken.status).toBe("spent");
      expect(spentToken.spent_at).toBeDefined();

      expect(changeToken.metadata.parent_transaction_id).toBe("tx_lifecycle_1");
      expect(changeToken.metadata.original_token_id.toString()).toBe(mintedToken._id.toString());
      expect(changeToken.metadata.lifecycle_stage).toBe("change_from_melt");
    });
  });

  describe("Invalid Status Transition Prevention", () => {
    it("should prevent spent tokens from being marked as unspent", async () => {
      // Create and mark token as spent
      const token = await CashuToken.create({
        npub: testNpub,
        wallet_id: testWallet._id,
        mint_url: testMintUrl,
        transaction_id: "tx_spent_test",
        transaction_type: "minted",
        status: "unspent",
        proofs: [
          { id: "proof1", amount: 1000, secret: "secret1", C: "commitment1" },
        ],
        metadata: { source: "lightning" },
      });

      await walletRepositoryService.markTokensAsSpent([token._id]);

      // Verify token is spent
      const spentToken = await CashuToken.findById(token._id);
      expect(spentToken.status).toBe("spent");

      // Attempt invalid transition back to unspent
      await expect(
        walletRepositoryService.updatePendingTransaction(token._id, {
          status: "unspent",
        })
      ).rejects.toThrow("Invalid status transition");
    });

    it("should prevent spent tokens from being marked as pending", async () => {
      // Create spent token
      const token = await CashuToken.create({
        npub: testNpub,
        wallet_id: testWallet._id,
        mint_url: testMintUrl,
        transaction_id: "tx_spent_test_2",
        transaction_type: "minted",
        status: "spent",
        spent_at: new Date(),
        proofs: [
          { id: "proof1", amount: 1000, secret: "secret1", C: "commitment1" },
        ],
        metadata: { source: "lightning" },
      });

      // Attempt invalid transition to pending
      await expect(
        walletRepositoryService.updatePendingTransaction(token._id, {
          status: "pending",
        })
      ).rejects.toThrow("Invalid status transition");
    });

    it("should validate status field enum values", async () => {
      // Attempt to create token with invalid status
      await expect(
        CashuToken.create({
          npub: testNpub,
          wallet_id: testWallet._id,
          mint_url: testMintUrl,
          transaction_id: "tx_invalid_status",
          transaction_type: "minted",
          status: "invalid_status", // Invalid enum value
          proofs: [
            { id: "proof1", amount: 1000, secret: "secret1", C: "commitment1" },
          ],
          metadata: { source: "lightning" },
        })
      ).rejects.toThrow();
    });
  });

  describe("Concurrent Operation Handling", () => {
    it("should handle concurrent status updates safely", async () => {
      // Create token
      const token = await CashuToken.create({
        npub: testNpub,
        wallet_id: testWallet._id,
        mint_url: testMintUrl,
        transaction_id: "tx_concurrent_test",
        transaction_type: "minted",
        status: "unspent",
        proofs: [
          { id: "proof1", amount: 1000, secret: "secret1", C: "commitment1" },
        ],
        metadata: { source: "lightning" },
      });

      // Attempt concurrent status updates
      const update1Promise = walletRepositoryService.markTokensAsSpent([token._id]);
      const update2Promise = walletRepositoryService.markTokensAsSpent([token._id]);

      // Both should complete without error (idempotent operation)
      const [result1, result2] = await Promise.all([update1Promise, update2Promise]);

      // At least one should succeed
      expect(result1 + result2).toBeGreaterThanOrEqual(1);

      // Final state should be spent
      const finalToken = await CashuToken.findById(token._id);
      expect(finalToken.status).toBe("spent");
      expect(finalToken.spent_at).toBeDefined();
    });

    it("should handle concurrent pending transaction updates", async () => {
      // Create pending token
      const token = await CashuToken.create({
        npub: testNpub,
        wallet_id: testWallet._id,
        mint_url: testMintUrl,
        transaction_id: "tx_concurrent_pending",
        transaction_type: "minted",
        status: "pending",
        proofs: [],
        total_amount: 0,
        metadata: { source: "lightning" },
      });

      // Attempt concurrent updates to unspent
      const update1Promise = walletRepositoryService.updatePendingTransaction(
        token._id,
        {
          status: "unspent",
          proofs: [
            { id: "proof1", amount: 1000, secret: "secret1", C: "commitment1" },
          ],
        }
      );

      const update2Promise = walletRepositoryService.updatePendingTransaction(
        token._id,
        {
          status: "unspent",
          proofs: [
            { id: "proof2", amount: 1000, secret: "secret2", C: "commitment2" },
          ],
        }
      );

      // One should succeed, one should fail
      const results = await Promise.allSettled([update1Promise, update2Promise]);
      
      const successCount = results.filter(r => r.status === "fulfilled").length;
      const failureCount = results.filter(r => r.status === "rejected").length;

      expect(successCount).toBe(1);
      expect(failureCount).toBe(1);

      // Final state should be unspent
      const finalToken = await CashuToken.findById(token._id);
      expect(finalToken.status).toBe("unspent");
      expect(finalToken.total_amount).toBe(1000);
    });

    it("should maintain data integrity during concurrent melt operations", async () => {
      // Create multiple source tokens
      const tokens = [];
      for (let i = 0; i < 3; i++) {
        const token = await CashuToken.create({
          npub: testNpub,
          wallet_id: testWallet._id,
          mint_url: testMintUrl,
          transaction_id: `tx_concurrent_source_${i}`,
          transaction_type: "minted",
          status: "unspent",
          proofs: [
            { id: `proof${i}`, amount: 1000, secret: `secret${i}`, C: `commitment${i}` },
          ],
          metadata: { source: "lightning" },
        });
        tokens.push(token);
      }

      // Execute concurrent melt operations
      const meltPromises = tokens.map((token, index) =>
        walletRepositoryService.executeAtomicMelt(
          [token._id],
          [{ id: `keep${index}`, amount: 100, secret: `keep${index}`, C: `keepc${index}` }],
          [{ id: `change${index}`, amount: 50, secret: `change${index}`, C: `changec${index}` }],
          `tx_concurrent_melt_${index}`,
          {
            npub: testNpub,
            wallet_id: testWallet._id,
            mint_url: testMintUrl,
          }
        )
      );

      // All operations should succeed
      const results = await Promise.all(meltPromises);
      results.forEach(result => {
        expect(result.success).toBe(true);
      });

      // Verify final state integrity
      const allTokens = await CashuToken.find({ npub: testNpub });
      const spentTokens = allTokens.filter(t => t.status === "spent");
      const changeTokens = allTokens.filter(t => t.transaction_type === "change");

      expect(spentTokens).toHaveLength(3); // All source tokens spent
      expect(changeTokens).toHaveLength(6); // 3 operations × 2 change types each

      // Verify balance consistency
      const finalBalance = await walletRepositoryService.calculateBalance(testNpub, testMintUrl);
      expect(finalBalance.unspent_balance).toBe(450); // 3 × (100 + 50)
      expect(finalBalance.spent_balance).toBe(3000); // 3 × 1000
      expect(finalBalance.total_balance).toBe(3450);
    });
  });
});