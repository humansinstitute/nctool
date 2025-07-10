import walletRepositoryService from "../../src/services/walletRepository.service.js";
import CashuWallet from "../../src/models/CashuWallet.model.js";
import CashuToken from "../../src/models/CashuToken.model.js";
import { setupTestDB, teardownTestDB } from "../setup.js";

describe("WalletRepository Service", () => {
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
    npub: "npub1test123456789",
    mint_url: "https://mint.example.com",
    p2pk_pubkey: "pubkey123",
    p2pk_privkey: "privkey123",
    wallet_config: {
      unit: "sat",
      created_via: "api",
    },
  };

  const mockTokenData = {
    npub: "npub1test123456789",
    mint_url: "https://mint.example.com",
    transaction_id: "tx_123456789",
    transaction_type: "minted",
    amount: 1000,
    status: "unspent",
    proofs: [
      {
        id: "proof1",
        amount: 1000,
        secret: "secret1",
        C: "commitment1",
      },
    ],
    metadata: {
      quote_id: "quote123",
      mint_amount: 1000,
    },
  };

  describe("createWallet", () => {
    it("should create a new wallet successfully", async () => {
      const wallet = await walletRepositoryService.createWallet(mockWalletData);

      expect(wallet).toBeDefined();
      expect(wallet._id).toBeDefined();
      expect(wallet.npub).toBe(mockWalletData.npub);
      expect(wallet.mint_url).toBe(mockWalletData.mint_url);
      expect(wallet.p2pk_pubkey).toBe(mockWalletData.p2pk_pubkey);
      expect(wallet.created_at).toBeDefined();
    });

    it("should throw error for duplicate wallet", async () => {
      await walletRepositoryService.createWallet(mockWalletData);

      await expect(
        walletRepositoryService.createWallet(mockWalletData)
      ).rejects.toThrow();
    });
  });

  describe("findWallet", () => {
    beforeEach(async () => {
      await walletRepositoryService.createWallet(mockWalletData);
    });

    it("should find existing wallet", async () => {
      const wallet = await walletRepositoryService.findWallet(
        mockWalletData.npub,
        mockWalletData.mint_url
      );

      expect(wallet).toBeDefined();
      expect(wallet.npub).toBe(mockWalletData.npub);
      expect(wallet.mint_url).toBe(mockWalletData.mint_url);
    });

    it("should return null for non-existing wallet", async () => {
      const wallet = await walletRepositoryService.findWallet(
        "npub1nonexistent",
        mockWalletData.mint_url
      );

      expect(wallet).toBeNull();
    });
  });

  describe("createToken", () => {
    beforeEach(async () => {
      await walletRepositoryService.createWallet(mockWalletData);
    });

    it("should create a new token successfully", async () => {
      const token = await walletRepositoryService.createToken(mockTokenData);

      expect(token).toBeDefined();
      expect(token._id).toBeDefined();
      expect(token.npub).toBe(mockTokenData.npub);
      expect(token.transaction_id).toBe(mockTokenData.transaction_id);
      expect(token.amount).toBe(mockTokenData.amount);
      expect(token.status).toBe(mockTokenData.status);
    });

    it("should create token with pending status", async () => {
      const pendingTokenData = {
        ...mockTokenData,
        status: "pending",
        transaction_id: "tx_pending_123",
      };

      const token = await walletRepositoryService.createToken(pendingTokenData);

      expect(token.status).toBe("pending");
    });
  });

  describe("findTokensByNpub", () => {
    beforeEach(async () => {
      await walletRepositoryService.createWallet(mockWalletData);
      await walletRepositoryService.createToken(mockTokenData);
      await walletRepositoryService.createToken({
        ...mockTokenData,
        transaction_id: "tx_second",
        amount: 500,
      });
    });

    it("should find all tokens for npub", async () => {
      const tokens = await walletRepositoryService.findTokensByNpub(
        mockTokenData.npub,
        mockTokenData.mint_url
      );

      expect(tokens).toHaveLength(2);
      expect(tokens[0].npub).toBe(mockTokenData.npub);
      expect(tokens[1].npub).toBe(mockTokenData.npub);
    });

    it("should return empty array for non-existing npub", async () => {
      const tokens = await walletRepositoryService.findTokensByNpub(
        "npub1nonexistent",
        mockTokenData.mint_url
      );

      expect(tokens).toEqual([]);
    });

    it("should filter by status when provided", async () => {
      // Create a spent token
      await walletRepositoryService.createToken({
        ...mockTokenData,
        transaction_id: "tx_spent",
        status: "spent",
      });

      const unspentTokens = await walletRepositoryService.findTokensByNpub(
        mockTokenData.npub,
        mockTokenData.mint_url,
        "unspent"
      );

      expect(unspentTokens).toHaveLength(2);
      expect(unspentTokens.every((token) => token.status === "unspent")).toBe(
        true
      );
    });
  });

  describe("updatePendingTransaction", () => {
    let pendingToken;

    beforeEach(async () => {
      await walletRepositoryService.createWallet(mockWalletData);
      pendingToken = await walletRepositoryService.createToken({
        ...mockTokenData,
        status: "pending",
        transaction_id: "tx_pending",
      });
    });

    it("should update pending transaction successfully", async () => {
      const updateData = {
        status: "unspent",
        metadata: {
          ...mockTokenData.metadata,
          completed_at: new Date(),
        },
      };

      const result = await walletRepositoryService.updatePendingTransaction(
        pendingToken._id,
        updateData
      );

      expect(result).toBe(true);

      const updatedToken = await CashuToken.findById(pendingToken._id);
      expect(updatedToken.status).toBe("unspent");
      expect(updatedToken.metadata.completed_at).toBeDefined();
    });

    it("should throw error for non-existing token", async () => {
      const fakeId = "507f1f77bcf86cd799439011";

      await expect(
        walletRepositoryService.updatePendingTransaction(fakeId, {
          status: "unspent",
        })
      ).rejects.toThrow("Token not found");
    });

    it("should throw error for non-pending token", async () => {
      const unspentToken = await walletRepositoryService.createToken({
        ...mockTokenData,
        status: "unspent",
        transaction_id: "tx_unspent",
      });

      await expect(
        walletRepositoryService.updatePendingTransaction(unspentToken._id, {
          status: "spent",
        })
      ).rejects.toThrow("Token is not in pending status");
    });
  });

  describe("findPendingTransactions", () => {
    beforeEach(async () => {
      await walletRepositoryService.createWallet(mockWalletData);

      // Create pending transactions
      await walletRepositoryService.createToken({
        ...mockTokenData,
        status: "pending",
        transaction_id: "tx_pending_1",
      });

      await walletRepositoryService.createToken({
        ...mockTokenData,
        status: "pending",
        transaction_id: "tx_pending_2",
      });

      // Create non-pending transaction
      await walletRepositoryService.createToken({
        ...mockTokenData,
        status: "unspent",
        transaction_id: "tx_unspent",
      });
    });

    it("should find all pending transactions for npub", async () => {
      const pendingTransactions =
        await walletRepositoryService.findPendingTransactions(
          mockTokenData.npub
        );

      expect(pendingTransactions).toHaveLength(2);
      expect(pendingTransactions.every((tx) => tx.status === "pending")).toBe(
        true
      );
    });

    it("should return empty array when no pending transactions", async () => {
      const pendingTransactions =
        await walletRepositoryService.findPendingTransactions(
          "npub1nonexistent"
        );

      expect(pendingTransactions).toEqual([]);
    });
  });

  describe("findPendingMintTransactions", () => {
    beforeEach(async () => {
      await walletRepositoryService.createWallet(mockWalletData);

      const cutoffDate = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago

      // Create recent pending mint transaction
      await walletRepositoryService.createToken({
        ...mockTokenData,
        status: "pending",
        transaction_type: "minted",
        transaction_id: "tx_recent_mint",
        created_at: new Date(Date.now() - 30 * 60 * 1000), // 30 minutes ago
      });

      // Create old pending mint transaction (should be excluded)
      await walletRepositoryService.createToken({
        ...mockTokenData,
        status: "pending",
        transaction_type: "minted",
        transaction_id: "tx_old_mint",
        created_at: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
      });

      // Create pending non-mint transaction
      await walletRepositoryService.createToken({
        ...mockTokenData,
        status: "pending",
        transaction_type: "sent",
        transaction_id: "tx_pending_sent",
      });
    });

    it("should find recent pending mint transactions only", async () => {
      const cutoffDate = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago

      const pendingMints =
        await walletRepositoryService.findPendingMintTransactions(
          mockTokenData.npub,
          cutoffDate
        );

      expect(pendingMints).toHaveLength(1);
      expect(pendingMints[0].transaction_id).toBe("tx_recent_mint");
      expect(pendingMints[0].transaction_type).toBe("minted");
      expect(pendingMints[0].status).toBe("pending");
    });
  });

  describe("countPendingTransactions", () => {
    beforeEach(async () => {
      await walletRepositoryService.createWallet(mockWalletData);

      // Create multiple pending transactions
      for (let i = 0; i < 3; i++) {
        await walletRepositoryService.createToken({
          ...mockTokenData,
          status: "pending",
          transaction_id: `tx_pending_${i}`,
        });
      }

      // Create non-pending transaction
      await walletRepositoryService.createToken({
        ...mockTokenData,
        status: "unspent",
        transaction_id: "tx_unspent",
      });
    });

    it("should count pending transactions correctly", async () => {
      const count = await walletRepositoryService.countPendingTransactions(
        mockTokenData.npub
      );

      expect(count).toBe(3);
    });

    it("should return 0 for npub with no pending transactions", async () => {
      const count = await walletRepositoryService.countPendingTransactions(
        "npub1nonexistent"
      );

      expect(count).toBe(0);
    });
  });

  describe("findStuckTransactions", () => {
    beforeEach(async () => {
      await walletRepositoryService.createWallet(mockWalletData);

      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);

      // Create stuck transaction (older than 1 hour)
      await walletRepositoryService.createToken({
        ...mockTokenData,
        status: "pending",
        transaction_id: "tx_stuck",
        created_at: twoHoursAgo,
      });

      // Create recent pending transaction (not stuck)
      await walletRepositoryService.createToken({
        ...mockTokenData,
        status: "pending",
        transaction_id: "tx_recent",
        created_at: thirtyMinutesAgo,
      });
    });

    it("should find stuck transactions older than cutoff", async () => {
      const cutoffDate = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago

      const stuckTransactions =
        await walletRepositoryService.findStuckTransactions(
          mockTokenData.npub,
          cutoffDate
        );

      expect(stuckTransactions).toHaveLength(1);
      expect(stuckTransactions[0].transaction_id).toBe("tx_stuck");
    });

    it("should return empty array when no stuck transactions", async () => {
      const cutoffDate = new Date(Date.now() - 3 * 60 * 60 * 1000); // 3 hours ago

      const stuckTransactions =
        await walletRepositoryService.findStuckTransactions(
          mockTokenData.npub,
          cutoffDate
        );

      expect(stuckTransactions).toEqual([]);
    });
  });

  describe("findTokensByTransactionId", () => {
    beforeEach(async () => {
      await walletRepositoryService.createWallet(mockWalletData);
      await walletRepositoryService.createToken(mockTokenData);
    });

    it("should find tokens by transaction ID", async () => {
      const tokens = await walletRepositoryService.findTokensByTransactionId(
        mockTokenData.transaction_id
      );

      expect(tokens).toHaveLength(1);
      expect(tokens[0].transaction_id).toBe(mockTokenData.transaction_id);
    });

    it("should return empty array for non-existing transaction ID", async () => {
      const tokens = await walletRepositoryService.findTokensByTransactionId(
        "tx_nonexistent"
      );

      expect(tokens).toEqual([]);
    });
  });

  describe("getTransactionHistory", () => {
    beforeEach(async () => {
      await walletRepositoryService.createWallet(mockWalletData);

      // Create multiple transactions
      const transactionTypes = ["minted", "sent", "received", "melted"];
      for (let i = 0; i < 10; i++) {
        await walletRepositoryService.createToken({
          ...mockTokenData,
          transaction_id: `tx_${i}`,
          transaction_type: transactionTypes[i % transactionTypes.length],
          amount: (i + 1) * 100,
        });
      }
    });

    it("should return paginated transaction history", async () => {
      const result = await walletRepositoryService.getTransactionHistory(
        mockTokenData.npub,
        { limit: 5, skip: 0 }
      );

      expect(result.transactions).toHaveLength(5);
      expect(result.pagination.total).toBe(10);
      expect(result.pagination.limit).toBe(5);
      expect(result.pagination.skip).toBe(0);
      expect(result.pagination.hasMore).toBe(true);
    });

    it("should filter by transaction type", async () => {
      const result = await walletRepositoryService.getTransactionHistory(
        mockTokenData.npub,
        { transaction_type: "minted" }
      );

      expect(
        result.transactions.every((tx) => tx.transaction_type === "minted")
      ).toBe(true);
    });

    it("should filter by mint URL", async () => {
      const result = await walletRepositoryService.getTransactionHistory(
        mockTokenData.npub,
        { mint_url: mockTokenData.mint_url }
      );

      expect(
        result.transactions.every(
          (tx) => tx.mint_url === mockTokenData.mint_url
        )
      ).toBe(true);
    });

    it("should return transactions in descending order by created_at", async () => {
      const result = await walletRepositoryService.getTransactionHistory(
        mockTokenData.npub,
        { limit: 10 }
      );

      for (let i = 1; i < result.transactions.length; i++) {
        expect(
          result.transactions[i - 1].created_at.getTime()
        ).toBeGreaterThanOrEqual(result.transactions[i].created_at.getTime());
      }
    });
  });

  describe("getWalletStats", () => {
    beforeEach(async () => {
      await walletRepositoryService.createWallet(mockWalletData);

      // Create transactions with different types and statuses
      await walletRepositoryService.createToken({
        ...mockTokenData,
        transaction_id: "tx_minted_1",
        transaction_type: "minted",
        status: "unspent",
        amount: 1000,
      });

      await walletRepositoryService.createToken({
        ...mockTokenData,
        transaction_id: "tx_sent_1",
        transaction_type: "sent",
        status: "spent",
        amount: 500,
      });

      await walletRepositoryService.createToken({
        ...mockTokenData,
        transaction_id: "tx_pending_1",
        transaction_type: "minted",
        status: "pending",
        amount: 2000,
      });
    });

    it("should return comprehensive wallet statistics", async () => {
      const stats = await walletRepositoryService.getWalletStats(
        mockTokenData.npub
      );

      expect(stats.npub).toBe(mockTokenData.npub);
      expect(stats.wallet_count).toBe(1);
      expect(stats.total_transactions).toBe(3);
      expect(stats.transaction_types).toEqual({
        minted: 2,
        sent: 1,
        received: 0,
        melted: 0,
        change: 0,
      });
      expect(stats.status_breakdown).toEqual({
        unspent: 1,
        spent: 1,
        pending: 1,
      });
      expect(stats.total_amount).toBe(3500);
      expect(stats.wallets).toHaveLength(1);
    });

    it("should return empty stats for non-existing npub", async () => {
      const stats = await walletRepositoryService.getWalletStats(
        "npub1nonexistent"
      );

      expect(stats.npub).toBe("npub1nonexistent");
      expect(stats.wallet_count).toBe(0);
      expect(stats.total_transactions).toBe(0);
      expect(stats.total_amount).toBe(0);
      expect(stats.wallets).toEqual([]);
    });
  });

  describe("getSystemStats", () => {
    beforeEach(async () => {
      await walletRepositoryService.createWallet(mockWalletData);

      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

      // Create pending transactions
      await walletRepositoryService.createToken({
        ...mockTokenData,
        status: "pending",
        transaction_id: "tx_pending_recent",
        created_at: new Date(Date.now() - 30 * 60 * 1000),
      });

      await walletRepositoryService.createToken({
        ...mockTokenData,
        status: "pending",
        transaction_id: "tx_pending_stuck",
        created_at: twoHoursAgo,
      });
    });

    it("should return system-wide statistics", async () => {
      const stats = await walletRepositoryService.getSystemStats();

      expect(stats.totalPendingTransactions).toBe(2);
      expect(stats.stuckTransactions).toBe(1); // Only the one older than 1 hour
      expect(stats.oldestPendingAge).toBeGreaterThan(60 * 60 * 1000); // More than 1 hour
    });

    it("should return zero stats when no pending transactions", async () => {
      // Update all pending transactions to unspent
      await CashuToken.updateMany({ status: "pending" }, { status: "unspent" });

      const stats = await walletRepositoryService.getSystemStats();

      expect(stats.totalPendingTransactions).toBe(0);
      expect(stats.stuckTransactions).toBe(0);
      expect(stats.oldestPendingAge).toBe(0);
    });
  });
});
