# API Technical Specifications

**Date:** 2025-08-08  
**Status:** Production Ready  
**Version:** 2.0  
**Priority:** Critical - API Reference

## Executive Summary

This document provides comprehensive technical specifications for the updated melt operation API interfaces. It includes detailed endpoint documentation, request/response schemas, error codes, authentication requirements, and integration examples for both existing and enhanced clients.

## Table of Contents

1. [API Overview](#api-overview)
2. [Authentication and Authorization](#authentication-and-authorization)
3. [Melt Operation Endpoints](#melt-operation-endpoints)
4. [Request/Response Schemas](#requestresponse-schemas)
5. [Error Codes and Handling](#error-codes-and-handling)
6. [Rate Limiting and Throttling](#rate-limiting-and-throttling)
7. [Webhook Integration](#webhook-integration)
8. [API Versioning Strategy](#api-versioning-strategy)
9. [OpenAPI Specification](#openapi-specification)
10. [Client Examples](#client-examples)

---

## API Overview

### Base Information

**Base URL**: `https://api.example.com`  
**API Version**: `2.0`  
**Protocol**: HTTPS only  
**Content Type**: `application/json`  
**Character Encoding**: UTF-8

### Supported Operations

| Operation | Endpoint | Method | Description |
|-----------|----------|--------|-------------|
| Melt Tokens | `/api/wallet/{npub}/melt` | POST | Execute Lightning payment with tokens |
| Check Proof States | `/api/wallet/{npub}/proofs/status` | GET | Verify proof states with mint |
| Get Balance | `/api/wallet/{npub}/balance` | GET | Retrieve wallet balance |
| Transaction History | `/api/wallet/{npub}/transactions` | GET | Get transaction history |
| System Health | `/api/wallet/system/health` | GET | Check system status |

### API Capabilities

#### Core Features
- **Atomic Transactions**: All operations use ACID-compliant database transactions
- **Pre-flight Validation**: Proof state reconciliation before operations
- **Enhanced Error Handling**: Severity-based error classification
- **Backward Compatibility**: Full compatibility with v1.x clients
- **Real-time Monitoring**: Comprehensive operation tracking

#### Enhanced Features (v2.0)
- **Detailed Operation Metrics**: Performance and timing information
- **Atomic Operation Results**: Complete transaction breakdown
- **Reconciliation Information**: Proof state validation details
- **Enhanced Error Context**: Detailed error information with recovery guidance

---

## Authentication and Authorization

### Authentication Methods

#### 1. NPUB-Based Authentication
```http
POST /api/wallet/{npub}/melt
Authorization: Bearer {jwt_token}
Content-Type: application/json
```

**JWT Token Structure:**
```json
{
  "sub": "npub1...",
  "iat": 1691234567,
  "exp": 1691238167,
  "scope": ["wallet:read", "wallet:melt"]
}
```

#### 2. API Key Authentication
```http
POST /api/wallet/{npub}/melt
X-API-Key: {api_key}
Content-Type: application/json
```

### Authorization Scopes

| Scope | Description | Required For |
|-------|-------------|--------------|
| `wallet:read` | Read wallet information | Balance, history, proof states |
| `wallet:melt` | Execute melt operations | Melt tokens, Lightning payments |
| `wallet:send` | Send tokens to others | P2P token transfers |
| `wallet:receive` | Receive tokens | Accept incoming tokens |
| `system:health` | System monitoring | Health checks, diagnostics |

### Security Requirements

#### Request Security
- **HTTPS Only**: All requests must use TLS 1.2 or higher
- **Request Signing**: Optional HMAC-SHA256 request signing
- **Rate Limiting**: Per-user and per-endpoint limits
- **Input Validation**: Comprehensive request validation

#### Response Security
- **No Sensitive Data**: Proof secrets truncated in logs
- **Error Sanitization**: User-facing errors sanitized
- **Audit Logging**: Complete operation audit trail
- **CORS Configuration**: Restricted cross-origin access

---

## Melt Operation Endpoints

### POST /api/wallet/{npub}/melt

Execute a Lightning payment using Cashu tokens.

#### Request

**URL Parameters:**
- `npub` (string, required): User's Nostr public key in npub format

**Headers:**
```http
Content-Type: application/json
Authorization: Bearer {jwt_token}
X-Request-ID: {unique_request_id} (optional)
```

**Request Body:**
```json
{
  "invoice": "lnbc1000n1pjqxqzjsp5...",
  "options": {
    "max_fee_percent": 1.0,
    "timeout_seconds": 30,
    "enable_reconciliation": true
  }
}
```

**Request Schema:**
```typescript
interface MeltRequest {
  invoice: string;                    // Lightning invoice (required)
  options?: {
    max_fee_percent?: number;         // Maximum fee percentage (default: 2.0)
    timeout_seconds?: number;         // Operation timeout (default: 30)
    enable_reconciliation?: boolean;  // Enable pre-flight reconciliation (default: true)
  };
}
```

#### Response

**Success Response (200 OK):**
```json
{
  "success": true,
  "transactionId": "tx_melt_1691234567_abc123",
  "paymentResult": "PAID",
  "paidAmount": 1000,
  "feesPaid": 50,
  "changeAmount": 150,
  "quoteId": "quote_789",
  
  // Enhanced fields (v2.0)
  "atomicResult": {
    "success": true,
    "transaction_id": "tx_melt_1691234567_abc123",
    "source_tokens_spent": 2,
    "keep_token_id": "64f1a2b3c4d5e6f7g8h9i0j1",
    "keep_amount": 100,
    "melt_change_token_id": "64f1a2b3c4d5e6f7g8h9i0j2",
    "melt_change_amount": 50,
    "operations": [
      {
        "type": "keep_change",
        "token_id": "64f1a2b3c4d5e6f7g8h9i0j1",
        "amount": 100,
        "proof_count": 1
      },
      {
        "type": "melt_change",
        "token_id": "64f1a2b3c4d5e6f7g8h9i0j2",
        "amount": 50,
        "proof_count": 1
      }
    ]
  },
  "operationDuration": 2500,
  "reconciliationInfo": {
    "discrepanciesFound": false,
    "discrepanciesResolved": false,
    "reconciliationDuration": 150
  },
  "metadata": {
    "mintUrl": "https://mint.minibits.cash/Bitcoin",
    "timestamp": "2025-08-08T01:00:00.000Z",
    "apiVersion": "2.0"
  }
}
```

**Response Schema:**
```typescript
interface MeltResponse {
  // Core fields (v1.x compatible)
  success: boolean;
  transactionId: string;
  paymentResult: 'PAID' | 'PENDING' | 'FAILED';
  paidAmount: number;
  feesPaid: number;
  changeAmount: number;
  quoteId: string;
  
  // Enhanced fields (v2.0)
  atomicResult?: AtomicMeltResult;
  operationDuration?: number;
  reconciliationInfo?: ReconciliationInfo;
  metadata?: ResponseMetadata;
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

interface AtomicOperation {
  type: 'keep_change' | 'melt_change';
  token_id: string;
  amount: number;
  proof_count: number;
}

interface ReconciliationInfo {
  discrepanciesFound: boolean;
  discrepanciesResolved: boolean;
  reconciliationDuration: number;
}
```

#### Error Responses

**Validation Error (400 Bad Request):**
```json
{
  "error": "Validation failed",
  "message": "Invalid Lightning invoice format",
  "code": "INVALID_INVOICE",
  "severity": "HIGH",
  "details": {
    "field": "invoice",
    "provided": "invalid_invoice_format",
    "expected": "Lightning invoice starting with 'lnbc'"
  },
  "recommendation": "Please provide a valid Lightning invoice"
}
```

**Proof State Error (400 Bad Request):**
```json
{
  "error": "Proof state validation failed",
  "message": "Cannot proceed with Lightning payment. Critical proof state inconsistencies detected.",
  "code": "PROOF_STATE_INCONSISTENCY",
  "severity": "CRITICAL",
  "details": {
    "discrepancies": [
      {
        "severity": "HIGH",
        "type": "DB_UNSPENT_MINT_SPENT",
        "proof_amount": 500,
        "action_required": "BLOCK_OPERATION"
      }
    ]
  },
  "recommendation": "Please contact support for manual reconciliation"
}
```

**Insufficient Balance (400 Bad Request):**
```json
{
  "error": "Insufficient balance",
  "message": "Insufficient balance. Required: 1000, Available: 500",
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

**Critical Error (500 Internal Server Error):**
```json
{
  "error": "Critical melt operation failure",
  "message": "CRITICAL: Lightning payment succeeded but database update failed.",
  "code": "CRITICAL_DB_FAILURE_AFTER_MINT_SUCCESS",
  "severity": "CRITICAL",
  "requiresManualIntervention": true,
  "quoteId": "quote_123",
  "transactionId": "tx_melt_456",
  "supportContact": "support@example.com",
  "incidentId": "INC-2025-08-08-001"
}
```

### GET /api/wallet/{npub}/proofs/status

Check proof states with the mint to verify consistency.

#### Request

**URL Parameters:**
- `npub` (string, required): User's Nostr public key in npub format

**Query Parameters:**
- `proofs` (string, optional): JSON array of specific proofs to check

**Example:**
```http
GET /api/wallet/npub1.../proofs/status?proofs=[{"secret":"abc123","amount":100}]
```

#### Response

**Success Response (200 OK):**
```json
{
  "success": true,
  "totalProofs": 5,
  "spentCount": 1,
  "unspentCount": 4,
  "pendingCount": 0,
  "discrepancies": [
    {
      "severity": "MEDIUM",
      "type": "DB_PENDING_MINT_SPENT",
      "description": "Database shows proof as pending but mint shows as spent",
      "proof_amount": 100,
      "action_required": "UPDATE_STATUS",
      "recommendation": "Update database status from pending to spent"
    }
  ],
  "severityCounts": {
    "HIGH": 0,
    "MEDIUM": 1,
    "LOW": 0
  },
  "consistent": false,
  "hasHighSeverity": false,
  "mintUrl": "https://mint.minibits.cash/Bitcoin",
  "timestamp": "2025-08-08T01:00:00.000Z"
}
```

---

## Request/Response Schemas

### Common Data Types

#### Proof Object
```typescript
interface Proof {
  id: string;           // Keyset ID
  amount: number;       // Amount in satoshis
  secret: string;       // Proof secret
  C: string;           // Proof commitment
}
```

#### Token Object
```typescript
interface Token {
  _id: string;
  npub: string;
  wallet_id: string;
  proofs: Proof[];
  mint_url: string;
  transaction_type: 'minted' | 'sent' | 'received' | 'change';
  transaction_id: string;
  status: 'pending' | 'unspent' | 'spent' | 'failed';
  total_amount: number;
  created_at: string;
  spent_at?: string;
  metadata: Record<string, any>;
}
```

#### Error Object
```typescript
interface APIError {
  error: string;                    // Error category
  message: string;                  // Human-readable error message
  code?: string;                    // Machine-readable error code
  severity?: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  details?: Record<string, any>;    // Additional error context
  recommendation?: string;          // User guidance
  supportContact?: string;          // Support contact for critical errors
  incidentId?: string;             // Incident tracking ID
}
```

### Request Validation

#### Input Validation Rules
```typescript
const validationRules = {
  npub: {
    required: true,
    pattern: /^npub1[a-z0-9]{58}$/,
    description: 'Valid Nostr npub format'
  },
  
  invoice: {
    required: true,
    pattern: /^ln(bc|tb)[a-z0-9]+$/i,
    minLength: 100,
    maxLength: 2000,
    description: 'Valid Lightning invoice'
  },
  
  amount: {
    type: 'integer',
    minimum: 1,
    maximum: 1000000,
    description: 'Amount in satoshis'
  },
  
  timeout_seconds: {
    type: 'integer',
    minimum: 5,
    maximum: 300,
    default: 30,
    description: 'Operation timeout in seconds'
  }
};
```

#### Request Size Limits
- **Maximum Request Size**: 1MB
- **Maximum Proof Array Length**: 1000 proofs
- **Maximum Invoice Length**: 2000 characters
- **Maximum Metadata Size**: 10KB

---

## Error Codes and Handling

### Error Code Categories

#### Validation Errors (4xx)
| Code | HTTP Status | Description | Severity |
|------|-------------|-------------|----------|
| `INVALID_NPUB` | 400 | Invalid npub format | HIGH |
| `INVALID_INVOICE` | 400 | Invalid Lightning invoice | HIGH |
| `INVALID_AMOUNT` | 400 | Invalid amount value | HIGH |
| `MISSING_REQUIRED_FIELD` | 400 | Required field missing | HIGH |
| `REQUEST_TOO_LARGE` | 413 | Request exceeds size limit | MEDIUM |

#### Business Logic Errors (4xx)
| Code | HTTP Status | Description | Severity |
|------|-------------|-------------|----------|
| `INSUFFICIENT_BALANCE` | 400 | Not enough funds | HIGH |
| `PROOF_STATE_INCONSISTENCY` | 400 | Proof state validation failed | CRITICAL |
| `WALLET_NOT_FOUND` | 404 | Wallet doesn't exist | HIGH |
| `INVOICE_EXPIRED` | 400 | Lightning invoice expired | MEDIUM |
| `AMOUNT_TOO_SMALL` | 400 | Amount below minimum | MEDIUM |

#### System Errors (5xx)
| Code | HTTP Status | Description | Severity |
|------|-------------|-------------|----------|
| `CRITICAL_DB_FAILURE_AFTER_MINT_SUCCESS` | 500 | Payment succeeded, DB failed | CRITICAL |
| `MINT_CONNECTIVITY_ERROR` | 502 | Cannot connect to mint | HIGH |
| `DATABASE_ERROR` | 500 | Database operation failed | HIGH |
| `INTERNAL_SERVER_ERROR` | 500 | Unexpected server error | MEDIUM |
| `SERVICE_UNAVAILABLE` | 503 | Service temporarily unavailable | MEDIUM |

### Error Response Format

#### Standard Error Response
```json
{
  "error": "Error category",
  "message": "Human-readable description",
  "code": "MACHINE_READABLE_CODE",
  "severity": "HIGH",
  "timestamp": "2025-08-08T01:00:00.000Z",
  "requestId": "req_123456789"
}
```

#### Enhanced Error Response (v2.0)
```json
{
  "error": "Error category",
  "message": "Human-readable description",
  "code": "MACHINE_READABLE_CODE",
  "severity": "CRITICAL",
  "details": {
    "field": "invoice",
    "provided": "invalid_value",
    "expected": "valid_lightning_invoice"
  },
  "recommendation": "Please provide a valid Lightning invoice",
  "supportContact": "support@example.com",
  "incidentId": "INC-2025-08-08-001",
  "timestamp": "2025-08-08T01:00:00.000Z",
  "requestId": "req_123456789"
}
```

### Error Handling Best Practices

#### Client Error Handling
```typescript
async function handleMeltOperation(npub: string, invoice: string) {
  try {
    const response = await meltTokens(npub, invoice);
    return response;
  } catch (error) {
    if (error.severity === 'CRITICAL') {
      // Show critical error dialog with support contact
      showCriticalErrorDialog({
        message: error.message,
        incidentId: error.incidentId,
        supportContact: error.supportContact
      });
    } else if (error.code === 'PROOF_STATE_INCONSISTENCY') {
      // Show specific guidance for proof state issues
      showProofStateErrorDialog({
        message: error.message,
        recommendation: error.recommendation
      });
    } else if (error.code === 'INSUFFICIENT_BALANCE') {
      // Show balance-specific error with add funds option
      showInsufficientBalanceDialog({
        required: error.details.required,
        available: error.details.available,
        shortfall: error.details.shortfall
      });
    } else {
      // Standard error handling
      showErrorMessage(error.message);
    }
    
    throw error;
  }
}
```

---

## Rate Limiting and Throttling

### Rate Limit Configuration

#### Per-User Limits
| Endpoint | Limit | Window | Burst |
|----------|-------|--------|-------|
| `/api/wallet/{npub}/melt` | 10 requests | 1 minute | 3 |
| `/api/wallet/{npub}/balance` | 60 requests | 1 minute | 10 |
| `/api/wallet/{npub}/proofs/status` | 30 requests | 1 minute | 5 |
| `/api/wallet/{npub}/transactions` | 30 requests | 1 minute | 5 |

#### Global Limits
- **Total API Requests**: 10,000 requests/minute
- **Concurrent Connections**: 1,000 per server
- **Request Size**: 1MB maximum
- **Response Time**: 30 seconds timeout

### Rate Limit Headers

#### Response Headers
```http
X-RateLimit-Limit: 10
X-RateLimit-Remaining: 7
X-RateLimit-Reset: 1691234567
X-RateLimit-Window: 60
Retry-After: 45
```

#### Rate Limit Exceeded Response (429)
```json
{
  "error": "Rate limit exceeded",
  "message": "Too many requests. Please try again in 45 seconds.",
  "code": "RATE_LIMIT_EXCEEDED",
  "severity": "MEDIUM",
  "details": {
    "limit": 10,
    "window": 60,
    "retryAfter": 45
  },
  "recommendation": "Reduce request frequency or implement exponential backoff"
}
```

### Throttling Implementation

#### Adaptive Throttling
```typescript
class AdaptiveThrottling {
  static async checkRateLimit(userId: string, endpoint: string): Promise<boolean> {
    const key = `rate_limit:${userId}:${endpoint}`;
    const current = await redis.get(key);
    const limit = this.getLimitForEndpoint(endpoint);
    
    if (current && parseInt(current) >= limit) {
      return false; // Rate limit exceeded
    }
    
    // Increment counter
    await redis.multi()
      .incr(key)
      .expire(key, 60) // 1 minute window
      .exec();
    
    return true;
  }
  
  static getLimitForEndpoint(endpoint: string): number {
    const limits = {
      'melt': 10,
      'balance': 60,
      'proofs': 30,
      'transactions': 30
    };
    
    return limits[endpoint] || 30;
  }
}
```

---

## Webhook Integration

### Webhook Events

#### Supported Events
| Event | Description | Payload |
|-------|-------------|---------|
| `melt.completed` | Melt operation completed successfully | MeltResponse |
| `melt.failed` | Melt operation failed | Error details |
| `proof.reconciliation.required` | Proof state discrepancies detected | Discrepancy details |
| `balance.updated` | Wallet balance changed | Balance information |

### Webhook Configuration

#### Webhook Registration
```http
POST /api/webhooks
Content-Type: application/json
Authorization: Bearer {jwt_token}

{
  "url": "https://your-app.com/webhooks/cashu",
  "events": ["melt.completed", "melt.failed"],
  "secret": "your_webhook_secret",
  "active": true
}
```

#### Webhook Payload Example
```json
{
  "event": "melt.completed",
  "timestamp": "2025-08-08T01:00:00.000Z",
  "data": {
    "npub": "npub1...",
    "transactionId": "tx_melt_123",
    "paymentResult": "PAID",
    "paidAmount": 1000,
    "feesPaid": 50,
    "changeAmount": 150
  },
  "signature": "sha256=abc123..."
}
```

### Webhook Security

#### Signature Verification
```typescript
function verifyWebhookSignature(payload: string, signature: string, secret: string): boolean {
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  
  return `sha256=${expectedSignature}` === signature;
}
```

---

## API Versioning Strategy

### Versioning Approach

#### URL Versioning
```http
# Current approach - no version in URL (defaults to latest)
POST /api/wallet/{npub}/melt

# Future versioning if breaking changes needed
POST /api/v3/wallet/{npub}/melt
```

#### Header Versioning
```http
POST /api/wallet/{npub}/melt
Accept: application/vnd.cashu.v2+json
Content-Type: application/json
```

#### Feature Flags for Gradual Rollout
```typescript
interface APIOptions {
  apiVersion?: '1.0' | '2.0';
  features?: {
    enhancedErrors?: boolean;
    detailedMetrics?: boolean;
    webhooks?: boolean;
  };
}
```

### Version Support Policy

#### Support Timeline
- **Current Version (2.0)**: Full support, new features
- **Previous Version (1.x)**: Maintenance mode, security updates only
- **Legacy Versions**: 12 months deprecation notice

#### Migration Path
1. **Phase 1**: New features available via feature flags
2. **Phase 2**: New features enabled by default
3. **Phase 3**: Old features deprecated with warnings
4. **Phase 4**: Old features removed after deprecation period

---

## OpenAPI Specification

### Complete OpenAPI 3.0 Specification

```yaml
openapi: 3.0.3
info:
  title: Cashu Wallet API
  description: Enhanced Cashu wallet operations with atomic transactions
  version: 2.0.0
  contact:
    name: API Support
    email: support@example.com
  license:
    name: MIT
    url: https://opensource.org/licenses/MIT

servers:
  - url: https://api.example.com
    description: Production server
  - url: https://staging-api.example.com
    description: Staging server

paths:
  /api/wallet/{npub}/melt:
    post:
      summary: Execute Lightning payment with tokens
      description: |
        Melt Cashu tokens to pay a Lightning invoice. This operation uses
        atomic transactions to ensure data consistency and includes pre-flight
        proof state reconciliation.
      operationId: meltTokens
      tags:
        - Melt Operations
      parameters:
        - name: npub
          in: path
          required: true
          description: User's Nostr public key in npub format
          schema:
            type: string
            pattern: '^npub1[a-z0-9]{58}$'
            example: 'npub1234567890abcdef...'
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/MeltRequest'
            examples:
              basic:
                summary: Basic melt request
                value:
                  invoice: 'lnbc1000n1pjqxqzjsp5...'
              with_options:
                summary: Melt request with options
                value:
                  invoice: 'lnbc1000n1pjqxqzjsp5...'
                  options:
                    max_fee_percent: 1.0
                    timeout_seconds: 30
      responses:
        '200':
          description: Melt operation completed successfully
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/MeltResponse'
              examples:
                success:
                  summary: Successful melt operation
                  value:
                    success: true
                    transactionId: 'tx_melt_1691234567_abc123'
                    paymentResult: 'PAID'
                    paidAmount: 1000
                    feesPaid: 50
                    changeAmount: 150
                    quoteId: 'quote_789'
        '400':
          description: Bad request - validation error or business logic error
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/APIError'
              examples:
                validation_error:
                  summary: Validation error
                  value:
                    error: 'Validation failed'
                    message: 'Invalid Lightning invoice format'
                    code: 'INVALID_INVOICE'
                    severity: 'HIGH'
                insufficient_balance:
                  summary: Insufficient balance
                  value:
                    error: 'Insufficient balance'
                    message: 'Insufficient balance. Required: 1000, Available: 500'
                    code: 'INSUFFICIENT_BALANCE'
                    severity: 'HIGH'
                    details:
                      required: 1000
                      available: 500
                      shortfall: 500
        '500':
          description: Internal server error
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/APIError'
              examples:
                critical_error:
                  summary: Critical error requiring manual intervention
                  value:
                    error: 'Critical melt operation failure'
                    message: 'CRITICAL: Lightning payment succeeded but database update failed.'
                    code: 'CRITICAL_DB_FAILURE_AFTER_MINT_SUCCESS'
                    severity: 'CRITICAL'
                    requiresManualIntervention: true
                    supportContact: 'support@example.com'

components:
  schemas:
    MeltRequest:
      type: object
      required:
        - invoice
      properties:
        invoice:
          type: string
          description: Lightning invoice to pay
          pattern: '^ln(bc|tb)[a-z0-9]+$'
          example: 'lnbc1000n1pjqxqzjsp5...'
        options:
          type: object
          properties:
            max_fee_percent:
              type: number
              minimum: 0
              maximum: 10
              default: 2.0
              description: Maximum fee percentage
            timeout_seconds:
              type: integer
              minimum: 5
              maximum: 300
              default: 30
              description: Operation timeout in seconds
            enable_reconciliation:
              type: boolean
              default: true
              description: Enable pre-flight proof state reconciliation

    MeltResponse:
      type: object
      required:
        - success
        - transactionId
        - paymentResult
        - paidAmount
        - feesPaid
        - changeAmount
        - quoteId
      properties:
        success:
          type: boolean
          description: Whether the operation succeeded
        transactionId:
          type: string
          description: Unique transaction identifier
          example: 'tx_melt_1691234567_abc123'
        paymentResult:
          type: string
          enum: ['PAID', 'PENDING', 'FAILED']
          description: Lightning payment result
        paidAmount:
          type: integer
          description: Amount paid in satoshis
          example: 1000
        feesPaid:
          type: integer
          description: Lightning fees paid in satoshis
          example: 50
        changeAmount:
          type: integer
          description: Total change amount in satoshis
          example: 150
        quoteId:
          type: string
          description: Mint quote identifier
          example: 'quote_789'
        atomicResult:
          $ref: '#/components/schemas/AtomicMeltResult'
        operationDuration:
          type: integer
          description: Operation duration in milliseconds
          example: 2500
        reconciliationInfo:
          $ref: '#/components/schemas/ReconciliationInfo'

    AtomicMeltResult:
      type: object
      properties:
        success:
          type: boolean
        transaction_id:
          type: string
        source_tokens_spent:
          type: integer
        keep_token_id:
          type: string
        keep_amount:
          type: integer
        melt_change_token_id:
          type: string
        melt_change_amount:
          type: integer
        operations:
          type: array
          items:
            $ref: '#/components/schemas/AtomicOperation'

    AtomicOperation:
      type: object
      properties:
        type:
          type: string
          enum: ['keep_change', 'melt_change']
        token_id:
          type: string
        amount:
          type: integer
        proof_count:
          type: integer

    ReconciliationInfo:
      type: object
      properties:
        discrepanciesFound:
          type: boolean
        discrepanciesResolved:
          type: boolean
        reconciliationDuration:
          type: integer

    APIError:
      type: object
      required:
        - error
        - message
      properties:
        error:
          type: string
          description: Error category
        message:
          type: string
          description: Human-readable error message
        code:
          type: string
          description: Machine-readable error code
        severity:
          type: string
          enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']