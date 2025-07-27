import walletRepositoryService from "../../src/services/walletRepository.service.js";
import CashuWallet from "../../src/models/CashuWallet.model.js";
import CashuToken from "../../src/models/CashuToken.model.js";
import { setupTestDB, teardownTestDB } from "../setup.js";

describe("Token Status Management Tests", () => {
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
      secret: `secret_${index}_${Date.now()}_${Math.random()}`,
      C: `commitment_${index}`,
    }));
  };

  describe("Token Status Transitions", () => {
    let wallet;

    beforeEach(async () => {
      wallet = await walletRepositoryService.createWallet(mockWalletData);
    });

    it("should correctly set status for different transaction types", async () => {
      const testCases = [
        {
          transaction_type: "minted",
          expectedStatus: "unspent",
          description: "Minted tokens should be unspent",
        },
        {
          transaction_type: "received",
          expectedStatus: "unspent",
          description: "Received tokens should be unspent",
        },
        {
          transaction_type: "change",
          expectedStatus: "unspent",
          description: "Change tokens should be unspent",
        },
        {
          transaction_type: "sent",
          expectedStatus: "spent",
          description: "Sent tokens should be spent",
        },
        {
          transaction_type: "melted",
          expectedStatus: "spent",
          description: "Melted tokens should be spent (CRITICAL FIX)",
        },
      ];

      for (const testCase of testCases) {
        const proofs = createMockProofs([1000]);

        const token = await walletRepositoryService.storeTokens({
          npub: mockWalletData.npub,
          wallet_id: wallet._id,
          proofs,
          mint_url: mockWalletData.mint_url,
          transaction_type: testCase.transaction_type,
          transaction_id: `tx_${testCase.transaction_type}_${Date.now()}`,
          metadata: {
            source: "test",
            quote_id: "quote_001",
          },
        });

        expect(token.status).toBe(testCase.expectedStatus);

        if (testCase.expectedStatus === "spent") {
          expect(token.spent_at).toBeDefined();
        } else {
          expect(token.spent_at).toBeNull();
        }

        // Clean up for next iteration
        await CashuToken.deleteOne({ _id: token._id });
      }
    });

    it("should allow explicit status override", async () => {
      const proofs = createMockProofs([1000]);

      // Test overriding default status
      const token = await walletRepositoryService.storeTokens(
        {
          npub: mockWalletData.npub,
          wallet_id: wallet._id,
          proofs,
          mint_url: mockWalletData.mint_url,
          transaction_type: "minted", // Would normally be unspent
          transaction_id: "tx_override_test",
          metadata: {
            source: "test",
            quote_id: "quote_001",
          },
        },
        { explicitStatus: "pending" }
      );

      expect(token.status).toBe("pending");
      expect(token.spent_at).toBeNull();
    });

    it("should validate status transitions in updateTokenStatus", async () => {
      const proofs = createMockProofs([1000]);

      const token = await walletRepositoryService.storeTokens({
        npub: mockWalletData.npub,
        wallet_id: wallet._id,
        proofs,
        mint_url: mockWalletData.mint_url,
        transaction_type: "minted",
        transaction_id: "tx_status_update_test",
        metadata: {
          source: "mint",
          quote_id: "quote_001",
        },
      });

      // Test valid status transitions
      const validTransitions = [
        { from: "unspent", to: "spent" },
        { from: "unspent", to: "pending" },
        { from: "pending", to: "unspent" },
        { from: "pending", to: "failed" },
      ];

      for (const transition of validTransitions) {
        // Reset token to initial state
        await CashuToken.findByIdAndUpdate(token._id, {
          status: transition.from,
          $unset: { spent_at: 1 },
        });

        const updatedToken = await walletRepositoryService.updateTokenStatus(
          token._id,
          transition.to
        );

        expect(updatedToken.status).toBe(transition.to);

        if (transition.to === "spent") {
          expect(updatedToken.spent_at).toBeDefined();
        }
      }
    });

    it("should reject invalid status values", async () => {
      const proofs = createMockProofs([1000]);

      const token = await walletRepositoryService.storeTokens({
        npub: mockWalletData.npub,
        wallet_id: wallet._id,
        proofs,
        mint_url: mockWalletData.mint_url,
        transaction_type: "minted",
        transaction_id: "tx_invalid_status_test",
        metadata: {
          source: "mint",
          quote_id: "quote_001",
        },
      });

      await expect(
        walletRepositoryService.updateTokenStatus(token._id, "invalid_status")
      ).rejects.toThrow("Invalid status");
    });
  });

  describe("markTokensAsSpent Function", () => {
    let wallet;
    let tokens;

    beforeEach(async () => {
      wallet = await walletRepositoryService.createWallet(mockWalletData);

      // Create multiple unspent tokens
      tokens = [];
      for (let i = 0; i < 3; i++) {
        const token = await walletRepositoryService.storeTokens({
          npub: mockWalletData.npub,
          wallet_id: wallet._id,
          proofs: createMockProofs([1000 * (i + 1)]),
          mint_url: mockWalletData.mint_url,
          transaction_type: "minted",
          transaction_id: `tx_mark_spent_${i}`,
          metadata: {
            source: "mint",
            quote_id: `quote_${i}`,
          },
        });
        tokens.push(token);
      }
    });

    it("should mark multiple tokens as spent atomically", async () => {
      const tokenIds = tokens.map((t) => t._id);

      const spentCount = await walletRepositoryService.markTokensAsSpent(
        tokenIds
      );

      expect(spentCount).toBe(tokens.length);

      // Verify all tokens are marked as spent
      const updatedTokens = await CashuToken.find({
        _id: { $in: tokenIds },
      });

      updatedTokens.forEach((token) => {
        expect(token.status).toBe("spent");
        expect(token.spent_at).toBeDefined();
      });
    });

    it("should handle partial failures gracefully", async () => {
      const validTokenIds = tokens.slice(0, 2).map((t) => t._id);
      const invalidTokenId = "507f1f77bcf86cd799439011"; // Non-existent ID
      const mixedTokenIds = [...validTokenIds, invalidTokenId];

      const spentCount = await walletRepositoryService.markTokensAsSpent(
        mixedTokenIds
      );

      // Should only mark the valid tokens as spent
      expect(spentCount).toBe(2);

      const validTokens = await CashuToken.find({
        _id: { $in: validTokenIds },
      });

      validTokens.forEach((token) => {
        expect(token.status).toBe("spent");
      });
    });

    it("should work with session for atomic operations", async () => {
      const mongoose = await import("mongoose");
      const session = await mongoose.default.startSession();

      try {
        await session.withTransaction(async () => {
          const tokenIds = tokens.map((t) => t._id);

          const spentCount = await walletRepositoryService.markTokensAsSpent(
            tokenIds,
            { session }
          );

          expect(spentCount).toBe(tokens.length);
        });

        // Verify tokens are marked as spent after transaction commits
        const updatedTokens = await CashuToken.find({
          _id: { $in: tokens.map((t) => t._id) },
        });

        updatedTokens.forEach((token) => {
          expect(token.status).toBe("spent");
        });
      } finally {
        await session.endSession();
      }
    });
  });

  describe("Status-Based Queries", () => {
    let wallet;

    beforeEach(async () => {
      wallet = await walletRepositoryService.createWallet(mockWalletData);

      // Create tokens with different statuses
      const statusTypes = [
        { status: "unspent", count: 3 },
        { status: "spent", count: 2 },
        { status: "pending", count: 1 },
      ];

      for (const statusType of statusTypes) {
        for (let i = 0; i < statusType.count; i++) {
          await walletRepositoryService.storeTokens(
            {
              npub: mockWalletData.npub,
              wallet_id: wallet._id,
              proofs: createMockProofs([1000]),
              mint_url: mockWalletData.mint_url,
              transaction_type: "minted",
              transaction_id: `tx_${statusType.status}_${i}`,
              metadata: {
                source: "mint",
                quote_id: `quote_${statusType.status}_${i}`,
              },
            },
            { explicitStatus: statusType.status }
          );
        }
      }
    });

    it("should find unspent tokens correctly", async () => {
      const unspentTokens = await walletRepositoryService.findUnspentTokens(
        mockWalletData.npub
      );

      expect(unspentTokens).toHaveLength(3);
      unspentTokens.forEach((token) => {
        expect(token.status).toBe("unspent");
      });
    });

    it("should calculate balance by status correctly", async () => {
      const balance = await walletRepositoryService.calculateBalance(
        mockWalletData.npub
      );

      expect(balance.unspent_balance).toBe(3000); // 3 * 1000
      expect(balance.spent_balance).toBe(2000); // 2 * 1000
      expect(balance.pending_balance).toBe(1000); // 1 * 1000
      expect(balance.total_balance).toBe(4000); // unspent + pending
    });

    it("should get detailed balance with token counts", async () => {
      const detailedBalance = await walletRepositoryService.getDetailedBalance(
        mockWalletData.npub
      );

      expect(detailedBalance.token_counts.unspent).toBe(3);
      expect(detailedBalance.token_counts.spent).toBe(2);
      expect(detailedBalance.token_counts.pending).toBe(1);
      expect(detailedBalance.total_tokens).toBe(6);
    });
  });

  describe("Double-Spend Prevention", () => {
    let wallet;

    beforeEach(async () => {
      wallet = await walletRepositoryService.createWallet(mockWalletData);
    });

    it("should prevent storing tokens with duplicate proof secrets", async () => {
      const proofs = createMockProofs([1000]);

      // Store first token
      await walletRepositoryService.storeTokens({
        npub: mockWalletData.npub,
        wallet_id: wallet._id,
        proofs,
        mint_url: mockWalletData.mint_url,
        transaction_type: "minted",
        transaction_id: "tx_first",
        metadata: {
          source: "mint",
          quote_id: "quote_001",
        },
      });

      // Attempt to store second token with same proofs
      await expect(
        walletRepositoryService.storeTokens({
          npub: mockWalletData.npub,
          wallet_id: wallet._id,
          proofs, // Same proofs!
          mint_url: mockWalletData.mint_url,
          transaction_type: "received",
          transaction_id: "tx_second",
          metadata: {
            source: "receive",
            quote_id: "quote_002",
          },
        })
      ).rejects.toThrow("Some proofs already exist in database");
    });

    it("should allow melted and change transactions with existing proofs", async () => {
      const proofs = createMockProofs([1000]);

      // Store original token
      await walletRepositoryService.storeTokens({
        npub: mockWalletData.npub,
        wallet_id: wallet._id,
        proofs,
        mint_url: mockWalletData.mint_url,
        transaction_type: "minted",
        transaction_id: "tx_original",
        metadata: {
          source: "mint",
          quote_id: "quote_001",
        },
      });

      // Should allow melted transaction with same proofs (for transaction history)
      const meltedToken = await walletRepositoryService.storeTokens({
        npub: mockWalletData.npub,
        wallet_id: wallet._id,
        proofs, // Same proofs allowed for melted
        mint_url: mockWalletData.mint_url,
        transaction_type: "melted",
        transaction_id: "tx_melted",
        metadata: {
          source: "lightning",
          quote_id: "quote_002",
        },
      });

      expect(meltedToken.status).toBe("spent");

      // Should allow change transaction with same proofs
      const changeToken = await walletRepositoryService.storeTokens({
        npub: mockWalletData.npub,
        wallet_id: wallet._id,
        proofs, // Same proofs allowed for change
        mint_url: mockWalletData.mint_url,
        transaction_type: "change",
        transaction_id: "tx_change",
        metadata: {
          source: "change",
          quote_id: "quote_003",
        },
      });

      expect(changeToken.status).toBe("unspent");
    });

    it("should check proof secrets correctly", async () => {
      const proofs1 = createMockProofs([1000]);
      const proofs2 = createMockProofs([2000]);

      // Store tokens
      const token1 = await walletRepositoryService.storeTokens({
        npub: mockWalletData.npub,
        wallet_id: wallet._id,
        proofs: proofs1,
        mint_url: mockWalletData.mint_url,
        transaction_type: "minted",
        transaction_id: "tx_check_1",
        metadata: {
          source: "mint",
          quote_id: "quote_001",
        },
      });

      const token2 = await walletRepositoryService.storeTokens({
        npub: mockWalletData.npub,
        wallet_id: wallet._id,
        proofs: proofs2,
        mint_url: mockWalletData.mint_url,
        transaction_type: "minted",
        transaction_id: "tx_check_2",
        metadata: {
          source: "mint",
          quote_id: "quote_002",
        },
      });

      // Check existing secrets
      const secrets = [...proofs1, ...proofs2].map((p) => p.secret);
      const secretMap = await walletRepositoryService.checkProofSecrets(
        secrets
      );

      expect(Object.keys(secretMap)).toHaveLength(secrets.length);

      proofs1.forEach((proof) => {
        expect(secretMap[proof.secret]).toBeDefined();
        expect(secretMap[proof.secret].token_id.toString()).toBe(
          token1._id.toString()
        );
        expect(secretMap[proof.secret].status).toBe("unspent");
      });

      proofs2.forEach((proof) => {
        expect(secretMap[proof.secret]).toBeDefined();
        expect(secretMap[proof.secret].token_id.toString()).toBe(
          token2._id.toString()
        );
        expect(secretMap[proof.secret].status).toBe("unspent");
      });

      // Check non-existing secret
      const nonExistingSecrets = ["non_existing_secret"];
      const emptyMap = await walletRepositoryService.checkProofSecrets(
        nonExistingSecrets
      );
      expect(Object.keys(emptyMap)).toHaveLength(0);
    });
  });
});
