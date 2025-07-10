import request from "supertest";
import express from "express";
import { setupTestDB, teardownTestDB } from "../setup.js";
import CashuWallet from "../../src/models/CashuWallet.model.js";
import CashuToken from "../../src/models/CashuToken.model.js";
import ValidationService from "../../src/services/validation.service.js";
import MonitoringService from "../../src/services/monitoring.service.js";
import RecoveryService from "../../src/services/recovery.service.js";
import walletRoutes from "../../src/routes/wallet.routes.js";

// Mock external dependencies
jest.mock("../../src/services/cashu.service.js", () => ({
  mintTokens: jest.fn(),
  completeMinting: jest.fn(),
  getBalance: jest.fn(),
}));

jest.mock("../../src/services/identity.service.js", () => ({
  getAllKeys: jest.fn(),
}));

jest.mock("../../src/services/nostr.service.js", () => ({
  connect: jest.fn(),
}));

import {
  mintTokens,
  completeMinting,
  getBalance,
} from "../../src/services/cashu.service.js";
import { getAllKeys } from "../../src/services/identity.service.js";

// Create a minimal Express app for testing
const createTestApp = () => {
  const app = express();
  app.use(express.json());
  app.use("/api/wallet", walletRoutes);
  return app;
};

describe("Lightning Minting Integration Tests", () => {
  const testNpub =
    "npub1test123456789abcdefghijklmnopqrstuvwxyz0123456789abcdef";
  const testMintUrl = "https://mint.example.com";
  let app;

  beforeAll(async () => {
    await setupTestDB();
    app = createTestApp();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  beforeEach(async () => {
    await CashuWallet.deleteMany({});
    await CashuToken.deleteMany({});
    jest.clearAllMocks();

    // Reset monitoring metrics
    MonitoringService.resetMetrics();

    // Setup default mocks
    getAllKeys.mockResolvedValue([
      {
        npub: testNpub,
        nsec: "nsec1test123456789abcdef",
        wallet: {
          mint: testMintUrl,
          p2pkPub:
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        },
      },
    ]);

    // Create test wallet
    await CashuWallet.create({
      npub: testNpub,
      mint_url: testMintUrl,
      p2pk_pubkey:
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      p2pk_privkey:
        "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210",
      wallet_config: {
        unit: "sat",
        created_via: "api",
      },
    });
  });

  describe("Complete Lightning Minting Flow", () => {
    it("should complete full minting flow successfully", async () => {
      // Mock successful minting
      mintTokens.mockResolvedValue({
        quote: "quote123",
        invoice: "lnbc1000n1...",
        amount: 1000,
        transactionId: "tx123",
        expiry: Date.now() + 600000,
        mintUrl: testMintUrl,
      });

      completeMinting.mockResolvedValue({
        proofs: [
          {
            id: "proof1",
            amount: 1000,
            secret: "secret1",
            C: "commitment1",
          },
        ],
        tokenId: "token123",
        transactionId: "tx123",
        totalAmount: 1000,
      });

      // Step 1: Initiate minting
      const mintResponse = await request(app)
        .post(`/api/wallet/${testNpub}/mint`)
        .send({ amount: 1000 })
        .expect(200);

      expect(mintResponse.body.success).toBe(true);
      expect(mintResponse.body.quote).toBe("quote123");
      expect(mintResponse.body.invoice).toBe("lnbc1000n1...");
      expect(mintResponse.body.transactionId).toBe("tx123");

      // Verify pending transaction was created
      const pendingTokens = await CashuToken.find({
        npub: testNpub,
        status: "pending",
      });
      expect(pendingTokens).toHaveLength(1);
      expect(pendingTokens[0].transaction_id).toBe("tx123");

      // Step 2: Complete minting
      const completeResponse = await request(app)
        .post(`/api/wallet/${testNpub}/mint/complete`)
        .send({
          quoteId: "quote123",
          amount: 1000,
          transactionId: "tx123",
        })
        .expect(200);

      expect(completeResponse.body.success).toBe(true);
      expect(completeResponse.body.tokenId).toBe("token123");
      expect(completeResponse.body.totalAmount).toBe(1000);

      // Verify token was updated to unspent
      const completedTokens = await CashuToken.find({
        npub: testNpub,
        transaction_id: "tx123",
      });
      expect(completedTokens).toHaveLength(1);
      expect(completedTokens[0].status).toBe("unspent");

      // Verify monitoring metrics were tracked
      const metrics = MonitoringService.getMintingMetrics();
      expect(metrics.minting.attempts).toBe(1);
      expect(metrics.minting.successes).toBe(1);
      expect(metrics.completion.attempts).toBe(1);
      expect(metrics.completion.successes).toBe(1);
    });

    it("should handle minting failure gracefully", async () => {
      mintTokens.mockRejectedValue(new Error("Mint service unavailable"));

      const response = await request(app)
        .post(`/api/wallet/${testNpub}/mint`)
        .send({ amount: 1000 })
        .expect(500);

      expect(response.body.error).toBe("Failed to mint tokens");
      expect(response.body.message).toBe("Mint service unavailable");

      // Verify no pending transaction was created
      const pendingTokens = await CashuToken.find({
        npub: testNpub,
        status: "pending",
      });
      expect(pendingTokens).toHaveLength(0);

      // Verify failure was tracked
      const metrics = MonitoringService.getMintingMetrics();
      expect(metrics.minting.attempts).toBe(1);
      expect(metrics.minting.failures).toBe(1);
    });

    it("should handle completion failure with recovery attempt", async () => {
      // Setup successful minting
      mintTokens.mockResolvedValue({
        quote: "quote123",
        invoice: "lnbc1000n1...",
        amount: 1000,
        transactionId: "tx123",
        expiry: Date.now() + 600000,
        mintUrl: testMintUrl,
      });

      // Mock completion failure
      completeMinting.mockRejectedValue(
        new Error("Failed to update pending transaction: Database error")
      );

      // Step 1: Successful minting
      await request(app)
        .post(`/api/wallet/${testNpub}/mint`)
        .send({ amount: 1000 })
        .expect(200);

      // Step 2: Failed completion with recovery
      const completeResponse = await request(app)
        .post(`/api/wallet/${testNpub}/mint/complete`)
        .send({
          quoteId: "quote123",
          amount: 1000,
          transactionId: "tx123",
        })
        .expect(500);

      expect(completeResponse.body.error).toBe("Failed to complete minting");

      // Verify failure was tracked
      const metrics = MonitoringService.getMintingMetrics();
      expect(metrics.completion.failures).toBe(1);
    });
  });

  describe("Validation Safeguards", () => {
    it("should reject invalid npub format", async () => {
      const response = await request(app)
        .post("/api/wallet/invalid_npub/mint")
        .send({ amount: 1000 })
        .expect(400);

      expect(response.body.error).toBe("Validation failed");
      expect(response.body.details).toContain("Invalid npub format");
    });

    it("should reject amount below minimum", async () => {
      const response = await request(app)
        .post(`/api/wallet/${testNpub}/mint`)
        .send({ amount: 0 })
        .expect(400);

      expect(response.body.error).toBe("Validation failed");
      expect(response.body.details).toContain(
        "Amount must be between 1 and 1000000 sats"
      );
    });

    it("should reject amount above maximum", async () => {
      const response = await request(app)
        .post(`/api/wallet/${testNpub}/mint`)
        .send({ amount: 1000001 })
        .expect(400);

      expect(response.body.error).toBe("Validation failed");
      expect(response.body.details).toContain(
        "Amount must be between 1 and 1000000 sats"
      );
    });

    it("should warn for large amounts", async () => {
      mintTokens.mockResolvedValue({
        quote: "quote123",
        invoice: "lnbc500000n1...",
        amount: 500000,
        transactionId: "tx123",
        expiry: Date.now() + 600000,
        mintUrl: testMintUrl,
      });

      const response = await request(app)
        .post(`/api/wallet/${testNpub}/mint`)
        .send({ amount: 500000 })
        .expect(200);

      expect(response.body.warnings).toContain(
        "Large amount detected (>100k sats). Please verify this is intentional."
      );
    });

    it("should reject when too many pending transactions", async () => {
      // Get the wallet for wallet_id
      const wallet = await CashuWallet.findOne({ npub: testNpub });

      // Create 5 pending transactions (at the limit)
      for (let i = 0; i < 5; i++) {
        await CashuToken.create({
          npub: testNpub,
          wallet_id: wallet._id,
          mint_url: testMintUrl,
          transaction_id: `tx_pending_${i}`,
          transaction_type: "minted",
          status: "pending",
          proofs: [],
          metadata: {
            source: "lightning",
            lightning_invoice: `lnbc1000n1_${i}...`,
          },
        });
      }

      const response = await request(app)
        .post(`/api/wallet/${testNpub}/mint`)
        .send({ amount: 1000 })
        .expect(400);

      expect(response.body.error).toBe("Validation failed");
      expect(response.body.details).toContain("Too many pending transactions");
    });

    it("should warn about stuck transactions", async () => {
      // Get the wallet for wallet_id
      const wallet = await CashuWallet.findOne({ npub: testNpub });

      // Create a stuck transaction (older than 1 hour)
      await CashuToken.create({
        npub: testNpub,
        wallet_id: wallet._id,
        mint_url: testMintUrl,
        transaction_id: "tx_stuck",
        transaction_type: "minted",
        status: "pending",
        proofs: [],
        created_at: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
        metadata: {
          source: "lightning",
          lightning_invoice: "lnbc1000n1_stuck...",
        },
      });

      mintTokens.mockResolvedValue({
        quote: "quote123",
        invoice: "lnbc1000n1...",
        amount: 1000,
        transactionId: "tx123",
        expiry: Date.now() + 600000,
        mintUrl: testMintUrl,
      });

      const response = await request(app)
        .post(`/api/wallet/${testNpub}/mint`)
        .send({ amount: 1000 })
        .expect(200);

      expect(response.body.warnings).toContain(
        "1 stuck transaction(s) detected (>1 hour old). Consider cleanup."
      );
    });

    it("should reject completion with missing required fields", async () => {
      const response = await request(app)
        .post(`/api/wallet/${testNpub}/mint/complete`)
        .send({
          // Missing quoteId, amount, transactionId
        })
        .expect(400);

      expect(response.body.error).toBe("Validation failed");
      expect(response.body.details).toContain("quoteId is required");
      expect(response.body.details).toContain("amount is required");
      expect(response.body.details).toContain("transactionId is required");
    });
  });

  describe("Monitoring and Recovery Endpoints", () => {
    it("should return system health metrics", async () => {
      const response = await request(app)
        .get("/api/wallet/system/health")
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.health).toBeDefined();
      expect(response.body.runtime).toBeDefined();
      expect(response.body.health.status).toMatch(/healthy|warning|critical/);
    });

    it("should perform manual alert check", async () => {
      const response = await request(app)
        .post("/api/wallet/system/check-alerts")
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.alertSent).toBeDefined();
      expect(response.body.stuckCount).toBeDefined();
    });

    it("should cleanup stuck transactions", async () => {
      // Get the wallet for wallet_id
      const wallet = await CashuWallet.findOne({ npub: testNpub });

      // Create a stuck transaction
      await CashuToken.create({
        npub: testNpub,
        wallet_id: wallet._id,
        mint_url: testMintUrl,
        transaction_id: "tx_stuck",
        transaction_type: "minted",
        status: "pending",
        proofs: [],
        created_at: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
        metadata: {
          source: "lightning",
          lightning_invoice: "lnbc1000n1_stuck...",
        },
      });

      const response = await request(app)
        .post(`/api/wallet/${testNpub}/cleanup`)
        .send({ dryRun: false })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.processed).toBe(1);
      expect(response.body.cleaned).toBe(1);
      expect(response.body.failed).toBe(0);

      // Verify transaction was marked as failed
      const updatedToken = await CashuToken.findOne({
        transaction_id: "tx_stuck",
      });
      expect(updatedToken.status).toBe("failed");
    });

    it("should perform dry run cleanup without changes", async () => {
      // Get the wallet for wallet_id
      const wallet = await CashuWallet.findOne({ npub: testNpub });

      // Create a stuck transaction
      await CashuToken.create({
        npub: testNpub,
        wallet_id: wallet._id,
        mint_url: testMintUrl,
        transaction_id: "tx_stuck",
        transaction_type: "minted",
        status: "pending",
        proofs: [],
        created_at: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
        metadata: {
          source: "lightning",
          lightning_invoice: "lnbc1000n1_stuck...",
        },
      });

      const response = await request(app)
        .post(`/api/wallet/${testNpub}/cleanup`)
        .send({ dryRun: true })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.dryRun).toBe(true);
      expect(response.body.processed).toBe(1);
      expect(response.body.cleaned).toBe(0);

      // Verify transaction was not changed
      const unchangedToken = await CashuToken.findOne({
        transaction_id: "tx_stuck",
      });
      expect(unchangedToken.status).toBe("pending");
    });

    it("should return recovery statistics", async () => {
      // Get the wallet for wallet_id
      const wallet = await CashuWallet.findOne({ npub: testNpub });

      // Create various pending transactions
      await CashuToken.create({
        npub: testNpub,
        wallet_id: wallet._id,
        mint_url: testMintUrl,
        transaction_id: "tx_recent",
        transaction_type: "minted",
        status: "pending",
        proofs: [],
        created_at: new Date(Date.now() - 30 * 60 * 1000), // 30 minutes ago
        metadata: {
          source: "lightning",
          lightning_invoice: "lnbc1000n1_recent...",
        },
      });

      await CashuToken.create({
        npub: testNpub,
        wallet_id: wallet._id,
        mint_url: testMintUrl,
        transaction_id: "tx_stuck",
        transaction_type: "minted",
        status: "pending",
        proofs: [],
        created_at: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
        metadata: {
          source: "lightning",
          lightning_invoice: "lnbc2000n1_stuck...",
        },
      });

      const response = await request(app)
        .get(`/api/wallet/${testNpub}/recovery/stats`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.stats.npub).toBe(testNpub);
      expect(response.body.stats.totalPending).toBe(2);
      expect(response.body.stats.stuckOneHour).toBe(1);
      expect(response.body.stats.transactions).toHaveLength(2);
    });
  });

  describe("Error Handling and Edge Cases", () => {
    it("should handle non-existent user gracefully", async () => {
      getAllKeys.mockResolvedValue([]);

      const response = await request(app)
        .post("/api/wallet/npub1nonexistent/mint")
        .send({ amount: 1000 })
        .expect(404);

      expect(response.body.error).toBe("User not found");
    });

    it("should handle wallet not found", async () => {
      // Remove the test wallet
      await CashuWallet.deleteMany({});

      const response = await request(app)
        .post(`/api/wallet/${testNpub}/mint`)
        .send({ amount: 1000 })
        .expect(400);

      expect(response.body.error).toBe("Validation failed");
      expect(response.body.details).toContain("Wallet not found for this user");
    });

    it("should handle service timeouts gracefully", async () => {
      mintTokens.mockImplementation(
        () =>
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Service timeout")), 100)
          )
      );

      const response = await request(app)
        .post(`/api/wallet/${testNpub}/mint`)
        .send({ amount: 1000 })
        .expect(500);

      expect(response.body.error).toBe("Failed to mint tokens");
      expect(response.body.message).toBe("Service timeout");
    });

    it("should handle database connection errors", async () => {
      // Mock database error
      jest
        .spyOn(CashuToken.prototype, "save")
        .mockRejectedValue(new Error("Database connection failed"));

      mintTokens.mockResolvedValue({
        quote: "quote123",
        invoice: "lnbc1000n1...",
        amount: 1000,
        transactionId: "tx123",
        expiry: Date.now() + 600000,
        mintUrl: testMintUrl,
      });

      const response = await request(app)
        .post(`/api/wallet/${testNpub}/mint`)
        .send({ amount: 1000 })
        .expect(500);

      expect(response.body.error).toBe("Failed to mint tokens");
    });
  });

  describe("Performance and Load Testing", () => {
    it("should handle multiple concurrent minting requests", async () => {
      mintTokens.mockImplementation((npub, amount) =>
        Promise.resolve({
          quote: `quote_${Date.now()}_${Math.random()}`,
          invoice: `lnbc${amount}n1...`,
          amount,
          transactionId: `tx_${Date.now()}_${Math.random()}`,
          expiry: Date.now() + 600000,
          mintUrl: testMintUrl,
        })
      );

      const requests = Array.from({ length: 5 }, (_, i) =>
        request(app)
          .post(`/api/wallet/${testNpub}/mint`)
          .send({ amount: 1000 + i * 100 })
      );

      const responses = await Promise.all(requests);

      responses.forEach((response) => {
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
      });

      // Verify all transactions were created
      const pendingTokens = await CashuToken.find({
        npub: testNpub,
        status: "pending",
      });
      expect(pendingTokens).toHaveLength(5);
    });

    it("should track performance metrics correctly", async () => {
      mintTokens.mockResolvedValue({
        quote: "quote123",
        invoice: "lnbc1000n1...",
        amount: 1000,
        transactionId: "tx123",
        expiry: Date.now() + 600000,
        mintUrl: testMintUrl,
      });

      completeMinting.mockResolvedValue({
        proofs: [
          { id: "proof1", amount: 1000, secret: "secret1", C: "commitment1" },
        ],
        tokenId: "token123",
        transactionId: "tx123",
        totalAmount: 1000,
      });

      // Perform multiple operations
      for (let i = 0; i < 3; i++) {
        await request(app)
          .post(`/api/wallet/${testNpub}/mint`)
          .send({ amount: 1000 })
          .expect(200);

        await request(app)
          .post(`/api/wallet/${testNpub}/mint/complete`)
          .send({
            quoteId: "quote123",
            amount: 1000,
            transactionId: "tx123",
          })
          .expect(200);
      }

      const metrics = MonitoringService.getMintingMetrics();
      expect(metrics.minting.attempts).toBe(3);
      expect(metrics.minting.successes).toBe(3);
      expect(metrics.completion.attempts).toBe(3);
      expect(metrics.completion.successes).toBe(3);
      expect(metrics.minting.successRate).toBe(100);
      expect(metrics.completion.successRate).toBe(100);
    });
  });
});
