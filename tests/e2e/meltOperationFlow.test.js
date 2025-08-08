import request from "supertest";
import express from "express";
import { setupTestDB, teardownTestDB } from "../setup.js";
import CashuWallet from "../../src/models/CashuWallet.model.js";
import CashuToken from "../../src/models/CashuToken.model.js";
import ValidationService from "../../src/services/validation.service.js";
import MonitoringService from "../../src/services/monitoring.service.js";
import walletRepositoryService from "../../src/services/walletRepository.service.js";
import walletRoutes from "../../src/routes/wallet.routes.js";

// Mock external dependencies
jest.mock("../../src/services/cashu.service.js", () => ({
  meltTokens: jest.fn(),
  checkProofStates: jest.fn(),
  performPreFlightReconciliation: jest.fn(),
  reconcileProofStates: jest.fn(),
  initializeWallet: jest.fn(),
}));

jest.mock("../../src/services/identity.service.js", () => ({
  getAllKeys: jest.fn(),
}));

import {
  meltTokens,
  checkProofStates,
  performPreFlightReconciliation,
  reconcileProofStates,
  initializeWallet,
} from "../../src/services/cashu.service.js";
import { getAllKeys } from "../../src/services/identity.service.js";

// Create a minimal Express app for testing
const createTestApp = () => {
  const app = express();
  app.use(express.json());
  app.use("/api/wallet", walletRoutes);
  return app;
};

describe("Melt Operation Flow E2E Tests", () => {
  const testNpub = "npub1test123456789abcdefghijklmnopqrstuvwxyz0123456789abcdef";
  const testMintUrl = "https://mint.example.com";
  const testInvoice = "lnbc1000n1pjqxqzjsp5test123456789abcdefghijklmnopqrstuvwxyz";
  let app;
  let testWallet;

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
          p2pkPub: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        },
      },
    ]);

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

    // Mock wallet initialization
    initializeWallet.mockResolvedValue({
      wallet: {
        createMeltQuote: jest.fn(),
        send: jest.fn(),
        meltProofs: jest.fn(),
      },
      walletDoc: testWallet,
      mint: { getInfo: jest.fn() },
    });
  });

  describe("Complete Melt Operation Flow", () => {
    it("should complete full melt operation with atomic persistence", async () => {
      // Setup: Create unspent tokens for melting
      const sourceToken1 = await CashuToken.create({
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

      const sourceToken2 = await CashuToken.create({
        npub: testNpub,
        wallet_id: testWallet._id,
        mint_url: testMintUrl,
        transaction_id: "tx_source_2",
        transaction_type: "minted",
        status: "unspent",
        proofs: [
          { id: "proof3", amount: 400, secret: "secret3", C: "commitment3" },
        ],
        metadata: { source: "lightning" },
      });

      // Mock successful pre-flight reconciliation
      performPreFlightReconciliation.mockResolvedValue({
        success: true,
        operationCleared: true,
        discrepanciesFound: false,
        stateCheck: { consistent: true, discrepancies: [] },
        reconciliationResult: null,
      });

      // Mock successful melt operation with atomic result
      meltTokens.mockResolvedValue({
        transactionId: "tx_melt_123",
        paymentResult: "PAID",
        paidAmount: 1000,
        feesPaid: 50,
        changeAmount: 150,
        quoteId: "quote_123",
        atomicResult: {
          success: true,
          transaction_id: "tx_melt_123",
          source_tokens_spent: 2,
          keep_token_id: "keep_token_456",
          keep_amount: 100,
          melt_change_token_id: "melt_change_token_789",
          melt_change_amount: 50,
          operations: [
            {
              type: "keep_change",
              token_id: "keep_token_456",
              amount: 100,
              proof_count: 1,
            },
            {
              type: "melt_change",
              token_id: "melt_change_token_789",
              amount: 50,
              proof_count: 1,
            },
          ],
        },
        operationDuration: 2500,
      });

      // Execute melt operation
      const response = await request(app)
        .post(`/api/wallet/${testNpub}/melt`)
        .send({ invoice: testInvoice })
        .expect(200);

      // Verify response structure
      expect(response.body.success).toBe(true);
      expect(response.body.transactionId).toBe("tx_melt_123");
      expect(response.body.paymentResult).toBe("PAID");
      expect(response.body.paidAmount).toBe(1000);
      expect(response.body.feesPaid).toBe(50);
      expect(response.body.changeAmount).toBe(150);

      // Verify atomic operation details
      expect(response.body.atomicResult).toBeDefined();
      expect(response.body.atomicResult.success).toBe(true);
      expect(response.body.atomicResult.source_tokens_spent).toBe(2);
      expect(response.body.atomicResult.operations).toHaveLength(2);

      // Verify pre-flight reconciliation was called
      expect(performPreFlightReconciliation).toHaveBeenCalledWith(
        testNpub,
        expect.arrayContaining([
          expect.objectContaining({ secret: "secret1" }),
          expect.objectContaining({ secret: "secret2" }),
          expect.objectContaining({ secret: "secret3" }),
        ])
      );

      // Verify melt operation was called with correct parameters
      expect(meltTokens).toHaveBeenCalledWith(testNpub, testInvoice);

      // Verify monitoring metrics
      const metrics = MonitoringService.getMeltingMetrics();
      expect(metrics.melt.attempts).toBe(1);
      expect(metrics.melt.successes).toBe(1);
    });

    it("should handle pre-flight reconciliation with discrepancies", async () => {
      // Setup: Create unspent tokens
      await CashuToken.create({
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

      // Mock pre-flight reconciliation with discrepancies that can be resolved
      performPreFlightReconciliation.mockResolvedValue({
        success: true,
        operationCleared: true,
        discrepanciesFound: true,
        discrepanciesResolved: true,
        stateCheck: {
          consistent: false,
          discrepancies: [
            {
              severity: "MEDIUM",
              type: "DB_PENDING_MINT_SPENT",
              description: "Database shows proof as pending but mint shows as spent",
              action_required: "UPDATE_STATUS",
            },
          ],
          severityCounts: { HIGH: 0, MEDIUM: 1, LOW: 0 },
        },
        reconciliationResult: {
          success: true,
          actionsPerformed: [
            {
              discrepancy_type: "DB_PENDING_MINT_SPENT",
              action: "UPDATED_PENDING_TO_SPENT",
              success: true,
            },
          ],
          reconciliationSummary: {
            totalDiscrepancies: 1,
            resolved: 1,
            blocked: 0,
            failed: 0,
          },
        },
      });

      // Mock successful melt after reconciliation
      meltTokens.mockResolvedValue({
        transactionId: "tx_melt_123",
        paymentResult: "PAID",
        paidAmount: 950,
        feesPaid: 50,
        changeAmount: 0,
        quoteId: "quote_123",
        atomicResult: {
          success: true,
          transaction_id: "tx_melt_123",
          source_tokens_spent: 1,
          operations: [],
        },
      });

      const response = await request(app)
        .post(`/api/wallet/${testNpub}/melt`)
        .send({ invoice: testInvoice })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.transactionId).toBe("tx_melt_123");

      // Verify pre-flight reconciliation was performed
      expect(performPreFlightReconciliation).toHaveBeenCalled();
    });

    it("should block operation on HIGH severity discrepancies", async () => {
      // Setup: Create unspent tokens
      await CashuToken.create({
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

      // Mock pre-flight reconciliation blocking due to HIGH severity discrepancies
      const highSeverityError = new Error(
        "Melt operation blocked due to HIGH severity proof state discrepancies. " +
        "1 critical discrepancies detected. Database state inconsistent with mint ground truth."
      );
      highSeverityError.code = "HIGH_SEVERITY_DISCREPANCIES";
      highSeverityError.discrepancies = [
        {
          severity: "HIGH",
          type: "DB_UNSPENT_MINT_SPENT",
          description: "Database shows proof as unspent but mint shows as spent",
          action_required: "BLOCK_OPERATION",
        },
      ];

      performPreFlightReconciliation.mockRejectedValue(highSeverityError);

      const response = await request(app)
        .post(`/api/wallet/${testNpub}/melt`)
        .send({ invoice: testInvoice })
        .expect(400);

      expect(response.body.error).toBe("Proof state validation failed");
      expect(response.body.message).toContain("HIGH severity proof state discrepancies");
      expect(response.body.code).toBe("PROOF_STATE_INCONSISTENCY");
      expect(response.body.severity).toBe("CRITICAL");

      // Verify melt operation was not called
      expect(meltTokens).not.toHaveBeenCalled();

      // Verify failure was tracked
      const metrics = MonitoringService.getMeltingMetrics();
      expect(metrics.melt.attempts).toBe(1);
      expect(metrics.melt.failures).toBe(1);
    });

    it("should handle insufficient balance gracefully", async () => {
      // Setup: Create insufficient tokens
      await CashuToken.create({
        npub: testNpub,
        wallet_id: testWallet._id,
        mint_url: testMintUrl,
        transaction_id: "tx_source_1",
        transaction_type: "minted",
        status: "unspent",
        proofs: [
          { id: "proof1", amount: 100, secret: "secret1", C: "commitment1" },
        ],
        metadata: { source: "lightning" },
      });

      // Mock successful pre-flight reconciliation
      performPreFlightReconciliation.mockResolvedValue({
        success: true,
        operationCleared: true,
        discrepanciesFound: false,
      });

      // Mock insufficient balance error
      meltTokens.mockRejectedValue(
        new Error("Insufficient balance. Required: 1000, Available: 100")
      );

      const response = await request(app)
        .post(`/api/wallet/${testNpub}/melt`)
        .send({ invoice: testInvoice })
        .expect(400);

      expect(response.body.error).toBe("Failed to melt tokens");
      expect(response.body.message).toContain("Insufficient balance");
    });

    it("should handle mint operation failure with critical error classification", async () => {
      // Setup: Create sufficient tokens
      await CashuToken.create({
        npub: testNpub,
        wallet_id: testWallet._id,
        mint_url: testMintUrl,
        transaction_id: "tx_source_1",
        transaction_type: "minted",
        status: "unspent",
        proofs: [
          { id: "proof1", amount: 1200, secret: "secret1", C: "commitment1" },
        ],
        metadata: { source: "lightning" },
      });

      // Mock successful pre-flight reconciliation
      performPreFlightReconciliation.mockResolvedValue({
        success: true,
        operationCleared: true,
        discrepanciesFound: false,
      });

      // Mock critical melt failure (mint succeeded but DB update failed)
      const criticalError = new Error(
        "CRITICAL: Lightning payment succeeded but database update failed. " +
        "Your payment was processed but local wallet state is inconsistent. " +
        "Please contact support immediately with Quote ID: quote_123 " +
        "and Transaction ID: tx_melt_123"
      );
      criticalError.code = "CRITICAL_DB_FAILURE_AFTER_MINT_SUCCESS";
      criticalError.severity = "CRITICAL";
      criticalError.quoteId = "quote_123";
      criticalError.transactionId = "tx_melt_123";
      criticalError.requiresManualIntervention = true;

      meltTokens.mockRejectedValue(criticalError);

      const response = await request(app)
        .post(`/api/wallet/${testNpub}/melt`)
        .send({ invoice: testInvoice })
        .expect(500);

      expect(response.body.error).toBe("Critical melt operation failure");
      expect(response.body.message).toContain("Lightning payment succeeded but database update failed");
      expect(response.body.code).toBe("CRITICAL_DB_FAILURE_AFTER_MINT_SUCCESS");
      expect(response.body.severity).toBe("CRITICAL");
      expect(response.body.requiresManualIntervention).toBe(true);
      expect(response.body.quoteId).toBe("quote_123");
      expect(response.body.transactionId).toBe("tx_melt_123");
    });
  });

  describe("Performance and Timeout Testing", () => {
    it("should handle operation timeout gracefully", async () => {
      // Setup: Create tokens
      await CashuToken.create({
        npub: testNpub,
        wallet_id: testWallet._id,
        mint_url: testMintUrl,
        transaction_id: "tx_source_1",
        transaction_type: "minted",
        status: "unspent",
        proofs: [
          { id: "proof1", amount: 1200, secret: "secret1", C: "commitment1" },
        ],
        metadata: { source: "lightning" },
      });

      // Mock successful pre-flight reconciliation
      performPreFlightReconciliation.mockResolvedValue({
        success: true,
        operationCleared: true,
        discrepanciesFound: false,
      });

      // Mock timeout
      meltTokens.mockImplementation(
        () =>
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Operation timeout")), 100)
          )
      );

      const response = await request(app)
        .post(`/api/wallet/${testNpub}/melt`)
        .send({ invoice: testInvoice })
        .expect(500);

      expect(response.body.error).toBe("Failed to melt tokens");
      expect(response.body.message).toBe("Operation timeout");
    });

    it("should track performance metrics for successful operations", async () => {
      // Setup: Create tokens
      await CashuToken.create({
        npub: testNpub,
        wallet_id: testWallet._id,
        mint_url: testMintUrl,
        transaction_id: "tx_source_1",
        transaction_type: "minted",
        status: "unspent",
        proofs: [
          { id: "proof1", amount: 1200, secret: "secret1", C: "commitment1" },
        ],
        metadata: { source: "lightning" },
      });

      // Mock successful operations
      performPreFlightReconciliation.mockResolvedValue({
        success: true,
        operationCleared: true,
        discrepanciesFound: false,
      });

      meltTokens.mockResolvedValue({
        transactionId: "tx_melt_123",
        paymentResult: "PAID",
        paidAmount: 1000,
        feesPaid: 50,
        changeAmount: 150,
        operationDuration: 1500,
        atomicResult: { success: true },
      });

      // Perform multiple operations
      for (let i = 0; i < 3; i++) {
        await request(app)
          .post(`/api/wallet/${testNpub}/melt`)
          .send({ invoice: testInvoice })
          .expect(200);
      }

      const metrics = MonitoringService.getMeltingMetrics();
      expect(metrics.melt.attempts).toBe(3);
      expect(metrics.melt.successes).toBe(3);
      expect(metrics.melt.successRate).toBe(100);
      expect(metrics.melt.averageOperationTime).toBeGreaterThan(0);
    });
  });

  describe("Error Scenarios and Recovery", () => {
    it("should handle database transaction rollback scenarios", async () => {
      // Setup: Create tokens
      await CashuToken.create({
        npub: testNpub,
        wallet_id: testWallet._id,
        mint_url: testMintUrl,
        transaction_id: "tx_source_1",
        transaction_type: "minted",
        status: "unspent",
        proofs: [
          { id: "proof1", amount: 1200, secret: "secret1", C: "commitment1" },
        ],
        metadata: { source: "lightning" },
      });

      // Mock successful pre-flight reconciliation
      performPreFlightReconciliation.mockResolvedValue({
        success: true,
        operationCleared: true,
        discrepanciesFound: false,
      });

      // Mock atomic transaction failure
      meltTokens.mockRejectedValue(
        new Error("Atomic melt transaction failed: Database transaction rolled back")
      );

      const response = await request(app)
        .post(`/api/wallet/${testNpub}/melt`)
        .send({ invoice: testInvoice })
        .expect(500);

      expect(response.body.error).toBe("Failed to melt tokens");
      expect(response.body.message).toContain("Atomic melt transaction failed");

      // Verify original tokens remain unspent (rollback successful)
      const originalTokens = await CashuToken.find({
        npub: testNpub,
        transaction_id: "tx_source_1",
      });
      expect(originalTokens).toHaveLength(1);
      expect(originalTokens[0].status).toBe("unspent");
    });

    it("should handle concurrent melt operations safely", async () => {
      // Setup: Create tokens
      await CashuToken.create({
        npub: testNpub,
        wallet_id: testWallet._id,
        mint_url: testMintUrl,
        transaction_id: "tx_source_1",
        transaction_type: "minted",
        status: "unspent",
        proofs: [
          { id: "proof1", amount: 2000, secret: "secret1", C: "commitment1" },
        ],
        metadata: { source: "lightning" },
      });

      // Mock successful pre-flight reconciliation
      performPreFlightReconciliation.mockResolvedValue({
        success: true,
        operationCleared: true,
        discrepanciesFound: false,
      });

      // Mock first operation succeeds, second fails due to insufficient balance
      let callCount = 0;
      meltTokens.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            transactionId: "tx_melt_123",
            paymentResult: "PAID",
            paidAmount: 1000,
            feesPaid: 50,
            changeAmount: 950,
            atomicResult: { success: true },
          });
        } else {
          return Promise.reject(
            new Error("Insufficient balance. Required: 1000, Available: 0")
          );
        }
      });

      // Execute concurrent operations
      const requests = [
        request(app)
          .post(`/api/wallet/${testNpub}/melt`)
          .send({ invoice: testInvoice }),
        request(app)
          .post(`/api/wallet/${testNpub}/melt`)
          .send({ invoice: testInvoice }),
      ];

      const responses = await Promise.allSettled(requests);

      // One should succeed, one should fail
      const successCount = responses.filter(
        (r) => r.status === "fulfilled" && r.value.status === 200
      ).length;
      const failureCount = responses.filter(
        (r) => r.status === "fulfilled" && r.value.status !== 200
      ).length;

      expect(successCount).toBe(1);
      expect(failureCount).toBe(1);
    });

    it("should validate invoice format before processing", async () => {
      const response = await request(app)
        .post(`/api/wallet/${testNpub}/melt`)
        .send({ invoice: "invalid_invoice_format" })
        .expect(400);

      expect(response.body.error).toBe("Validation failed");
      expect(response.body.details).toContain("Invalid Lightning invoice format");

      // Verify no operations were attempted
      expect(performPreFlightReconciliation).not.toHaveBeenCalled();
      expect(meltTokens).not.toHaveBeenCalled();
    });

    it("should handle missing required fields", async () => {
      const response = await request(app)
        .post(`/api/wallet/${testNpub}/melt`)
        .send({}) // Missing invoice
        .expect(400);

      expect(response.body.error).toBe("Validation failed");
      expect(response.body.details).toContain("invoice is required");
    });
  });

  describe("Integration with Atomic Transaction System", () => {
    it("should verify atomic transaction creates correct change tokens", async () => {
      // Setup: Create source tokens
      await CashuToken.create({
        npub: testNpub,
        wallet_id: testWallet._id,
        mint_url: testMintUrl,
        transaction_id: "tx_source_1",
        transaction_type: "minted",
        status: "unspent",
        proofs: [
          { id: "proof1", amount: 1200, secret: "secret1", C: "commitment1" },
        ],
        metadata: { source: "lightning" },
      });

      // Mock successful pre-flight reconciliation
      performPreFlightReconciliation.mockResolvedValue({
        success: true,
        operationCleared: true,
        discrepanciesFound: false,
      });

      // Mock melt with change tokens
      meltTokens.mockResolvedValue({
        transactionId: "tx_melt_123",
        paymentResult: "PAID",
        paidAmount: 1000,
        feesPaid: 50,
        changeAmount: 150,
        atomicResult: {
          success: true,
          transaction_id: "tx_melt_123",
          source_tokens_spent: 1,
          keep_token_id: "keep_token_456",
          keep_amount: 100,
          melt_change_token_id: "melt_change_token_789",
          melt_change_amount: 50,
          operations: [
            {
              type: "keep_change",
              token_id: "keep_token_456",
              amount: 100,
              proof_count: 1,
            },
            {
              type: "melt_change",
              token_id: "melt_change_token_789",
              amount: 50,
              proof_count: 1,
            },
          ],
        },
      });

      const response = await request(app)
        .post(`/api/wallet/${testNpub}/melt`)
        .send({ invoice: testInvoice })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.atomicResult.operations).toHaveLength(2);

      // Verify both types of change tokens were created
      const keepChangeOp = response.body.atomicResult.operations.find(
        (op) => op.type === "keep_change"
      );
      const meltChangeOp = response.body.atomicResult.operations.find(
        (op) => op.type === "melt_change"
      );

      expect(keepChangeOp).toBeDefined();
      expect(keepChangeOp.amount).toBe(100);
      expect(meltChangeOp).toBeDefined();
      expect(meltChangeOp.amount).toBe(50);
    });

    it("should verify no melted token documents are created with consumed proofs", async () => {
      // Setup: Create source tokens
      await CashuToken.create({
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

      // Mock successful operations
      performPreFlightReconciliation.mockResolvedValue({
        success: true,
        operationCleared: true,
        discrepanciesFound: false,
      });

      meltTokens.mockResolvedValue({
        transactionId: "tx_melt_123",
        paymentResult: "PAID",
        paidAmount: 1000,
        feesPaid: 50,
        changeAmount: 0,
        atomicResult: {
          success: true,
          transaction_id: "tx_melt_123",
          source_tokens_spent: 1,
          operations: [], // No change tokens
        },
      });

      await request(app)
        .post(`/api/wallet/${testNpub}/melt`)
        .send({ invoice: testInvoice })
        .expect(200);

      // Verify no "melted" transaction_type tokens were created
      const meltedTokens = await CashuToken.find({
        npub: testNpub,
        transaction_type: "melted",
      });
      expect(meltedTokens).toHaveLength(0);

      // Verify source token was marked as spent
      const sourceTokens = await CashuToken.find({
        npub: testNpub,
        transaction_id: "tx_source_1",
      });
      expect(sourceTokens).toHaveLength(1);
      expect(sourceTokens[0].status).toBe("spent");
    });
  });
});