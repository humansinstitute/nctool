# ADR-001: Cashu eCash Wallet Integration

## Status

Accepted

## Context

The nctool project required integration of Cashu eCash wallet functionality to enable users to manage digital cash tokens through their Nostr identities. This integration needed to support the full Cashu protocol while maintaining compatibility with existing Nostr-based identity management and following the project's architectural patterns.

## Decision

We have implemented a comprehensive Cashu wallet integration with the following architectural decisions:

### 1. Database-First Approach with Nostr Event Publishing

**Decision**: Store wallet and token data primarily in MongoDB with Nostr events as a secondary publishing mechanism.

**Rationale**:

- Ensures data persistence and reliability independent of Nostr relay availability
- Enables complex queries and analytics on wallet data
- Maintains Nostr compatibility for interoperability
- Provides backup and recovery capabilities

### 2. Repository Pattern for Data Access

**Decision**: Implement a dedicated `walletRepository.service.js` following the repository pattern for all database operations.

**Rationale**:

- Abstracts database operations from business logic
- Enables easy testing and mocking
- Provides consistent data access patterns
- Supports future database migrations or changes

### 3. Service Layer Architecture

**Decision**: Separate Cashu protocol operations (`cashu.service.js`) from data persistence (`walletRepository.service.js`).

**Rationale**:

- Clear separation of concerns
- Enables independent testing of protocol vs. persistence logic
- Facilitates future protocol updates without affecting data layer
- Supports different mint integrations

### 4. Nostr Identity Integration

**Decision**: Use existing Nostr public keys (npub) as primary wallet identifiers and integrate with existing identity management.

**Rationale**:

- Leverages existing user authentication system
- Maintains consistency with project's Nostr-first approach
- Enables seamless user experience
- Supports existing key management workflows

### 5. P2PK (Pay-to-Public-Key) Support

**Decision**: Generate and store P2PK keypairs for each wallet to enable locked token transfers.

**Rationale**:

- Enhances security for token transfers
- Enables recipient-specific token locking
- Supports advanced Cashu features
- Provides foundation for future privacy enhancements

### 6. Comprehensive Error Handling and Logging

**Decision**: Implement consistent error handling and structured logging across all wallet operations.

**Rationale**:

- Enables effective debugging and monitoring
- Provides audit trail for financial operations
- Supports compliance and security requirements
- Facilitates operational maintenance

### 7. Transaction-Based Operations

**Decision**: Treat all wallet operations as transactions with unique IDs and comprehensive metadata.

**Rationale**:

- Enables transaction history and auditing
- Supports reconciliation and debugging
- Provides foundation for analytics
- Ensures data consistency

## Implementation Details

### Database Schema

#### CashuWallet Model

```javascript
{
  npub: String,           // Nostr public key (indexed)
  mint_url: String,       // Cashu mint URL (indexed)
  p2pk_pubkey: String,    // P2PK public key
  p2pk_privkey: String,   // P2PK private key (encrypted)
  wallet_config: Object,  // Wallet configuration
  createdAt: Date,
  updatedAt: Date
}
```

#### CashuToken Model

```javascript
{
  npub: String,           // Owner's Nostr public key (indexed)
  wallet_id: ObjectId,    // Reference to wallet
  proofs: Array,          // Cashu proofs
  mint_url: String,       // Cashu mint URL (indexed)
  total_amount: Number,   // Total token value
  transaction_type: String, // Operation type (indexed)
  transaction_id: String, // Unique transaction ID (indexed)
  status: String,         // Token status (indexed)
  metadata: Object,       // Additional transaction data
  createdAt: Date,
  updatedAt: Date
}
```

### API Endpoints

- `POST /api/wallet/create` - Create new wallet
- `GET /api/wallet/:npub/balance` - Get wallet balance
- `POST /api/wallet/:npub/mint` - Mint tokens from Lightning
- `POST /api/wallet/:npub/send` - Send tokens to recipient
- `POST /api/wallet/:npub/receive` - Receive tokens from encoded string
- `POST /api/wallet/:npub/melt` - Pay Lightning invoice with tokens
- `GET /api/wallet/:npub/transactions` - Get transaction history
- `GET /api/wallet/:npub/proofs/status` - Check proof states
- `GET /api/wallet/:npub/info` - Get wallet information

### Integration Points

1. **Nostr Events**: Publishes wallet metadata (kind 17375) and payment info (kind 10019)
2. **Identity Service**: Integrates with existing `identity.service.js` for user management
3. **Logging**: Uses centralized `logger.js` for consistent logging
4. **Error Handling**: Leverages existing `errorHandler.js` middleware

## Consequences

### Positive

- **Comprehensive Functionality**: Full Cashu protocol support with all major operations
- **Data Persistence**: Reliable storage independent of external services
- **Scalability**: Repository pattern supports future scaling and optimization
- **Maintainability**: Clear separation of concerns and consistent patterns
- **Security**: P2PK support and encrypted private key storage
- **Observability**: Comprehensive logging and transaction tracking
- **Interoperability**: Nostr event publishing maintains protocol compatibility

### Negative

- **Complexity**: Additional database models and service layers increase system complexity
- **Storage Requirements**: Storing all proofs and transaction history increases storage needs
- **Dependency**: Requires MongoDB for full functionality
- **Key Management**: P2PK private keys require secure storage and encryption

### Risks and Mitigations

1. **Private Key Security**

   - Risk: P2PK private keys stored in database
   - Mitigation: Implement encryption at rest, consider HSM integration for production

2. **Mint Dependency**

   - Risk: Single point of failure if mint becomes unavailable
   - Mitigation: Support multiple mints, implement fallback mechanisms

3. **Database Performance**

   - Risk: Large transaction volumes may impact database performance
   - Mitigation: Implement proper indexing, consider archiving strategies

4. **Protocol Changes**
   - Risk: Cashu protocol updates may require significant changes
   - Mitigation: Service layer abstraction isolates protocol changes

## Alternatives Considered

### 1. Nostr-Only Storage

**Rejected**: Would limit query capabilities and create dependency on relay availability.

### 2. File-Based Storage

**Rejected**: Would not scale and lacks transaction capabilities.

### 3. External Wallet Integration

**Rejected**: Would reduce control and integration capabilities.

### 4. Simplified Token Storage

**Rejected**: Would limit functionality and future extensibility.

## References

- [Cashu Protocol Specification](https://docs.cashu.space/)
- [NIP-61: Nutzaps](https://github.com/nostr-protocol/nips/blob/master/61.md)
- [Project Repository Pattern Guidelines](../apiLayer.md)
- [MongoDB Schema Design Best Practices](https://docs.mongodb.com/manual/data-modeling/)

## Revision History

- **2024-01-01**: Initial ADR created for Cashu wallet integration
- **Phase 1**: Database models and repository layer implementation
- **Phase 2**: Cashu service layer with protocol operations
- **Phase 3**: Repository service enhancements and optimization
- **Phase 4**: Production API endpoints and route configuration
- **Phase 5**: Integration, cleanup, and documentation completion
