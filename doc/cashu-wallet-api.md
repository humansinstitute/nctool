# Cashu Wallet API Documentation

This document provides comprehensive documentation for the Cashu eCash wallet API endpoints implemented in nctool.

## Overview

The Cashu wallet API provides a complete implementation of Cashu eCash operations, including wallet creation, token minting, sending, receiving, and melting operations. All operations are tied to Nostr identities (npub) and integrate with the existing identity management system.

## Base URL

All API endpoints are prefixed with `/api/wallet`

## Authentication

All endpoints require a valid Nostr public key (npub) that exists in the system's identity store. The npub is used both as a path parameter and for wallet identification.

## Error Handling

All endpoints return consistent error responses:

```json
{
  "error": "Error description",
  "message": "Detailed error message"
}
```

Common HTTP status codes:

- `400`: Bad Request (invalid parameters)
- `404`: Not Found (user or wallet not found)
- `500`: Internal Server Error

## Endpoints

### 1. Create Wallet

Creates a new Cashu wallet for a user, publishing wallet metadata to Nostr and storing wallet data in the database.

**Endpoint:** `POST /api/wallet/create`

**Request Body:**

```json
{
  "npub": "npub1..."
}
```

**Response:**

```json
{
  "success": true,
  "message": "Wallet created successfully",
  "walletDetails": {
    "mint": "https://mint.minibits.cash/Bitcoin",
    "p2pkPub": "02abcd..."
  },
  "events": {
    "wallet": {
      "id": "event_id",
      "relays": ["wss://relay.damus.io"]
    },
    "info": {
      "id": "event_id",
      "relays": ["wss://relay.damus.io"]
    }
  }
}
```

**Notes:**

- Creates both Nostr events (kind 17375 and 10019) and database records
- Generates P2PK keypair for enhanced security
- Returns existing wallet if already created

### 2. Get Wallet Balance

Retrieves the current balance for a user's wallet.

**Endpoint:** `GET /api/wallet/:npub/balance`

**Parameters:**

- `npub`: Nostr public key (path parameter)

**Response:**

```json
{
  "success": true,
  "balance": {
    "unspent_balance": 1500,
    "total_balance": 2000,
    "spent_balance": 500,
    "pending_balance": 0
  }
}
```

### 3. Mint Tokens

Creates a mint quote for generating new tokens from a Lightning invoice.

**Endpoint:** `POST /api/wallet/:npub/mint`

**Parameters:**

- `npub`: Nostr public key (path parameter)

**Request Body:**

```json
{
  "amount": 1000
}
```

**Response:**

```json
{
  "success": true,
  "quote": "quote_id",
  "invoice": "lnbc1...",
  "amount": 1000,
  "transactionId": "tx_123",
  "expiry": 1640995200,
  "mintUrl": "https://mint.minibits.cash/Bitcoin"
}
```

**Notes:**

- User must pay the Lightning invoice to complete minting
- Quote expires after the specified time
- Use the quote ID to complete minting after payment

### 4. Send Tokens

Sends tokens to another user, optionally with P2PK locking.

**Endpoint:** `POST /api/wallet/:npub/send`

**Parameters:**

- `npub`: Nostr public key (path parameter)

**Request Body:**

```json
{
  "amount": 500,
  "recipientPubkey": "02abcd..." // optional for P2PK
}
```

**Response:**

```json
{
  "success": true,
  "encodedToken": "cashuAey...",
  "transactionId": "tx_456",
  "amount": 500,
  "changeAmount": 100,
  "recipientPubkey": "02abcd...",
  "mintUrl": "https://mint.minibits.cash/Bitcoin"
}
```

**Notes:**

- If `recipientPubkey` is provided, tokens are locked to that public key (P2PK)
- Change tokens are automatically created if needed
- Returns encoded token string for sharing

### 5. Receive Tokens

Receives tokens from an encoded token string.

**Endpoint:** `POST /api/wallet/:npub/receive`

**Parameters:**

- `npub`: Nostr public key (path parameter)

**Request Body:**

```json
{
  "encodedToken": "cashuAey...",
  "privateKey": "hex_private_key" // optional for P2PK tokens
}
```

**Response:**

```json
{
  "success": true,
  "proofs": [
    {
      "id": "proof_id",
      "amount": 100,
      "secret": "secret_string",
      "C": "commitment_string"
    }
  ],
  "tokenId": "token_123",
  "transactionId": "tx_789",
  "totalAmount": 500,
  "mintUrl": "https://mint.minibits.cash/Bitcoin"
}
```

**Notes:**

- `privateKey` required only for P2PK locked tokens
- Tokens are automatically stored in the user's wallet
- Validates token authenticity with the mint

### 6. Melt Tokens

Pays a Lightning invoice using tokens (melt operation).

**Endpoint:** `POST /api/wallet/:npub/melt`

**Parameters:**

- `npub`: Nostr public key (path parameter)

**Request Body:**

```json
{
  "invoice": "lnbc1..."
}
```

**Response:**

```json
{
  "success": true,
  "transactionId": "tx_101",
  "paymentResult": "paid",
  "paidAmount": 1000,
  "feesPaid": 10,
  "changeAmount": 90,
  "quoteId": "melt_quote_123"
}
```

**Notes:**

- Automatically selects optimal tokens for payment
- Creates change tokens if overpayment occurs
- Returns payment confirmation from Lightning network

### 7. Get Transaction History

Retrieves paginated transaction history for a user.

**Endpoint:** `GET /api/wallet/:npub/transactions`

**Parameters:**

- `npub`: Nostr public key (path parameter)

**Query Parameters:**

- `limit`: Number of transactions to return (1-100, default: 50)
- `skip`: Number of transactions to skip (default: 0)
- `transaction_type`: Filter by type (`sent`, `received`, `minted`, `melted`)
- `mint_url`: Filter by mint URL

**Response:**

```json
{
  "success": true,
  "transactions": [
    {
      "id": "tx_123",
      "transaction_type": "sent",
      "amount": 500,
      "mint_url": "https://mint.minibits.cash/Bitcoin",
      "status": "completed",
      "created_at": "2024-01-01T12:00:00Z",
      "metadata": {
        "recipient_pubkey": "02abcd..."
      }
    }
  ],
  "pagination": {
    "total": 25,
    "limit": 50,
    "skip": 0,
    "hasMore": false
  }
}
```

### 8. Check Proof States

Verifies the state of proofs with the mint.

**Endpoint:** `GET /api/wallet/:npub/proofs/status`

**Parameters:**

- `npub`: Nostr public key (path parameter)

**Query Parameters:**

- `proofs`: JSON array of specific proofs to check (optional)

**Response:**

```json
{
  "success": true,
  "totalProofs": 10,
  "unspentCount": 8,
  "spentCount": 2,
  "unspentProofs": [
    {
      "id": "proof_id",
      "amount": 100,
      "state": "unspent"
    }
  ],
  "spentProofs": [
    {
      "id": "proof_id2",
      "amount": 50,
      "state": "spent"
    }
  ]
}
```

### 9. Get Wallet Information

Retrieves comprehensive wallet information and metadata.

**Endpoint:** `GET /api/wallet/:npub/info`

**Parameters:**

- `npub`: Nostr public key (path parameter)

**Response:**

```json
{
  "success": true,
  "walletInfo": {
    "npub": "npub1...",
    "mintUrl": "https://mint.minibits.cash/Bitcoin",
    "balance": {
      "unspent_balance": 1500,
      "total_balance": 2000
    },
    "statistics": {
      "wallet_count": 1,
      "total_transactions": 15,
      "unspent_balance": 1500,
      "total_received": 3000,
      "total_sent": 1500
    },
    "walletDetails": {
      "mint": "https://mint.minibits.cash/Bitcoin",
      "p2pkPub": "02abcd..."
    },
    "createdAt": "2024-01-01T12:00:00Z"
  }
}
```

## Data Models

### Wallet Model

```javascript
{
  npub: String,           // Nostr public key
  mint_url: String,       // Cashu mint URL
  p2pk_pubkey: String,    // P2PK public key
  p2pk_privkey: String,   // P2PK private key (encrypted)
  wallet_config: {
    unit: String,         // Currency unit (sat)
    created_via: String   // Creation method (api)
  },
  createdAt: Date,
  updatedAt: Date
}
```

### Token Model

```javascript
{
  npub: String,           // Owner's Nostr public key
  wallet_id: ObjectId,    // Reference to wallet
  proofs: Array,          // Cashu proofs
  mint_url: String,       // Cashu mint URL
  total_amount: Number,   // Total token value
  transaction_type: String, // sent/received/minted/melted
  transaction_id: String, // Unique transaction ID
  status: String,         // unspent/spent/pending
  metadata: Object,       // Additional transaction data
  createdAt: Date,
  updatedAt: Date
}
```

## Error Codes

| Code                   | Description                         |
| ---------------------- | ----------------------------------- |
| `WALLET_NOT_FOUND`     | Wallet does not exist for user      |
| `INSUFFICIENT_BALANCE` | Not enough tokens for operation     |
| `INVALID_TOKEN`        | Token format or content is invalid  |
| `MINT_ERROR`           | Error communicating with Cashu mint |
| `PROOF_ALREADY_SPENT`  | Attempting to use spent proofs      |
| `INVALID_INVOICE`      | Lightning invoice is invalid        |
| `PAYMENT_FAILED`       | Lightning payment failed            |
| `QUOTA_EXCEEDED`       | Rate limit or quota exceeded        |

## Rate Limiting

API endpoints are subject to rate limiting:

- Wallet operations: 100 requests per minute per npub
- Balance checks: 200 requests per minute per npub
- Transaction history: 50 requests per minute per npub

## Security Considerations

1. **P2PK Keys**: Private keys are stored encrypted in the database
2. **Token Validation**: All tokens are validated with the mint before acceptance
3. **Proof Verification**: Proof states are regularly checked to prevent double-spending
4. **Input Validation**: All inputs are validated and sanitized
5. **Error Handling**: Sensitive information is not exposed in error messages

## Integration Examples

### JavaScript/Node.js

```javascript
const axios = require("axios");

// Create wallet
const createWallet = async (npub) => {
  const response = await axios.post("http://localhost:3000/api/wallet/create", {
    npub: npub,
  });
  return response.data;
};

// Send tokens
const sendTokens = async (npub, amount, recipientPubkey) => {
  const response = await axios.post(
    `http://localhost:3000/api/wallet/${npub}/send`,
    {
      amount: amount,
      recipientPubkey: recipientPubkey,
    }
  );
  return response.data;
};
```

### cURL Examples

```bash
# Create wallet
curl -X POST http://localhost:3000/api/wallet/create \
  -H "Content-Type: application/json" \
  -d '{"npub":"npub1..."}'

# Get balance
curl http://localhost:3000/api/wallet/npub1.../balance

# Send tokens
curl -X POST http://localhost:3000/api/wallet/npub1.../send \
  -H "Content-Type: application/json" \
  -d '{"amount":500,"recipientPubkey":"02abcd..."}'
```

## Support

For issues or questions regarding the Cashu wallet API, please refer to:

- [Cashu Protocol Documentation](https://docs.cashu.space/)
- [Project Issues](https://github.com/your-repo/issues)
- [API Layer Documentation](./apiLayer.md)
