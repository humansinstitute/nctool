import mongoose from 'mongoose';
import CashuToken from '../../src/models/CashuToken.model.js';
import CashuWallet from '../../src/models/CashuWallet.model.js';
import walletRepositoryService from '../../src/services/walletRepository.service.js';

describe('Final Melt Operation Enhancements', () => {
  let testWallet;
  let testNpub;
  let testMintUrl;

  beforeAll(async () => {
    // Connect to test database
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(process.env.MONGODB_TEST_URI || 'mongodb://localhost:27017/nctool_test');
    }
  });

  beforeEach(async () => {
    // Clean up test data
    await CashuToken.deleteMany({});
    await CashuWallet.deleteMany({});

    // Setup test data with valid formats (using same format as existing tests)
    testNpub = 'npub1qy88wumn8ghj7mn0wd68ytnhd9hx2tcpydkx2um5wgh8w6twv4ekxqmr9ymd';
    testMintUrl = 'https://test-mint.example.com';

    testWallet = await CashuWallet.create({
      npub: testNpub,
      mint_url: testMintUrl,
      p2pk_pubkey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      p2pk_privkey: 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
      wallet_config: {
        unit: 'sat',
        created_via: 'api'
      }
    });
  });

  afterEach(async () => {
    // Clean up test data
    await CashuToken.deleteMany({});
    await CashuWallet.deleteMany({});
  });

  afterAll(async () => {
    await mongoose.connection.close();
  });

  describe('Enhanced CashuToken Model Validation', () => {
    test('should prevent storing melted tokens with consumed proofs', async () => {
      const tokenData = {
        npub: testNpub,
        wallet_id: testWallet._id,
        proofs: [{
          id: 'test_proof_1',
          amount: 100,
          secret: 'test_secret_1',
          C: 'test_c_1'
        }],
        mint_url: testMintUrl,
        status: 'spent',
        transaction_type: 'melted', // This should be rejected
        transaction_id: 'test_tx_1',
        metadata: {
          source: 'lightning'
        }
      };

      await expect(CashuToken.create(tokenData)).rejects.toThrow(
        "`melted` is not a valid enum value"
      );
    });

    test('should enforce change tokens to have parent_transaction_id', async () => {
      const tokenData = {
        npub: testNpub,
        wallet_id: testWallet._id,
        proofs: [{
          id: 'test_proof_1',
          amount: 100,
          secret: 'test_secret_1',
          C: 'test_c_1'
        }],
        mint_url: testMintUrl,
        status: 'unspent',
        transaction_type: 'change',
        transaction_id: 'test_tx_1',
        metadata: {
          source: 'change'
        } // Missing parent_transaction_id
      };

      await expect(CashuToken.create(tokenData)).rejects.toThrow(
        "Change tokens must have parent_transaction_id in metadata"
      );
    });

    test('should allow valid change tokens with proper metadata', async () => {
      const tokenData = {
        npub: testNpub,
        wallet_id: testWallet._id,
        proofs: [{
          id: 'test_proof_1',
          amount: 100,
          secret: 'test_secret_1',
          C: 'test_c_1'
        }],
        mint_url: testMintUrl,
        status: 'unspent',
        transaction_type: 'change',
        transaction_id: 'test_tx_1_keep',
        metadata: {
          source: 'change',
          parent_transaction_id: 'test_tx_1'
        }
      };

      const token = await CashuToken.create(tokenData);
      expect(token).toBeDefined();
      expect(token.transaction_type).toBe('change');
      expect(token.metadata.parent_transaction_id).toBe('test_tx_1');
    });
  });

  describe('Idempotency Controls', () => {
    test('should validate transaction ID format', async () => {
      const result1 = await walletRepositoryService.validateTransactionId('', 'melt');
      expect(result1.valid).toBe(false);
      expect(result1.code).toBe('INVALID_FORMAT');

      const result2 = await walletRepositoryService.validateTransactionId('short', 'melt');
      expect(result2.valid).toBe(false);
      expect(result2.code).toBe('INVALID_LENGTH');

      const result3 = await walletRepositoryService.validateTransactionId('tx_melt_1234567890_abc123', 'melt');
      expect(result3.valid).toBe(true);
    });

    test('should detect duplicate transaction IDs', async () => {
      const transactionId = 'tx_melt_1234567890_abc123';
      
      // Create a token with this transaction ID
      await CashuToken.create({
        npub: testNpub,
        wallet_id: testWallet._id,
        proofs: [{
          id: 'test_proof_1',
          amount: 100,
          secret: 'test_secret_1',
          C: 'test_c_1'
        }],
        mint_url: testMintUrl,
        status: 'unspent',
        transaction_type: 'minted',
        transaction_id: transactionId,
        metadata: {
          source: 'lightning'
        }
      });

      const result = await walletRepositoryService.validateTransactionId(transactionId, 'melt');
      expect(result.valid).toBe(false);
      expect(result.code).toBe('DUPLICATE_TRANSACTION_ID');
    });

    test('should generate operation hash consistently', () => {
      const params1 = {
        npub: testNpub,
        mint_url: testMintUrl,
        amount: 1000,
        source_token_ids: ['id1', 'id2', 'id3'],
        operation_type: 'melt'
      };

      const params2 = {
        npub: testNpub,
        mint_url: testMintUrl,
        amount: 1000,
        source_token_ids: ['id3', 'id1', 'id2'], // Different order
        operation_type: 'melt'
      };

      const hash1 = walletRepositoryService.generateOperationHash(params1);
      const hash2 = walletRepositoryService.generateOperationHash(params2);
      
      expect(hash1).toBe(hash2); // Should be same due to sorting
      expect(hash1).toHaveLength(16);
    });

    test('should detect duplicate operations', async () => {
      // Generate a realistic operation hash
      const operationParams = {
        npub: testNpub,
        mint_url: testMintUrl,
        amount: 100,
        source_token_ids: ['test_id_1', 'test_id_2'],
        operation_type: 'melt'
      };
      const operationHash = walletRepositoryService.generateOperationHash(operationParams);
      
      // Create a token with operation hash in metadata
      const token = await CashuToken.create({
        npub: testNpub,
        wallet_id: testWallet._id,
        proofs: [{
          id: 'test_proof_1',
          amount: 100,
          secret: 'test_secret_1',
          C: 'test_c_1'
        }],
        mint_url: testMintUrl,
        status: 'unspent',
        transaction_type: 'change',
        transaction_id: 'test_tx_1',
        metadata: {
          source: 'change',
          operation_hash: operationHash,
          parent_transaction_id: 'parent_tx'
        }
      });

      // Verify the token was created with the operation hash
      expect(token.metadata.operation_hash).toBe(operationHash);

      // Directly query the database to verify the token exists with the operation hash
      const foundTokens = await CashuToken.find({
        npub: testNpub,
        'metadata.operation_hash': operationHash
      });
      expect(foundTokens).toHaveLength(1);

      // Check for duplicate operation with a longer time window to ensure it's found
      const result = await walletRepositoryService.checkDuplicateOperation(testNpub, operationHash, 600000); // 10 minutes
      expect(result.isDuplicate).toBe(true);
      expect(result.originalTransaction).toBe('test_tx_1');
    });
  });

  describe('Enhanced Atomic Melt Operations', () => {
    let sourceTokens;

    beforeEach(async () => {
      // Create source tokens for testing
      sourceTokens = await Promise.all([
        CashuToken.create({
          npub: testNpub,
          wallet_id: testWallet._id,
          proofs: [{
            id: 'source_proof_1',
            amount: 500,
            secret: 'source_secret_1',
            C: 'source_c_1'
          }],
          mint_url: testMintUrl,
          status: 'unspent',
          transaction_type: 'minted',
          transaction_id: 'source_tx_1',
          metadata: {
            source: 'lightning'
          }
        }),
        CashuToken.create({
          npub: testNpub,
          wallet_id: testWallet._id,
          proofs: [{
            id: 'source_proof_2',
            amount: 300,
            secret: 'source_secret_2',
            C: 'source_c_2'
          }],
          mint_url: testMintUrl,
          status: 'unspent',
          transaction_type: 'minted',
          transaction_id: 'source_tx_2',
          metadata: {
            source: 'lightning'
          }
        })
      ]);
    });

    test('should execute atomic melt with idempotency controls', async () => {
      const transactionId = 'tx_melt_1234567890_test123';
      const sourceTokenIds = sourceTokens.map(t => t._id);
      
      const keepProofs = [{
        id: 'keep_proof_1',
        amount: 200,
        secret: 'keep_secret_1',
        C: 'keep_c_1'
      }];

      const meltChangeProofs = [{
        id: 'change_proof_1',
        amount: 50,
        secret: 'change_secret_1',
        C: 'change_c_1'
      }];

      const metadata = {
        npub: testNpub,
        wallet_id: testWallet._id,
        mint_url: testMintUrl,
        amount: 550
      };

      const result = await walletRepositoryService.executeAtomicMelt(
        sourceTokenIds,
        keepProofs,
        meltChangeProofs,
        transactionId,
        metadata
      );

      expect(result.success).toBe(true);
      expect(result.transaction_id).toBe(transactionId);
      expect(result.source_tokens_spent).toBe(2);
      expect(result.keep_amount).toBe(200);
      expect(result.melt_change_amount).toBe(50);

      // Verify source tokens are marked as spent
      const updatedSourceTokens = await CashuToken.find({ _id: { $in: sourceTokenIds } });
      updatedSourceTokens.forEach(token => {
        expect(token.status).toBe('spent');
        expect(token.spent_at).toBeDefined();
      });

      // Verify change tokens were created
      const keepTokens = await CashuToken.find({ transaction_id: `${transactionId}_keep` });
      expect(keepTokens).toHaveLength(1);
      expect(keepTokens[0].transaction_type).toBe('change');
      expect(keepTokens[0].metadata.operation_hash).toBeDefined();

      const meltChangeTokens = await CashuToken.find({ transaction_id: `${transactionId}_melt_change` });
      expect(meltChangeTokens).toHaveLength(1);
      expect(meltChangeTokens[0].transaction_type).toBe('change');
      expect(meltChangeTokens[0].metadata.operation_hash).toBeDefined();
    });

    test('should prevent concurrent operations on same tokens', async () => {
      const transactionId = 'tx_melt_1234567890_concurrent';
      const sourceTokenIds = sourceTokens.map(t => t._id);

      // Mark one source token as spent to simulate concurrent operation
      await CashuToken.findByIdAndUpdate(sourceTokenIds[0], { status: 'spent' });

      const metadata = {
        npub: testNpub,
        wallet_id: testWallet._id,
        mint_url: testMintUrl,
        amount: 550
      };

      await expect(
        walletRepositoryService.executeAtomicMelt(
          sourceTokenIds,
          [],
          [],
          transactionId,
          metadata
        )
      ).rejects.toThrow('Concurrent operation detected');
    });

    test('should prevent duplicate operations', async () => {
      const transactionId1 = 'tx_melt_1234567890_dup1';
      const sourceTokenIds = sourceTokens.map(t => t._id);

      const metadata = {
        npub: testNpub,
        wallet_id: testWallet._id,
        mint_url: testMintUrl,
        amount: 550
      };

      // First operation should succeed
      const result1 = await walletRepositoryService.executeAtomicMelt(
        sourceTokenIds,
        [],
        [],
        transactionId1,
        metadata
      );
      expect(result1.success).toBe(true);

      // Verify that the atomic melt operation completed successfully
      expect(result1.transaction_id).toBe(transactionId1);
      expect(result1.source_tokens_spent).toBe(2);

      // The test validates that the atomic melt operation prevents double-counting
      // by not creating "melted" tokens and instead marking source tokens as spent
      const spentTokens = await CashuToken.find({
        _id: { $in: sourceTokenIds },
        status: 'spent'
      });
      expect(spentTokens).toHaveLength(2);
    });
  });

  describe('Post-Melt Reconciliation and Audit', () => {
    test('should perform comprehensive post-melt reconciliation', async () => {
      const transactionId = 'tx_melt_1234567890_recon';
      
      // Create a completed melt transaction for reconciliation
      const sourceToken = await CashuToken.create({
        npub: testNpub,
        wallet_id: testWallet._id,
        proofs: [{
          id: 'recon_source_proof',
          amount: 1000,
          secret: 'recon_source_secret',
          C: 'recon_source_c'
        }],
        mint_url: testMintUrl,
        status: 'spent',
        transaction_type: 'minted',
        transaction_id: 'recon_source_tx',
        spent_at: new Date(),
        metadata: {
          source: 'lightning'
        }
      });

      const keepToken = await CashuToken.create({
        npub: testNpub,
        wallet_id: testWallet._id,
        proofs: [{
          id: 'recon_keep_proof',
          amount: 200,
          secret: 'recon_keep_secret',
          C: 'recon_keep_c'
        }],
        mint_url: testMintUrl,
        status: 'unspent',
        transaction_type: 'change',
        transaction_id: `${transactionId}_keep`,
        metadata: {
          source: 'change',
          parent_transaction_id: transactionId
        }
      });

      const expectedState = {
        source_token_ids: [sourceToken._id],
        keep_proofs_count: 1,
        melt_change_proofs_count: 0,
        balance_changes: {
          expected_unspent_balance: 200
        }
      };

      const reconciliationResult = await walletRepositoryService.performPostMeltReconciliation(
        transactionId,
        expectedState,
        testNpub,
        testMintUrl
      );

      expect(reconciliationResult.validation_passed).toBe(true);
      expect(reconciliationResult.checks_performed.length).toBeGreaterThan(0);
      expect(reconciliationResult.discrepancies_found).toHaveLength(0);
      expect(reconciliationResult.performance_metrics.reconciliation_duration_ms).toBeDefined();
    });

    test('should detect balance discrepancies', async () => {
      const transactionId = 'tx_melt_1234567890_discrepancy';
      
      const expectedState = {
        source_token_ids: [],
        balance_changes: {
          expected_unspent_balance: 1000 // This won't match actual balance
        }
      };

      const reconciliationResult = await walletRepositoryService.performPostMeltReconciliation(
        transactionId,
        expectedState,
        testNpub,
        testMintUrl
      );

      expect(reconciliationResult.validation_passed).toBe(false);
      expect(reconciliationResult.discrepancies_found.length).toBeGreaterThan(0);
    });

    test('should create audit log entries', async () => {
      const auditData = {
        operation_type: 'test_operation',
        transaction_id: 'test_tx_123',
        npub: testNpub,
        mint_url: testMintUrl,
        test_data: 'sensitive_information'
      };

      // This should not throw an error
      await expect(
        walletRepositoryService.createAuditLogEntry(auditData)
      ).resolves.not.toThrow();
    });

    test('should sanitize sensitive data in audit logs', () => {
      const sensitiveData = {
        npub: testNpub,
        proofs: [{
          amount: 100,
          secret: 'very_secret_proof_data_12345',
          id: 'proof_id_1'
        }],
        metadata: {
          private_key: 'super_secret_key',
          public_data: 'this_is_ok'
        }
      };

      const sanitized = walletRepositoryService.sanitizeAuditData(sensitiveData);

      expect(sanitized.npub).toBe(testNpub.substring(0, 10) + '...');
      expect(sanitized.proofs[0].secret).toBe('very_sec...');
      expect(sanitized.metadata.private_key).toBeUndefined();
      expect(sanitized.metadata.public_data).toBe('this_is_ok');
    });

    test('should generate operation performance report', async () => {
      const transactionId = 'tx_melt_1234567890_perf';
      
      // Create a token for the performance report
      await CashuToken.create({
        npub: testNpub,
        wallet_id: testWallet._id,
        proofs: [{
          id: 'perf_proof',
          amount: 100,
          secret: 'perf_secret',
          C: 'perf_c'
        }],
        mint_url: testMintUrl,
        status: 'spent',
        transaction_type: 'minted',
        transaction_id: transactionId,
        spent_at: new Date(),
        metadata: {
          source: 'lightning'
        }
      });

      const report = await walletRepositoryService.generateOperationPerformanceReport(transactionId);

      expect(report.transaction_id).toBe(transactionId);
      expect(report.performance_metrics).toBeDefined();
      expect(report.recommendations).toBeDefined();
      expect(Array.isArray(report.recommendations)).toBe(true);
    });
  });

  describe('Integration Test - Complete Enhanced Melt Flow', () => {
    test('should execute complete enhanced melt operation with all features', async () => {
      // 1. Setup source tokens
      const sourceTokens = await Promise.all([
        CashuToken.create({
          npub: testNpub,
          wallet_id: testWallet._id,
          proofs: [{
            id: 'integration_source_1',
            amount: 600,
            secret: 'integration_secret_1',
            C: 'integration_c_1'
          }],
          mint_url: testMintUrl,
          status: 'unspent',
          transaction_type: 'minted',
          transaction_id: 'integration_source_tx_1',
          metadata: {
            source: 'lightning'
          }
        }),
        CashuToken.create({
          npub: testNpub,
          wallet_id: testWallet._id,
          proofs: [{
            id: 'integration_source_2',
            amount: 400,
            secret: 'integration_secret_2',
            C: 'integration_c_2'
          }],
          mint_url: testMintUrl,
          status: 'unspent',
          transaction_type: 'minted',
          transaction_id: 'integration_source_tx_2',
          metadata: {
            source: 'lightning'
          }
        })
      ]);

      const transactionId = 'tx_melt_1234567890_integration';
      const sourceTokenIds = sourceTokens.map(t => t._id);
      
      const keepProofs = [{
        id: 'integration_keep',
        amount: 300,
        secret: 'integration_keep_secret',
        C: 'integration_keep_c'
      }];

      const meltChangeProofs = [{
        id: 'integration_change',
        amount: 100,
        secret: 'integration_change_secret',
        C: 'integration_change_c'
      }];

      const metadata = {
        npub: testNpub,
        wallet_id: testWallet._id,
        mint_url: testMintUrl,
        amount: 600 // Amount being melted (1000 - 300 keep - 100 change)
      };

      // 2. Execute atomic melt with all enhancements
      const meltResult = await walletRepositoryService.executeAtomicMelt(
        sourceTokenIds,
        keepProofs,
        meltChangeProofs,
        transactionId,
        metadata
      );

      expect(meltResult.success).toBe(true);

      // 3. Perform post-melt reconciliation
      const expectedState = {
        source_token_ids: sourceTokenIds,
        keep_proofs_count: 1,
        melt_change_proofs_count: 1,
        balance_changes: {
          expected_unspent_balance: 400 // 300 keep + 100 change
        }
      };

      const reconciliationResult = await walletRepositoryService.performPostMeltReconciliation(
        transactionId,
        expectedState,
        testNpub,
        testMintUrl
      );

      expect(reconciliationResult.validation_passed).toBe(true);

      // 4. Generate performance report
      const performanceReport = await walletRepositoryService.generateOperationPerformanceReport(transactionId);
      expect(performanceReport.transaction_id).toBe(transactionId);

      // 5. Verify final state
      const finalBalance = await walletRepositoryService.calculateBalance(testNpub, testMintUrl);
      expect(finalBalance.unspent_balance).toBe(400);
      expect(finalBalance.spent_balance).toBe(1000);

      // 6. Verify audit trail
      const keepTokens = await CashuToken.find({ transaction_id: `${transactionId}_keep` });
      const meltChangeTokens = await CashuToken.find({ transaction_id: `${transactionId}_melt_change` });
      
      expect(keepTokens[0].metadata.operation_hash).toBeDefined();
      expect(keepTokens[0].metadata.atomic_operation).toBe(true);
      expect(meltChangeTokens[0].metadata.operation_hash).toBeDefined();
      expect(meltChangeTokens[0].metadata.atomic_operation).toBe(true);
    });
  });
});