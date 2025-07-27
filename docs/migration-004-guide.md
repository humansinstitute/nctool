# Migration 004: Fix Melted Token Status

## Overview

This migration fixes a critical accounting bug where Lightning payments (melted tokens) were incorrectly marked with `status: "unspent"` instead of `status: "spent"`. This caused balance calculation errors and incorrect wallet balances for users.

## Problem Description

**Bug**: Melted tokens (Lightning payments) have `status: "unspent"` instead of `status: "spent"`
**Impact**: Incorrect balance calculations, users see inflated balances
**Root Cause**: Phase 1 fixed the core bug, but historical data remains corrupted

## Migration Components

### 1. Migration Script (`src/migrations/004_fix_melted_token_status.js`)

Core migration logic with:

- **UP function**: Updates melted tokens from "unspent" to "spent" status
- **DOWN function**: Rollback capability using backup data
- **Atomic transactions**: All changes in MongoDB sessions
- **Comprehensive backup**: Full state preservation for rollback
- **Validation**: Prerequisites and post-migration checks

### 2. CLI Tool (`src/scripts/run-migration.js`)

Command-line interface for safe migration execution:

- **Status checking**: Current migration state and system health
- **Preview mode**: Impact analysis without execution
- **Confirmation prompts**: Safety measures for production
- **Progress tracking**: Real-time execution monitoring
- **Rollback support**: Safe restoration of original state

### 3. Admin API (`src/routes/admin.routes.js`)

HTTP endpoints for monitoring and management:

- `GET /admin/migration/status` - Migration status and health
- `GET /admin/migration/preview` - Detailed impact analysis
- `GET /admin/health/balance-consistency` - User balance validation
- `GET /admin/health/token-integrity` - Data integrity checks
- `POST /admin/migration/validate` - Prerequisites validation

### 4. Monitoring Service (`src/services/migrationMonitoring.service.js`)

Real-time monitoring and alerting:

- **Continuous monitoring**: Automated health checks
- **Alert generation**: Proactive issue detection
- **Balance validation**: User-by-user consistency checks
- **Data integrity**: Duplicate secrets, orphaned tokens
- **System health**: Database, indexes, performance

### 5. Integration Tests (`tests/integration/migration.test.js`)

Comprehensive test coverage:

- **Migration execution**: UP/DOWN operations
- **Error handling**: Rollback scenarios
- **Edge cases**: Large datasets, corrupted data
- **Atomicity**: Transaction integrity
- **Performance**: Execution time validation

## Usage Guide

### Prerequisites

1. **Database Backup**: Create full backup before migration
2. **Maintenance Window**: Schedule during low-traffic period
3. **Monitoring Setup**: Ensure logging and alerting active
4. **Dependencies**: Install CLI dependencies

```bash
npm install
```

### Step 1: Check Migration Status

```bash
npm run migration:status
```

This shows:

- Current migration state
- Number of problematic tokens
- System health metrics
- Migration readiness

### Step 2: Preview Migration Impact

```bash
npm run migration:preview
```

This displays:

- Tokens to be migrated
- Affected users and amounts
- Estimated execution time
- Risk assessment

### Step 3: Validate Prerequisites

```bash
curl -X POST http://localhost:3000/admin/migration/validate
```

Checks:

- Database connectivity
- Migration state
- System resources
- Risk factors

### Step 4: Execute Migration

```bash
npm run migration:up
```

**Safety Features**:

- Requires `--confirm` flag
- Interactive confirmation prompt
- Atomic transaction execution
- Automatic backup creation
- Real-time progress tracking

### Step 5: Verify Results

```bash
npm run migration:status
```

Confirms:

- Migration completion
- Affected token count
- Execution time
- System health

### Rollback (if needed)

```bash
npm run migration:down
```

**Rollback Process**:

- Restores original token status
- Uses backup data for accuracy
- Atomic transaction execution
- Verification of restoration

## API Endpoints

### Migration Status

```http
GET /admin/migration/status
```

Response:

```json
{
  "success": true,
  "data": {
    "timestamp": "2025-01-27T02:40:00.000Z",
    "migration": {
      "isCompleted": false,
      "migrationNeeded": true,
      "problematicTokens": 150,
      "totalMeltedTokens": 500
    },
    "health": {
      "totalTokens": 10000,
      "healthScore": 0.7
    },
    "recommendations": [
      {
        "type": "action",
        "priority": "high",
        "message": "150 melted tokens need migration"
      }
    ]
  }
}
```

### Migration Preview

```http
GET /admin/migration/preview
```

Response:

```json
{
  "success": true,
  "data": {
    "migration_name": "004_fix_melted_token_status",
    "stats": {
      "tokensToMigrate": 150,
      "totalAmountAffected": 75000,
      "estimatedExecutionTime": "2 seconds"
    },
    "userImpact": {
      "npub1...": {
        "tokenCount": 5,
        "totalAmount": 5000
      }
    }
  }
}
```

### Balance Consistency Check

```http
GET /admin/health/balance-consistency?limit=100&offset=0
```

Response:

```json
{
  "success": true,
  "data": {
    "totalUsers": 1000,
    "checkedUsers": 100,
    "issues": [
      {
        "npub": "npub1...",
        "issues": {
          "problematicMeltedTokens": 3
        }
      }
    ],
    "summary": {
      "usersWithIssues": 25,
      "totalProblematicTokens": 150
    }
  }
}
```

## Monitoring and Alerting

### Real-time Monitoring

```javascript
import migrationMonitoringService from "./src/services/migrationMonitoring.service.js";

// Start continuous monitoring
migrationMonitoringService.startMonitoring(60000); // 1 minute intervals

// Get current health status
const health = await migrationMonitoringService.performHealthCheck();
```

### Alert Types

1. **High Priority**:

   - Large number of problematic tokens (>10)
   - Duplicate proof secrets detected
   - System health degraded

2. **Medium Priority**:

   - Balance inconsistencies detected
   - Orphaned tokens found
   - Long execution times

3. **Low Priority**:
   - Migration completed successfully
   - System health optimal

## Safety Measures

### 1. Atomic Transactions

- All changes in MongoDB sessions
- Automatic rollback on errors
- Data consistency guaranteed

### 2. Comprehensive Backup

- Full token state preservation
- Metadata and timestamps included
- Rollback capability maintained

### 3. Validation Checks

- Prerequisites verification
- Post-migration validation
- Data integrity confirmation

### 4. Error Handling

- Graceful failure recovery
- Detailed error logging
- State tracking maintenance

### 5. Monitoring Integration

- Real-time progress tracking
- Alert generation
- Performance metrics

## Performance Considerations

### Execution Time

- ~100 tokens per second
- Scales linearly with dataset size
- Optimized database queries

### Resource Usage

- Minimal memory footprint
- Efficient MongoDB operations
- Index utilization

### Scalability

- Handles large datasets (>100k tokens)
- Concurrent access protection
- Performance monitoring

## Troubleshooting

### Common Issues

1. **Migration Already Completed**

   ```
   Error: Migration has already been completed
   ```

   **Solution**: Check status, use rollback if re-execution needed

2. **Database Connection Failed**

   ```
   Error: Database connection not ready
   ```

   **Solution**: Verify MongoDB connectivity and credentials

3. **Insufficient Permissions**

   ```
   Error: Permission denied
   ```

   **Solution**: Ensure database user has read/write permissions

4. **Backup Data Missing**
   ```
   Error: No backup data found - cannot rollback safely
   ```
   **Solution**: Migration state corrupted, manual intervention required

### Recovery Procedures

1. **Failed Migration**:

   - Check error logs
   - Verify database state
   - Use rollback if partial execution
   - Contact support for manual recovery

2. **Corrupted State**:

   - Restore from database backup
   - Re-run migration from clean state
   - Validate data integrity

3. **Performance Issues**:
   - Monitor system resources
   - Check database performance
   - Consider maintenance window

## Testing

### Unit Tests

```bash
npm run test:unit
```

### Integration Tests

```bash
npm run test:migration
```

### Full Test Suite

```bash
npm test
```

## Production Deployment

### Pre-deployment Checklist

- [ ] Database backup completed
- [ ] Maintenance window scheduled
- [ ] Monitoring systems active
- [ ] Team notifications sent
- [ ] Rollback plan documented

### Deployment Steps

1. Deploy migration code
2. Verify system health
3. Execute migration preview
4. Validate prerequisites
5. Execute migration
6. Verify completion
7. Monitor system health

### Post-deployment Verification

- [ ] Migration status confirmed
- [ ] Balance calculations correct
- [ ] User functionality verified
- [ ] Performance metrics normal
- [ ] No error alerts generated

## Support and Maintenance

### Monitoring Dashboard

- Migration status tracking
- System health metrics
- Alert management
- Performance analytics

### Log Analysis

- Migration execution logs
- Error tracking
- Performance metrics
- User impact analysis

### Maintenance Tasks

- Regular health checks
- Performance monitoring
- Data integrity validation
- Alert threshold tuning

## Conclusion

Migration 004 provides a comprehensive, safe, and monitored solution for fixing the melted token status bug. The system includes:

- **Robust migration logic** with atomic transactions
- **Comprehensive safety measures** including backup and rollback
- **Real-time monitoring** and alerting
- **Production-ready tooling** for safe execution
- **Extensive testing** for reliability assurance

The migration system is designed for production use with enterprise-grade safety, monitoring, and recovery capabilities.
