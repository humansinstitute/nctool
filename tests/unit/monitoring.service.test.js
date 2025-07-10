import MonitoringService from "../../src/services/monitoring.service.js";
import walletRepositoryService from "../../src/services/walletRepository.service.js";

// Mock dependencies
jest.mock("../../src/services/walletRepository.service.js");
jest.mock("../../src/utils/logger.js", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe("MonitoringService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset the monitoring service state
    MonitoringService.metrics = {
      minting: {
        attempts: 0,
        successes: 0,
        failures: 0,
        totalCompletionTime: 0,
        averageCompletionTime: 0,
      },
      completion: {
        attempts: 0,
        successes: 0,
        failures: 0,
        totalCompletionTime: 0,
        averageCompletionTime: 0,
      },
      errors: [],
      lastReset: new Date(),
    };
  });

  describe("trackMintingAttempt", () => {
    it("should increment minting attempts", () => {
      MonitoringService.trackMintingAttempt("npub1test", 1000, "tx123");

      const metrics = MonitoringService.getMintingMetrics();
      expect(metrics.minting.attempts).toBe(1);
    });

    it("should track multiple attempts", () => {
      MonitoringService.trackMintingAttempt("npub1test1", 1000, "tx123");
      MonitoringService.trackMintingAttempt("npub1test2", 2000, "tx124");

      const metrics = MonitoringService.getMintingMetrics();
      expect(metrics.minting.attempts).toBe(2);
    });
  });

  describe("trackMintingSuccess", () => {
    it("should increment minting successes", () => {
      MonitoringService.trackMintingSuccess("npub1test", "tx123", {
        amount: 1000,
      });

      const metrics = MonitoringService.getMintingMetrics();
      expect(metrics.minting.successes).toBe(1);
    });

    it("should calculate success rate correctly", () => {
      MonitoringService.trackMintingAttempt("npub1test1", 1000, "tx123");
      MonitoringService.trackMintingAttempt("npub1test2", 2000, "tx124");
      MonitoringService.trackMintingSuccess("npub1test1", "tx123", {
        amount: 1000,
      });

      const metrics = MonitoringService.getMintingMetrics();
      expect(metrics.minting.attempts).toBe(2);
      expect(metrics.minting.successes).toBe(1);
      expect(metrics.minting.successRate).toBe(50);
    });
  });

  describe("trackMintingFailure", () => {
    it("should increment minting failures", () => {
      MonitoringService.trackMintingFailure(
        "npub1test",
        "tx123",
        "Network error"
      );

      const metrics = MonitoringService.getMintingMetrics();
      expect(metrics.minting.failures).toBe(1);
    });

    it("should store error details", () => {
      MonitoringService.trackMintingFailure(
        "npub1test",
        "tx123",
        "Network error"
      );

      const metrics = MonitoringService.getMintingMetrics();
      expect(metrics.errors).toHaveLength(1);
      expect(metrics.errors[0]).toMatchObject({
        type: "minting_failure",
        npub: "npub1test",
        transactionId: "tx123",
        error: "Network error",
      });
    });

    it("should calculate failure rate correctly", () => {
      MonitoringService.trackMintingAttempt("npub1test1", 1000, "tx123");
      MonitoringService.trackMintingAttempt("npub1test2", 2000, "tx124");
      MonitoringService.trackMintingFailure("npub1test1", "tx123", "Error");

      const metrics = MonitoringService.getMintingMetrics();
      expect(metrics.minting.attempts).toBe(2);
      expect(metrics.minting.failures).toBe(1);
      expect(metrics.minting.failureRate).toBe(50);
    });
  });

  describe("trackCompletionAttempt", () => {
    it("should increment completion attempts", () => {
      MonitoringService.trackCompletionAttempt(
        "npub1test",
        "tx123",
        "quote123"
      );

      const metrics = MonitoringService.getMintingMetrics();
      expect(metrics.completion.attempts).toBe(1);
    });
  });

  describe("trackCompletionSuccess", () => {
    it("should increment completion successes and track timing", () => {
      const completionTime = 1500;
      MonitoringService.trackCompletionSuccess(
        "npub1test",
        "tx123",
        completionTime,
        { amount: 1000 }
      );

      const metrics = MonitoringService.getMintingMetrics();
      expect(metrics.completion.successes).toBe(1);
      expect(metrics.completion.totalCompletionTime).toBe(completionTime);
      expect(metrics.completion.averageCompletionTime).toBe(completionTime);
    });

    it("should calculate average completion time correctly", () => {
      MonitoringService.trackCompletionSuccess("npub1test1", "tx123", 1000, {});
      MonitoringService.trackCompletionSuccess("npub1test2", "tx124", 2000, {});

      const metrics = MonitoringService.getMintingMetrics();
      expect(metrics.completion.successes).toBe(2);
      expect(metrics.completion.totalCompletionTime).toBe(3000);
      expect(metrics.completion.averageCompletionTime).toBe(1500);
    });
  });

  describe("trackCompletionFailure", () => {
    it("should increment completion failures", () => {
      MonitoringService.trackCompletionFailure(
        "npub1test",
        "tx123",
        "Quote not paid"
      );

      const metrics = MonitoringService.getMintingMetrics();
      expect(metrics.completion.failures).toBe(1);
    });

    it("should store error details", () => {
      MonitoringService.trackCompletionFailure(
        "npub1test",
        "tx123",
        "Quote not paid"
      );

      const metrics = MonitoringService.getMintingMetrics();
      expect(metrics.errors).toHaveLength(1);
      expect(metrics.errors[0]).toMatchObject({
        type: "completion_failure",
        npub: "npub1test",
        transactionId: "tx123",
        error: "Quote not paid",
      });
    });
  });

  describe("getHealthMetrics", () => {
    beforeEach(() => {
      walletRepositoryService.getSystemStats.mockResolvedValue({
        totalPendingTransactions: 5,
        stuckTransactions: 2,
        oldestPendingAge: 2 * 60 * 60 * 1000, // 2 hours
      });
    });

    it("should return healthy status when all metrics are good", async () => {
      // Set up good metrics
      MonitoringService.trackMintingAttempt("npub1test", 1000, "tx123");
      MonitoringService.trackMintingSuccess("npub1test", "tx123", {});

      const health = await MonitoringService.getHealthMetrics();

      expect(health.status).toBe("healthy");
      expect(health.alerts).toEqual([]);
    });

    it("should return warning status for high failure rate", async () => {
      // Set up high failure rate
      for (let i = 0; i < 10; i++) {
        MonitoringService.trackMintingAttempt(`npub1test${i}`, 1000, `tx${i}`);
        if (i < 8) {
          MonitoringService.trackMintingFailure(
            `npub1test${i}`,
            `tx${i}`,
            "Error"
          );
        } else {
          MonitoringService.trackMintingSuccess(`npub1test${i}`, `tx${i}`, {});
        }
      }

      const health = await MonitoringService.getHealthMetrics();

      expect(health.status).toBe("warning");
      expect(health.alerts).toContainEqual(
        expect.objectContaining({
          type: "high_failure_rate",
          severity: "warning",
        })
      );
    });

    it("should return critical status for very high failure rate", async () => {
      // Set up very high failure rate
      for (let i = 0; i < 10; i++) {
        MonitoringService.trackMintingAttempt(`npub1test${i}`, 1000, `tx${i}`);
        if (i < 9) {
          MonitoringService.trackMintingFailure(
            `npub1test${i}`,
            `tx${i}`,
            "Error"
          );
        } else {
          MonitoringService.trackMintingSuccess(`npub1test${i}`, `tx${i}`, {});
        }
      }

      const health = await MonitoringService.getHealthMetrics();

      expect(health.status).toBe("critical");
      expect(health.alerts).toContainEqual(
        expect.objectContaining({
          type: "high_failure_rate",
          severity: "critical",
        })
      );
    });

    it("should detect stuck transactions alert", async () => {
      walletRepositoryService.getSystemStats.mockResolvedValue({
        totalPendingTransactions: 10,
        stuckTransactions: 6,
        oldestPendingAge: 2 * 60 * 60 * 1000,
      });

      const health = await MonitoringService.getHealthMetrics();

      expect(health.alerts).toContainEqual(
        expect.objectContaining({
          type: "stuck_transactions",
          severity: "warning",
        })
      );
    });

    it("should detect slow completion times alert", async () => {
      // Set up slow completion times
      for (let i = 0; i < 5; i++) {
        MonitoringService.trackCompletionSuccess(
          `npub1test${i}`,
          `tx${i}`,
          15000,
          {}
        ); // 15 seconds
      }

      const health = await MonitoringService.getHealthMetrics();

      expect(health.alerts).toContainEqual(
        expect.objectContaining({
          type: "slow_completion",
          severity: "warning",
        })
      );
    });
  });

  describe("checkStuckTransactionAlerts", () => {
    it("should send alert when stuck transactions exceed threshold", async () => {
      walletRepositoryService.getSystemStats.mockResolvedValue({
        totalPendingTransactions: 10,
        stuckTransactions: 6,
        oldestPendingAge: 2 * 60 * 60 * 1000,
      });

      const result = await MonitoringService.checkStuckTransactionAlerts();

      expect(result.alertSent).toBe(true);
      expect(result.stuckCount).toBe(6);
      expect(result.threshold).toBe(5);
    });

    it("should not send alert when stuck transactions are below threshold", async () => {
      walletRepositoryService.getSystemStats.mockResolvedValue({
        totalPendingTransactions: 10,
        stuckTransactions: 3,
        oldestPendingAge: 2 * 60 * 60 * 1000,
      });

      const result = await MonitoringService.checkStuckTransactionAlerts();

      expect(result.alertSent).toBe(false);
      expect(result.stuckCount).toBe(3);
      expect(result.threshold).toBe(5);
    });
  });

  describe("resetMetrics", () => {
    it("should reset all metrics to initial state", () => {
      // Add some metrics
      MonitoringService.trackMintingAttempt("npub1test", 1000, "tx123");
      MonitoringService.trackMintingSuccess("npub1test", "tx123", {});
      MonitoringService.trackMintingFailure("npub1test2", "tx124", "Error");

      // Reset metrics
      MonitoringService.resetMetrics();

      const metrics = MonitoringService.getMintingMetrics();
      expect(metrics.minting.attempts).toBe(0);
      expect(metrics.minting.successes).toBe(0);
      expect(metrics.minting.failures).toBe(0);
      expect(metrics.completion.attempts).toBe(0);
      expect(metrics.completion.successes).toBe(0);
      expect(metrics.completion.failures).toBe(0);
      expect(metrics.errors).toEqual([]);
    });
  });

  describe("getMintingMetrics", () => {
    it("should return complete metrics with calculated rates", () => {
      MonitoringService.trackMintingAttempt("npub1test1", 1000, "tx123");
      MonitoringService.trackMintingAttempt("npub1test2", 2000, "tx124");
      MonitoringService.trackMintingSuccess("npub1test1", "tx123", {});
      MonitoringService.trackCompletionAttempt(
        "npub1test1",
        "tx123",
        "quote123"
      );
      MonitoringService.trackCompletionSuccess("npub1test1", "tx123", 1500, {});

      const metrics = MonitoringService.getMintingMetrics();

      expect(metrics).toMatchObject({
        minting: {
          attempts: 2,
          successes: 1,
          failures: 0,
          successRate: 50,
          failureRate: 0,
        },
        completion: {
          attempts: 1,
          successes: 1,
          failures: 0,
          successRate: 100,
          failureRate: 0,
          averageCompletionTime: 1500,
        },
      });
    });

    it("should handle division by zero for rates", () => {
      const metrics = MonitoringService.getMintingMetrics();

      expect(metrics.minting.successRate).toBe(0);
      expect(metrics.minting.failureRate).toBe(0);
      expect(metrics.completion.successRate).toBe(0);
      expect(metrics.completion.failureRate).toBe(0);
    });
  });
});
