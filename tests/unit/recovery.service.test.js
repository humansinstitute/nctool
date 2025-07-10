import RecoveryService from "../../src/services/recovery.service.js";
import walletRepositoryService from "../../src/services/walletRepository.service.js";

// Mock dependencies
jest.mock("../../src/services/walletRepository.service.js", () => ({
  default: {
    findStuckTransactions: jest.fn(),
    updatePendingTransaction: jest.fn(),
    findPendingTransactions: jest.fn(),
  },
}));

jest.mock("../../src/utils/logger.js", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const mockWalletRepository = jest.mocked(walletRepositoryService);

describe("RecoveryService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("cleanupStuckTransactions", () => {
    const mockStuckTransactions = [
      {
        _id: "token1",
        transaction_id: "tx1",
        created_at: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
        metadata: { quote_id: "quote1" },
      },
      {
        _id: "token2",
        transaction_id: "tx2",
        created_at: new Date(Date.now() - 3 * 60 * 60 * 1000), // 3 hours ago
        metadata: { quote_id: "quote2" },
      },
    ];

    beforeEach(() => {
      mockWalletRepository.findStuckTransactions.mockResolvedValue(
        mockStuckTransactions
      );
      mockWalletRepository.updatePendingTransaction.mockResolvedValue(true);
    });

    it("should perform dry run without making changes", async () => {
      const result = await RecoveryService.cleanupStuckTransactions(
        "npub1test",
        { dryRun: true }
      );

      expect(result.dryRun).toBe(true);
      expect(result.processed).toBe(2);
      expect(result.cleaned).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.transactions).toHaveLength(2);
      expect(
        mockWalletRepository.updatePendingTransaction
      ).not.toHaveBeenCalled();
    });

    it("should cleanup stuck transactions successfully", async () => {
      const result = await RecoveryService.cleanupStuckTransactions(
        "npub1test",
        { dryRun: false }
      );

      expect(result.dryRun).toBe(false);
      expect(result.processed).toBe(2);
      expect(result.cleaned).toBe(2);
      expect(result.failed).toBe(0);
      expect(
        mockWalletRepository.updatePendingTransaction
      ).toHaveBeenCalledTimes(2);
    });

    it("should handle cleanup failures gracefully", async () => {
      mockWalletRepository.updatePendingTransaction
        .mockResolvedValueOnce(true)
        .mockRejectedValueOnce(new Error("Update failed"));

      const result = await RecoveryService.cleanupStuckTransactions(
        "npub1test",
        { dryRun: false }
      );

      expect(result.processed).toBe(2);
      expect(result.cleaned).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("tx2");
    });

    it("should use custom maxAge when provided", async () => {
      const customMaxAge = 30 * 60 * 1000; // 30 minutes
      await RecoveryService.cleanupStuckTransactions("npub1test", {
        maxAge: customMaxAge,
      });

      expect(mockWalletRepository.findStuckTransactions).toHaveBeenCalledWith(
        "npub1test",
        expect.any(Date)
      );
    });

    it("should handle empty stuck transactions list", async () => {
      mockWalletRepository.findStuckTransactions.mockResolvedValue([]);

      const result = await RecoveryService.cleanupStuckTransactions(
        "npub1test"
      );

      expect(result.processed).toBe(0);
      expect(result.cleaned).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.transactions).toEqual([]);
    });
  });

  describe("retryUpdatePendingTransaction", () => {
    it("should succeed on first attempt", async () => {
      mockWalletRepository.updatePendingTransaction.mockResolvedValue(true);

      const result = await RecoveryService.retryUpdatePendingTransaction(
        "token1",
        { status: "failed" }
      );

      expect(result.success).toBe(true);
      expect(result.attempts).toBe(1);
      expect(result.error).toBeUndefined();
      expect(
        mockWalletRepository.updatePendingTransaction
      ).toHaveBeenCalledTimes(1);
    });

    it("should retry on failure and eventually succeed", async () => {
      mockWalletRepository.updatePendingTransaction
        .mockRejectedValueOnce(new Error("Network error"))
        .mockRejectedValueOnce(new Error("Network error"))
        .mockResolvedValueOnce(true);

      const result = await RecoveryService.retryUpdatePendingTransaction(
        "token1",
        { status: "failed" }
      );

      expect(result.success).toBe(true);
      expect(result.attempts).toBe(3);
      expect(result.error).toBeUndefined();
      expect(
        mockWalletRepository.updatePendingTransaction
      ).toHaveBeenCalledTimes(3);
    });

    it("should fail after maximum retries", async () => {
      const error = new Error("Persistent error");
      mockWalletRepository.updatePendingTransaction.mockRejectedValue(error);

      const result = await RecoveryService.retryUpdatePendingTransaction(
        "token1",
        { status: "failed" }
      );

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(3);
      expect(result.error).toBe("Persistent error");
      expect(
        mockWalletRepository.updatePendingTransaction
      ).toHaveBeenCalledTimes(3);
    });

    it("should use custom retry options", async () => {
      mockWalletRepository.updatePendingTransaction.mockRejectedValue(
        new Error("Error")
      );

      const result = await RecoveryService.retryUpdatePendingTransaction(
        "token1",
        { status: "failed" },
        { maxRetries: 1, baseDelay: 100 }
      );

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(1);
      expect(
        mockWalletRepository.updatePendingTransaction
      ).toHaveBeenCalledTimes(1);
    });
  });

  describe("getRecoveryStats", () => {
    beforeEach(() => {
      const mockPendingTransactions = [
        {
          transaction_id: "tx1",
          created_at: new Date(Date.now() - 30 * 60 * 1000), // 30 minutes ago
          metadata: { quote_id: "quote1" },
        },
        {
          transaction_id: "tx2",
          created_at: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
          metadata: { quote_id: "quote2" },
        },
        {
          transaction_id: "tx3",
          created_at: new Date(Date.now() - 3 * 60 * 60 * 1000), // 3 hours ago
          metadata: { quote_id: "quote3" },
        },
      ];

      mockWalletRepository.findPendingTransactions.mockResolvedValue(
        mockPendingTransactions
      );
    });

    it("should return correct recovery statistics", async () => {
      const stats = await RecoveryService.getRecoveryStats("npub1test");

      expect(stats.npub).toBe("npub1test");
      expect(stats.totalPending).toBe(3);
      expect(stats.stuckOneHour).toBe(2);
      expect(stats.stuckSixHours).toBe(0);
      expect(stats.stuckTwentyFourHours).toBe(0);
      expect(stats.oldestPendingAge).toBeGreaterThan(2.9 * 60 * 60 * 1000);
      expect(stats.transactions).toHaveLength(3);
    });

    it("should handle no pending transactions", async () => {
      mockWalletRepository.findPendingTransactions.mockResolvedValue([]);

      const stats = await RecoveryService.getRecoveryStats("npub1test");

      expect(stats.totalPending).toBe(0);
      expect(stats.stuckOneHour).toBe(0);
      expect(stats.stuckSixHours).toBe(0);
      expect(stats.stuckTwentyFourHours).toBe(0);
      expect(stats.oldestPendingAge).toBe(0);
      expect(stats.transactions).toEqual([]);
    });

    it("should categorize stuck transactions correctly", async () => {
      const mockTransactions = [
        {
          transaction_id: "tx1",
          created_at: new Date(Date.now() - 30 * 60 * 1000), // 30 minutes ago
          metadata: {},
        },
        {
          transaction_id: "tx2",
          created_at: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
          metadata: {},
        },
        {
          transaction_id: "tx3",
          created_at: new Date(Date.now() - 8 * 60 * 60 * 1000), // 8 hours ago
          metadata: {},
        },
        {
          transaction_id: "tx4",
          created_at: new Date(Date.now() - 25 * 60 * 60 * 1000), // 25 hours ago
          metadata: {},
        },
      ];

      mockWalletRepository.findPendingTransactions.mockResolvedValue(
        mockTransactions
      );

      const stats = await RecoveryService.getRecoveryStats("npub1test");

      expect(stats.totalPending).toBe(4);
      expect(stats.stuckOneHour).toBe(3); // tx2, tx3, tx4
      expect(stats.stuckSixHours).toBe(2); // tx3, tx4
      expect(stats.stuckTwentyFourHours).toBe(1); // tx4
    });
  });

  describe("batchCleanup", () => {
    it("should process transactions in batches", async () => {
      const mockTransactions = Array.from({ length: 15 }, (_, i) => ({
        _id: `token${i}`,
        transaction_id: `tx${i}`,
        created_at: new Date(Date.now() - 2 * 60 * 60 * 1000),
        metadata: {},
      }));

      mockWalletRepository.findStuckTransactions.mockResolvedValue(
        mockTransactions
      );
      mockWalletRepository.updatePendingTransaction.mockResolvedValue(true);

      const result = await RecoveryService.batchCleanup("npub1test", {
        batchSize: 5,
      });

      expect(result.processed).toBe(15);
      expect(result.cleaned).toBe(15);
      expect(result.batches).toBe(3);
      expect(
        mockWalletRepository.updatePendingTransaction
      ).toHaveBeenCalledTimes(15);
    });

    it("should handle batch processing timeout", async () => {
      const mockTransactions = Array.from({ length: 5 }, (_, i) => ({
        _id: `token${i}`,
        transaction_id: `tx${i}`,
        created_at: new Date(Date.now() - 2 * 60 * 60 * 1000),
        metadata: {},
      }));

      mockWalletRepository.findStuckTransactions.mockResolvedValue(
        mockTransactions
      );
      mockWalletRepository.updatePendingTransaction.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 200))
      );

      const result = await RecoveryService.batchCleanup("npub1test", {
        batchSize: 2,
        batchTimeout: 100,
      });

      expect(result.processed).toBe(5);
      expect(result.timeouts).toBeGreaterThan(0);
    });
  });
});
