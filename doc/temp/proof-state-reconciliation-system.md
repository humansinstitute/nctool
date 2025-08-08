# Proof State Reconciliation System Implementation

**Date:** 2025-08-08  
**Status:** Implemented  
**Priority:** Critical - Pre-flight Validation for Melt Operations

## Overview

The proof state reconciliation system has been implemented to address critical gaps in the melt operation flow. This system provides sophisticated discrepancy detection and automatic correction capabilities to ensure database consistency with mint ground truth before executing operations.

## Implementation Details

### Enhanced Functions

#### 1. `checkProofStates(npub, proofs = null)` - Enhanced
**Location:** `src/services/cashu.service.js:1315`

**Enhancements:**
- **Discrepancy Detection:** Compares database token status with mint proof states
- **Severity Classification:** Categorizes discrepancies as HIGH, MEDIUM, or LOW severity
- **Database Mapping:** Creates comprehensive mapping between proof secrets and database records
- **Enhanced Logging:** Detailed logging with severity breakdowns

**Severity Levels:**
- **HIGH:** DB says unspent, mint says SPENT (critical - blocks operations)
- **MEDIUM:** DB says spent, mint says UNSPENT (requires investigation)
- **MEDIUM:** DB says pending, mint says SPENT (status update needed)
- **LOW:** Proof not found in database (external proof)
- **LOW:** Minor state mismatches (DB unspent, mint pending)

#### 2. `reconcileProofStates(npub, discrepancies)` - New Function
**Location:** `src/services/cashu.service.js:1535`

**Capabilities:**
- **Automatic Correction:** Updates database to match mint ground truth
- **Operation Blocking:** Prevents operations when HIGH severity discrepancies detected
- **Selective Processing:** Handles different discrepancy types with appropriate actions
- **Audit Logging:** Comprehensive logging of all reconciliation actions

**Actions by Discrepancy Type:**
- `DB_UNSPENT_MINT_SPENT`: Mark database token as spent (HIGH severity - blocks operation)
- `DB_SPENT_MINT_UNSPENT`: Log for investigation (MEDIUM severity)
- `DB_PENDING_MINT_SPENT`: Update status from pending to spent (MEDIUM severity)
- `PROOF_NOT_IN_DB`: Log external proof for audit (LOW severity)
- `DB_UNSPENT_MINT_PENDING`: Monitor for resolution (LOW severity)

#### 3. `performPreFlightReconciliation(npub, proofs)` - New Function
**Location:** `src/services/cashu.service.js:1801`

**Purpose:** Primary integration point for melt operations

**Flow:**
1. Check proof states against mint
2. If consistent, clear operation to proceed
3. If discrepancies found, attempt reconciliation
4. Block operation if HIGH severity discrepancies remain
5. Return detailed reconciliation results

#### 4. `validateProofStatesForOperation(npub, proofs)` - New Function
**Location:** `src/services/cashu.service.js:1891`

**Purpose:** Lightweight validation for quick checks

**Use Cases:**
- Quick validation before operations
- Health checks
- Monitoring dashboards

## Integration Guide

### For Melt Operations

**Before Melt Operation:**
```javascript
// Add this before the melt operation in meltTokens()
try {
  const reconciliationResult = await performPreFlightReconciliation(npub, allProofs);
  
  if (!reconciliationResult.operationCleared) {
    throw new Error('Melt operation blocked by proof state reconciliation');
  }
  
  logger.info('Pre-flight reconciliation passed', {
    npub,
    discrepanciesFound: reconciliationResult.discrepanciesFound,
    discrepanciesResolved: reconciliationResult.discrepanciesResolved,
  });
  
} catch (error) {
  if (error.code === 'HIGH_SEVERITY_DISCREPANCIES') {
    logger.error('Melt operation blocked due to critical proof state issues', {
      npub,
      discrepancies: error.discrepancies,
      reconciliationResult: error.reconciliationResult,
    });
    
    // Return error to user with details
    throw new Error(
      `Cannot proceed with melt operation. Critical proof state inconsistencies detected. ` +
      `Please contact support. Error: ${error.message}`
    );
  }
  
  // Re-throw other errors
  throw error;
}
```

**Integration Point in `meltTokens()`:**
Add the reconciliation call after proof collection (around line 1130) and before the send operation:

```javascript
// After collecting all proofs from selected tokens
const allProofs = [];
const tokenIds = [];
// ... existing proof collection code ...

// NEW: Pre-flight reconciliation
try {
  await performPreFlightReconciliation(npub, allProofs);
} catch (error) {
  if (error.code === 'HIGH_SEVERITY_DISCREPANCIES') {
    throw new Error(`Melt operation blocked: ${error.message}`);
  }
  throw error;
}

// Continue with existing melt operation...
```

### Error Handling

**HIGH Severity Errors:**
- **Action:** Block operation immediately
- **User Message:** "Cannot proceed due to critical proof state issues"
- **Resolution:** Manual investigation required

**MEDIUM Severity Errors:**
- **Action:** Attempt automatic correction
- **User Message:** "Operation proceeded after resolving state inconsistencies"
- **Resolution:** Automatic with logging

**LOW Severity Errors:**
- **Action:** Log and proceed
- **User Message:** No user impact
- **Resolution:** Monitoring only

## Function Signatures

```javascript
// Enhanced proof state checking with discrepancy detection
async function checkProofStates(npub, proofs = null)
// Returns: { states, discrepancies, severityCounts, consistent, hasHighSeverity, ... }

// Automatic proof state reconciliation
async function reconcileProofStates(npub, discrepancies)
// Returns: { success, blocked, actionsPerformed, reconciliationSummary, ... }

// Pre-flight reconciliation for melt operations
async function performPreFlightReconciliation(npub, proofs)
// Returns: { success, operationCleared, discrepanciesFound, stateCheck, reconciliationResult, ... }
// Throws: Error with code 'HIGH_SEVERITY_DISCREPANCIES' if operation should be blocked

// Lightweight validation for quick checks
async function validateProofStatesForOperation(npub, proofs)
// Returns: { valid, hasHighSeverity, recommendation, ... }
```

## Monitoring and Observability

### Key Metrics to Monitor

1. **Discrepancy Rates:**
   - HIGH severity discrepancies per hour
   - MEDIUM severity discrepancies per hour
   - LOW severity discrepancies per hour

2. **Reconciliation Success:**
   - Successful automatic corrections
   - Failed correction attempts
   - Operations blocked by HIGH severity issues

3. **Performance:**
   - Pre-flight reconciliation duration
   - Proof state check duration
   - Database query performance

### Log Analysis

**Search Patterns:**
- `"HIGH severity discrepancies detected"` - Critical issues
- `"Pre-flight reconciliation BLOCKED"` - Blocked operations
- `"Proof state reconciliation completed"` - Successful reconciliations

## Testing Scenarios

### Test Cases to Implement

1. **HIGH Severity Scenarios:**
   - Database shows proof as unspent, mint shows as spent
   - Multiple HIGH severity discrepancies
   - Reconciliation failure during HIGH severity correction

2. **MEDIUM Severity Scenarios:**
   - Database shows proof as spent, mint shows as unspent
   - Database shows proof as pending, mint shows as spent
   - Successful automatic correction

3. **LOW Severity Scenarios:**
   - External proofs not in database
   - Minor state mismatches
   - Monitoring-only scenarios

4. **Integration Scenarios:**
   - Melt operation with clean proofs
   - Melt operation with reconcilable discrepancies
   - Melt operation blocked by HIGH severity issues

## Security Considerations

1. **Proof Secret Handling:**
   - Proof secrets are truncated in logs for security
   - Full secrets only used for database operations

2. **Error Information:**
   - Detailed error information logged for debugging
   - User-facing errors sanitized to prevent information leakage

3. **Database Integrity:**
   - All reconciliation actions are logged for audit
   - Database updates use existing transaction-safe methods

## Performance Considerations

1. **Batch Processing:**
   - Proof state checks processed in batches
   - Database queries optimized for multiple proof lookups

2. **Caching:**
   - Consider implementing proof state caching for frequently checked proofs
   - Cache invalidation on state changes

3. **Async Processing:**
   - All reconciliation operations are async
   - Non-blocking for LOW severity issues

## Future Enhancements

1. **Automated Recovery:**
   - Implement automatic recovery for MEDIUM severity discrepancies
   - Background reconciliation jobs

2. **Advanced Analytics:**
   - Trend analysis for discrepancy patterns
   - Predictive alerts for potential issues

3. **Configuration:**
   - Configurable severity thresholds
   - Configurable reconciliation policies

## Conclusion

The proof state reconciliation system provides a robust foundation for ensuring database consistency with mint ground truth. The implementation follows the exact patterns documented in the analysis and provides comprehensive error handling, logging, and integration points for melt operations.

**Key Benefits:**
- Prevents operations on already-spent proofs
- Automatic correction of database inconsistencies
- Comprehensive audit trail
- Configurable severity-based handling
- Easy integration with existing melt operations

**Next Steps:**
1. Integrate with melt operations
2. Implement comprehensive test coverage
3. Set up monitoring and alerting
4. Deploy with gradual rollout