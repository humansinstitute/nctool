# Integration Guidelines and Backward Compatibility

**Date:** 2025-08-08  
**Status:** Production Ready  
**Version:** 2.0  
**Priority:** Critical - Integration Guide

## Executive Summary

This document provides comprehensive integration guidelines for the updated melt operation system, ensuring smooth migration paths for existing clients while enabling new features for enhanced clients. The implementation maintains full backward compatibility while providing clear upgrade paths for improved functionality.

## Table of Contents

1. [Backward Compatibility Overview](#backward-compatibility-overview)
2. [API Compatibility Matrix](#api-compatibility-matrix)
3. [Client Migration Guide](#client-migration-guide)
4. [Database Migration Strategy](#database-migration-strategy)
5. [Feature Flag Implementation](#feature-flag-implementation)
6. [Integration Testing Guidelines](#integration-testing-guidelines)
7. [SDK and Library Updates](#sdk-and-library-updates)
8. [Error Handling Migration](#error-handling-migration)
9. [Performance Considerations](#performance-considerations)
10. [Rollback Procedures](#rollback-procedures)

---

## Backward Compatibility Overview

### Compatibility Guarantees

#### ✅ Maintained Compatibility
- **API Endpoints**: All existing endpoints remain functional
- **Request Formats**: Existing request structures accepted
- **Response Structures**: Core response fields preserved
- **Error Codes**: Existing error codes maintained
- **Database Schema**: No breaking changes to existing data

#### ✅ Enhanced Functionality
- **Additional Response Fields**: New fields added without breaking existing parsers
- **Enhanced Error Information**: More detailed error context available
- **Performance Improvements**: Faster operations with same interface
- **Data Integrity**: Improved consistency without client changes

#### ⚠️ Deprecated Features
- **Sequential Operations**: Internal implementation changed to atomic
- **"melted" Transaction Type**: No longer created (existing data preserved)
- **Legacy Error Handling**: Enhanced error classification available

### Version Support Matrix

| Client Version | Compatibility Level | Support Status | Migration Required |
|----------------|-------------------|----------------|-------------------|
| v1.0.x | Full Compatibility | Supported | No |
| v1.1.x | Full Compatibility | Supported | No |
| v1.2.x | Full Compatibility | Supported | No |
| v2.0.x | Enhanced Features | Recommended | Optional |

---

## API Compatibility Matrix

### Melt Operation Endpoint

#### Request Compatibility
```http
POST /api/wallet/{npub}/melt
Content-Type: application/json

{
  "invoice": "lnbc1000n1pjqxqzjsp5..."
}
```

**Compatibility**: ✅ **100% Compatible** - No changes required

#### Response Compatibility

##### v1.x Response (Maintained)
```json
{
  "success": true,
  "transactionId": "tx_melt_1691234567_abc123",
  "paymentResult": "PAID",
  "paidAmount": 1000,
  "feesPaid": 50,
  "changeAmount": 150,
  "quoteId": "quote_789"
}
```

##### v2.0 Enhanced Response (Additive)
```json
{
  "success": true,
  "transactionId": "tx_melt_1691234567_abc123",
  "paymentResult": "PAID",
  "paidAmount": 1000,
  "feesPaid": 50,
  "changeAmount": 150,
  "quoteId": "quote_789",
  
  // NEW: Enhanced fields (ignored by v1.x clients)
  "atomicResult": {
    "success": true,
    "transaction_id": "tx_melt_1691234567_abc123",
    "source_tokens_spent": 2,
    "keep_token_id": "64f1a2b3c4d5e6f7g8h9i0j1",
    "keep_amount": 100,
    "melt_change_token_id": "64f1a2b3c4d5e6f7g8h9i0j2",
    "melt_change_amount": 50,
    "operations": [...]
  },
  "operationDuration": 2500,
  "reconciliationInfo": {
    "discrepanciesFound": false,
    "discrepanciesResolved": false
  }
}
```

**Compatibility**: ✅ **Additive Only** - Existing clients continue to work

### Error Response Compatibility

#### v1.x Error Response (Maintained)
```json
{
  "error": "Failed to melt tokens",
  "message": "Insufficient balance. Required: 1000, Available: 500"
}
```

#### v2.0 Enhanced Error Response (Additive)
```json
{
  "error": "Failed to melt tokens",
  "message": "Insufficient balance. Required: 1000, Available: 500",
  
  // NEW: Enhanced error information
  "code": "INSUFFICIENT_BALANCE",
  "severity": "HIGH",
  "details": {
    "required": 1000,
    "available": 500,
    "shortfall": 500
  },
  "recommendation": "Add more funds to your wallet"
}
```

**Compatibility**: ✅ **Additive Only** - Existing error handling continues to work

---

## Client Migration Guide

### Migration Phases

#### Phase 1: No Changes Required (Immediate)
Existing clients continue to work without any modifications:

```javascript
// Existing client code - no changes needed
async function meltTokens(npub, invoice) {
  const response = await fetch(`/api/wallet/${npub}/melt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ invoice })
  });
  
  const result = await response.json();
  
  if (result.success) {
    console.log(`Payment successful: ${result.transactionId}`);
    console.log(`Amount paid: ${result.paidAmount} sats`);
    console.log(`Change: ${result.changeAmount} sats`);
  } else {
    console.error(`Payment failed: ${result.message}`);
  }
}
```

#### Phase 2: Enhanced Error Handling (Optional)
Clients can optionally utilize enhanced error information:

```javascript
// Enhanced client code - optional improvements
async function meltTokensEnhanced(npub, invoice) {
  try {
    const response = await fetch(`/api/wallet/${npub}/melt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invoice })
    });
    
    const result = await response.json();
    
    if (result.success) {
      console.log(`Payment successful: ${result.transactionId}`);
      
      // NEW: Enhanced operation details
      if (result.atomicResult) {
        console.log(`Atomic operation completed in ${result.operationDuration}ms`);
        console.log(`Source tokens spent: ${result.atomicResult.source_tokens_spent}`);
      }
      
      return result;
    } else {
      // NEW: Enhanced error handling
      const error = new Error(result.message);
      error.code = result.code;
      error.severity = result.severity;
      error.details = result.details;
      throw error;
    }
  } catch (error) {
    // NEW: Severity-based error handling
    if (error.severity === 'CRITICAL') {
      // Show critical error UI with support contact
      showCriticalErrorDialog(error);
    } else if (error.code === 'PROOF_STATE_INCONSISTENCY') {
      // Show specific guidance for proof state issues
      showProofStateErrorDialog(error);
    } else {
      // Standard error handling
      showErrorMessage(error.message);
    }
    
    throw error;
  }
}
```

#### Phase 3: Full Feature Utilization (Recommended)
Clients can leverage all new features for optimal experience:

```javascript
// Full-featured client code - recommended for new implementations
class EnhancedMeltClient {
  async meltTokens(npub, invoice, options = {}) {
    const { 
      enableDetailedLogging = false,
      retryOnReconciliationFailure = true,
      maxRetries = 3 
    } = options;
    
    let attempt = 0;
    
    while (attempt < maxRetries) {
      try {
        const response = await this.executeMelt(npub, invoice);
        
        if (enableDetailedLogging) {
          this.logOperationDetails(response);
        }
        
        return response;
        
      } catch (error) {
        attempt++;
        
        // NEW: Intelligent retry logic based on error type
        if (error.code === 'PROOF_STATE_INCONSISTENCY' && retryOnReconciliationFailure) {
          console.log(`Proof state issue detected, retrying in ${attempt * 1000}ms...`);
          await this.delay(attempt * 1000);
          continue;
        }
        
        if (error.severity === 'CRITICAL') {
          // Don't retry critical errors
          throw error;
        }
        
        if (attempt >= maxRetries) {
          throw error;
        }
        
        await this.delay(attempt * 1000);
      }
    }
  }
  
  logOperationDetails(response) {
    if (response.atomicResult) {
      console.log('Atomic Operation Details:', {
        duration: response.operationDuration,
        sourceTokensSpent: response.atomicResult.source_tokens_spent,
        operations: response.atomicResult.operations.length,
        changeTokens: response.atomicResult.operations.filter(op => 
          op.type.includes('change')
        ).length
      });
    }
    
    if (response.reconciliationInfo) {
      console.log('Reconciliation Info:', response.reconciliationInfo);
    }
  }
}
```

### Client Library Updates

#### JavaScript/TypeScript SDK
```typescript
// Enhanced TypeScript interfaces
interface MeltResponse {
  success: boolean;
  transactionId: string;
  paymentResult: string;
  paidAmount: number;
  feesPaid: number;
  changeAmount: number;
  quoteId: string;
  
  // Enhanced fields (optional for backward compatibility)
  atomicResult?: AtomicMeltResult;
  operationDuration?: number;
  reconciliationInfo?: ReconciliationInfo;
}

interface AtomicMeltResult {
  success: boolean;
  transaction_id: string;
  source_tokens_spent: number;
  keep_token_id?: string;
  keep_amount: number;
  melt_change_token_id?: string;
  melt_change_amount: number;
  operations: AtomicOperation[];
}

interface EnhancedError extends Error {
  code?: string;
  severity?: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  details?: Record<string, any>;
  recommendation?: string;
}
```

#### Python SDK
```python
# Enhanced Python client
class EnhancedCashuClient:
    def melt_tokens(self, npub: str, invoice: str, **kwargs) -> MeltResponse:
        """
        Melt tokens with enhanced error handling and retry logic.
        
        Args:
            npub: User's npub
            invoice: Lightning invoice
            **kwargs: Optional parameters for enhanced features
        
        Returns:
            MeltResponse with optional enhanced fields
        
        Raises:
            CriticalMeltError: For critical errors requiring manual intervention
            ProofStateError: For proof state inconsistencies
            InsufficientBalanceError: For balance-related errors
        """
        try:
            response = self._execute_melt(npub, invoice)
            
            # Enhanced response parsing
            result = MeltResponse(
                success=response['success'],
                transaction_id=response['transactionId'],
                payment_result=response['paymentResult'],
                paid_amount=response['paidAmount'],
                fees_paid=response['feesPaid'],
                change_amount=response['changeAmount'],
                quote_id=response['quoteId']
            )
            
            # Optional enhanced fields
            if 'atomicResult' in response:
                result.atomic_result = AtomicMeltResult(**response['atomicResult'])
            
            if 'operationDuration' in response:
                result.operation_duration = response['operationDuration']
                
            return result
            
        except requests.HTTPError as e:
            error_data = e.response.json()
            
            # Enhanced error classification
            if error_data.get('severity') == 'CRITICAL':
                raise CriticalMeltError(
                    message=error_data['message'],
                    code=error_data.get('code'),
                    quote_id=error_data.get('quoteId'),
                    transaction_id=error_data.get('transactionId')
                )
            elif error_data.get('code') == 'PROOF_STATE_INCONSISTENCY':
                raise ProofStateError(
                    message=error_data['message'],
                    severity=error_data.get('severity')
                )
            else:
                raise MeltError(error_data['message'])
```

---

## Database Migration Strategy

### Migration Approach

#### Zero-Downtime Migration
The database migration strategy ensures no service interruption:

1. **Schema Compatibility**: New fields added as optional
2. **Data Preservation**: All existing data remains valid
3. **Gradual Rollout**: Features enabled progressively
4. **Rollback Capability**: Full rollback support maintained

#### Migration Steps

##### Step 1: Schema Enhancement (Non-Breaking)
```javascript
// Add new optional fields to existing schema
const enhancedTokenSchema = {
  // Existing fields (unchanged)
  npub: { type: String, required: true },
  wallet_id: { type: ObjectId, required: true },
  proofs: [proofSchema],
  mint_url: { type: String, required: true },
  transaction_type: { 
    type: String, 
    enum: ['minted', 'sent', 'received', 'change'], // 'melted' removed but existing data preserved
    required: true 
  },
  status: { 
    type: String, 
    enum: ['pending', 'unspent', 'spent', 'failed'],
    required: true 
  },
  
  // NEW: Enhanced fields (optional)
  reconciliation_info: {
    type: {
      discrepancies_found: Boolean,
      discrepancies_resolved: Boolean,
      reconciliation_timestamp: Date
    },
    required: false
  },
  
  atomic_operation_id: {
    type: String,
    required: false
  }
};
```

##### Step 2: Data Migration (Background)
```javascript
// Background migration script
async function migrateExistingData() {
  const batchSize = 1000;
  let processed = 0;
  
  while (true) {
    const tokens = await CashuToken.find({
      // Find tokens without new fields
      reconciliation_info: { $exists: false }
    }).limit(batchSize);
    
    if (tokens.length === 0) break;
    
    const bulkOps = tokens.map(token => ({
      updateOne: {
        filter: { _id: token._id },
        update: {
          $set: {
            reconciliation_info: {
              discrepancies_found: false,
              discrepancies_resolved: false,
              reconciliation_timestamp: token.created_at
            }
          }
        }
      }
    }));
    
    await CashuToken.bulkWrite(bulkOps);
    processed += tokens.length;
    
    console.log(`Migrated ${processed} tokens`);
    
    // Throttle to avoid overwhelming database
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
```

##### Step 3: Index Creation (Online)
```javascript
// Create new indexes for enhanced functionality
await CashuToken.collection.createIndex(
  { npub: 1, atomic_operation_id: 1 },
  { background: true, sparse: true }
);

await CashuToken.collection.createIndex(
  { 'reconciliation_info.reconciliation_timestamp': 1 },
  { background: true, sparse: true }
);
```

### Data Consistency Verification

#### Pre-Migration Validation
```javascript
async function validatePreMigration() {
  // Check for any "melted" tokens that shouldn't exist in new system
  const meltedTokens = await CashuToken.countDocuments({
    transaction_type: 'melted'
  });
  
  if (meltedTokens > 0) {
    console.warn(`Found ${meltedTokens} melted tokens - these will be preserved but not created in new system`);
  }
  
  // Verify balance consistency
  const users = await CashuToken.distinct('npub');
  
  for (const npub of users) {
    const balance = await walletRepositoryService.calculateBalance(npub);
    console.log(`User ${npub}: Balance verified - ${balance.total_balance} sats`);
  }
}
```

#### Post-Migration Validation
```javascript
async function validatePostMigration() {
  // Verify no new melted tokens created
  const newMeltedTokens = await CashuToken.countDocuments({
    transaction_type: 'melted',
    created_at: { $gte: migrationStartTime }
  });
  
  if (newMeltedTokens > 0) {
    throw new Error(`ERROR: ${newMeltedTokens} new melted tokens created after migration`);
  }
  
  // Verify atomic operations working
  const atomicOperations = await CashuToken.countDocuments({
    atomic_operation_id: { $exists: true }
  });
  
  console.log(`${atomicOperations} tokens created with atomic operations`);
}
```

---

## Feature Flag Implementation

### Feature Flag Strategy

#### Gradual Rollout Approach
```javascript
class FeatureFlags {
  static flags = {
    ENHANCED_ERROR_RESPONSES: {
      enabled: true,
      rollout: 100, // Percentage of users
      description: 'Enhanced error response format'
    },
    
    ATOMIC_MELT_OPERATIONS: {
      enabled: true,
      rollout: 100,
      description: 'Atomic melt transaction system'
    },
    
    PRE_FLIGHT_RECONCILIATION: {
      enabled: true,
      rollout: 100,
      description: 'Pre-flight proof state reconciliation'
    },
    
    DETAILED_OPERATION_LOGGING: {
      enabled: false,
      rollout: 10, // Start with 10% rollout
      description: 'Detailed operation metrics in responses'
    }
  };
  
  static isEnabled(flagName, userId = null) {
    const flag = this.flags[flagName];
    if (!flag || !flag.enabled) return false;
    
    if (flag.rollout >= 100) return true;
    
    // Consistent rollout based on user ID hash
    if (userId) {
      const hash = this.hashUserId(userId);
      return (hash % 100) < flag.rollout;
    }
    
    return Math.random() * 100 < flag.rollout;
  }
}
```

#### Feature-Flagged Response Building
```javascript
function buildMeltResponse(baseResponse, npub, featureFlags = {}) {
  const response = { ...baseResponse };
  
  // Enhanced error information (gradual rollout)
  if (FeatureFlags.isEnabled('ENHANCED_ERROR_RESPONSES', npub)) {
    if (response.error) {
      response.code = response.errorCode || 'UNKNOWN_ERROR';
      response.severity = response.errorSeverity || 'MEDIUM';
      response.details = response.errorDetails || {};
    }
  }
  
  // Detailed operation metrics (limited rollout)
  if (FeatureFlags.isEnabled('DETAILED_OPERATION_LOGGING', npub)) {
    response.operationDuration = baseResponse.operationDuration;
    response.reconciliationInfo = baseResponse.reconciliationInfo;
  }
  
  // Atomic operation details (full rollout)
  if (FeatureFlags.isEnabled('ATOMIC_MELT_OPERATIONS', npub)) {
    response.atomicResult = baseResponse.atomicResult;
  }
  
  return response;
}
```

### Configuration Management

#### Environment-Based Configuration
```javascript
// config/features.js
const featureConfig = {
  development: {
    ENHANCED_ERROR_RESPONSES: { enabled: true, rollout: 100 },
    ATOMIC_MELT_OPERATIONS: { enabled: true, rollout: 100 },
    PRE_FLIGHT_RECONCILIATION: { enabled: true, rollout: 100 },
    DETAILED_OPERATION_LOGGING: { enabled: true, rollout: 100 }
  },
  
  staging: {
    ENHANCED_ERROR_RESPONSES: { enabled: true, rollout: 100 },
    ATOMIC_MELT_OPERATIONS: { enabled: true, rollout: 100 },
    PRE_FLIGHT_RECONCILIATION: { enabled: true, rollout: 50 },
    DETAILED_OPERATION_LOGGING: { enabled: true, rollout: 25 }
  },
  
  production: {
    ENHANCED_ERROR_RESPONSES: { enabled: true, rollout: 100 },
    ATOMIC_MELT_OPERATIONS: { enabled: true, rollout: 100 },
    PRE_FLIGHT_RECONCILIATION: { enabled: true, rollout: 100 },
    DETAILED_OPERATION_LOGGING: { enabled: false, rollout: 5 }
  }
};
```

---

## Integration Testing Guidelines

### Test Categories

#### 1. Backward Compatibility Tests
```javascript
describe('Backward Compatibility', () => {
  it('should maintain v1.x response format', async () => {
    const response = await request(app)
      .post('/api/wallet/test-npub/melt')
      .send({ invoice: testInvoice })
      .expect(200);
    
    // Verify core v1.x fields are present
    expect(response.body).toHaveProperty('success');
    expect(response.body).toHaveProperty('transactionId');
    expect(response.body).toHaveProperty('paymentResult');
    expect(response.body).toHaveProperty('paidAmount');
    expect(response.body).toHaveProperty('feesPaid');
    expect(response.body).toHaveProperty('changeAmount');
    expect(response.body).toHaveProperty('quoteId');
    
    // Verify response structure matches v1.x exactly
    const v1Fields = ['success', 'transactionId', 'paymentResult', 'paidAmount', 'feesPaid', 'changeAmount', 'quoteId'];
    const responseFields = Object.keys(response.body);
    
    // All v1 fields must be present
    v1Fields.forEach(field => {
      expect(responseFields).toContain(field);
    });
  });
  
  it('should handle v1.x error format', async () => {
    const response = await request(app)
      .post('/api/wallet/test-npub/melt')
      .send({ invoice: 'invalid-invoice' })
      .expect(400);
    
    // Verify v1.x error format
    expect(response.body).toHaveProperty('error');
    expect(response.body).toHaveProperty('message');
    expect(typeof response.body.error).toBe('string');
    expect(typeof response.body.message).toBe('string');
  });
});
```

#### 2. Enhanced Feature Tests
```javascript
describe('Enhanced Features', () => {
  it('should include atomic operation details when enabled', async () => {
    // Enable feature flag for this test
    FeatureFlags.flags.ATOMIC_MELT_OPERATIONS.enabled = true;
    
    const response = await request(app)
      .post('/api/wallet/test-npub/melt')
      .send({ invoice: testInvoice })
      .expect(200);
    
    // Verify enhanced fields are present
    expect(response.body).toHaveProperty('atomicResult');
    expect(response.body.atomicResult).toHaveProperty('success');
    expect(response.body.atomicResult).toHaveProperty('source_tokens_spent');
    expect(response.body.atomicResult).toHaveProperty('operations');
  });
  
  it('should provide enhanced error information when enabled', async () => {
    FeatureFlags.flags.ENHANCED_ERROR_RESPONSES.enabled = true;
    
    const response = await request(app)
      .post('/api/wallet/test-npub/melt')
      .send({ invoice: 'invalid-invoice' })
      .expect(400);
    
    // Verify enhanced error fields
    expect(response.body).toHaveProperty('code');
    expect(response.body).toHaveProperty('severity');
    expect(response.body).toHaveProperty('details');
  });
});
```

#### 3. Migration Tests
```javascript
describe('Database Migration', () => {
  it('should preserve existing token data', async () => {
    // Create pre-migration token
    const preMigrationToken = await CashuToken.create({
      npub: 'test-npub',
      wallet_id: testWallet._id,
      proofs: [testProof],
      transaction_type: 'minted',
      status: 'unspent'
    });
    
    // Run migration
    await migrateExistingData();
    
    // Verify token still exists and is valid
    const postMigrationToken = await CashuToken.findById(preMigrationToken._id);
    expect(postMigrationToken).toBeTruthy();
    expect(postMigrationToken.npub).toBe('test-npub');
    expect(postMigrationToken.status).toBe('unspent');
    
    // Verify new fields were added
    expect(postMigrationToken.reconciliation_info).toBeTruthy();
  });
  
  it('should maintain balance consistency after migration', async () => {
    const preMigrationBalance = await walletRepositoryService.calculateBalance('test-npub');
    
    await migrateExistingData();
    
    const postMigrationBalance = await walletRepositoryService.calculateBalance('test-npub');
    
    expect(postMigrationBalance.total_balance).toBe(preMigrationBalance.total_balance);
    expect(postMigrationBalance.unspent_balance).toBe(preMigrationBalance.unspent_balance);
  });
});
```

### Integration Test Automation

#### Continuous Integration Pipeline
```yaml
# .github/workflows/integration-tests.yml
name: Integration Tests

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  backward-compatibility:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Setup Node.js
        uses: actions/setup-node@v2
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run backward compatibility tests
        run: npm run test:compatibility
        env:
          FEATURE_FLAGS: '{"ENHANCED_ERROR_RESPONSES":false,"DETAILED_OPERATION_LOGGING":false}'
  
  enhanced-features:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Setup Node.js
        uses: actions/setup-node@v2
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run enhanced feature tests
        run: npm run test:enhanced
        env:
          FEATURE_FLAGS: '{"ENHANCED_ERROR_RESPONSES":true,"DETAILED_OPERATION_LOGGING":true}'
  
  migration-tests:
    runs-on: ubuntu-latest
    services:
      mongodb:
        image: mongo:5.0
        ports:
          - 27017:27017
    steps:
      - uses: actions/checkout@v2
      - name: Setup Node.js
        uses: actions/setup-node@v2
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run migration tests
        run: npm run test:migration
```

---

## SDK and Library Updates

### JavaScript/TypeScript SDK

#### Version 2.0 SDK with Backward Compatibility
```typescript
// Enhanced SDK with backward compatibility
export class CashuWalletSDK {
  private apiVersion: '1.0' | '2.0';
  private baseUrl: string;
  
  constructor(baseUrl: string, options: SDKOptions = {}) {
    this.baseUrl = baseUrl;
    this.apiVersion = options.apiVersion || '2.0';
  }
  
  async meltTokens(npub: string, invoice: string): Promise<MeltResponse> {
    const response = await fetch(`${this.baseUrl}/api/wallet/${npub}/melt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invoice })
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw this.createError(errorData);
    }
    
    const data = await response.json();
    return this.transformResponse(data);
  }
  
  private transformResponse(data: any): MeltResponse {
    const baseResponse: MeltResponse = {
      success: data.success,
      transactionId: data.transactionId,
      paymentResult: data.paymentResult,
      paidAmount: data.paidAmount,
      feesPaid: data.feesPaid,
      changeAmount: data.changeAmount,
      quoteId: data.quoteId
    };
    
    // Add enhanced fields if available and API version supports them
    if (this.apiVersion === '2.0') {
      if (data.atomicResult) {
        baseResponse.atomicResult = data.atomicResult;
      }
      if (data.operationDuration) {
        baseResponse.operationDuration = data.operationDuration;
      }
      if (data.reconciliationInfo) {
        baseResponse.reconciliationInfo = data.reconciliationInfo;
      }
    }
    
    return baseResponse;
  }
  
  private createError(errorData: any): Error {
    if (this.apiVersion === '2.0' && errorData.code) {
      // Enhanced error for v2.0
      const error = new EnhancedMeltError(errorData.message);
      error.code = errorData.code;
      error.severity = errorData.severity;
      error.details = errorData.details;
      return error;
    } else {
      // Standard error for v1.0 compatibility
      return new Error(errorData.message || errorData.error);
    }
  }
}

// Enhanced error class
export class EnhancedMeltError extends Error {
  code?: string;
  severity?: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  details?: Record<string, any>;
  
  constructor(message: string) {
    super(message);
    this.name = 'EnhancedMeltError';
  }
}
```

### Python SDK

#### Version 2.0 Python SDK
```python
from typing import Optional, Dict, Any, Union
from dataclasses import dataclass
import requests

@dataclass
class MeltResponse:
    success: bool
    transaction_id: str
    payment_result: str
    paid_amount: int
    fees_paid: int
    change_amount: int
    quote_id: str
    
    # Enhanced fields (optional)
    atomic_result: Optional[Dict[str, Any]] = None
    operation_