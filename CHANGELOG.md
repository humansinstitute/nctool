# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Cashu Wallet Phase 5**: Production Integration and Documentation
  - Complete production-ready Cashu wallet implementation
  - [`cashu-wallet-api.md`](doc/cashu-wallet-api.md) - Comprehensive API documentation with endpoint specifications, examples, and integration guides
  - Enhanced wallet creation with database integration using new models
  - Consistent error handling and logging across all wallet endpoints
  - Production cleanup with removal of all temporary test infrastructure
  - Updated [`README.md`](README.md) with Cashu wallet API documentation and usage examples
  - Environment variable documentation for all Cashu-related configuration
  - Architecture Decision Record for Cashu integration patterns

### Changed

- **Enhanced Wallet Controller**: Updated [`wallet.controller.js`](src/controllers/wallet.controller.js)
  - Integrated wallet creation with new database models ([`CashuWallet.model.js`](src/models/CashuWallet.model.js))
  - Consistent logging using [`logger`](src/utils/logger.js) instead of console.log
  - Enhanced error handling with proper validation and user feedback
  - Database-first approach with Nostr event publishing as secondary operation
  - Improved transaction logging and state management

### Removed

- **Phase 2.5 Testing Infrastructure** (Production Cleanup)
  - Removed [`test.controller.js`](src/controllers/test.controller.js) - Temporary test endpoints
  - Removed [`test.routes.js`](src/routes/test.routes.js) - Test route definitions
  - Removed test route mounting from [`app.js`](src/app.js)
  - Removed [`scripts/test-phase2.sh`](scripts/test-phase2.sh) - Test automation script
  - Removed temporary test documentation files:
    - `doc/testing/phase2-manual-tests.md`
    - `doc/testing/phase2-5-summary.md`
    - `doc/testing/test-endpoints-quick-reference.md`
    - `doc/testing/phase4-route-configuration-summary.md`
  - All development-only code and comments cleaned up for production readiness
- **Cashu Wallet Phase 4**: Production API Endpoints

  - Complete production wallet API in [`wallet.controller.js`](src/controllers/wallet.controller.js)
    - [`getBalance()`](src/controllers/wallet.controller.js:119) - Get wallet balance with comprehensive error handling
    - [`mintTokens()`](src/controllers/wallet.controller.js:170) - Mint tokens from Lightning invoices
    - [`sendTokens()`](src/controllers/wallet.controller.js:235) - Send tokens with optional P2PK locking
    - [`receiveTokens()`](src/controllers/wallet.controller.js:305) - Receive tokens from encoded token strings
    - [`meltTokens()`](src/controllers/wallet.controller.js:375) - Pay Lightning invoices with tokens
    - [`checkProofStates()`](src/controllers/wallet.controller.js:439) - Verify proof states with mint
    - [`getTransactionHistory()`](src/controllers/wallet.controller.js:506) - Paginated transaction history
    - [`getWalletInfo()`](src/controllers/wallet.controller.js:590) - Comprehensive wallet information
  - Production route configuration in [`wallet.routes.js`](src/routes/wallet.routes.js)
  - Comprehensive input validation and error handling for all endpoints
  - Integration with existing Nostr identity management system
  - Consistent logging and transaction tracking across all operations

- **Cashu Wallet Phase 3**: Repository Service Integration

  - Enhanced [`walletRepository.service.js`](src/services/walletRepository.service.js) with production-ready data access patterns
  - Advanced token selection algorithms for optimal spending
  - Transaction history management with pagination and filtering
  - Comprehensive wallet statistics and balance calculations
  - Proof state management and validation helpers
  - Database optimization for high-performance wallet operations

- **Cashu Wallet Phase 2**: Enhanced Cashu Service Layer
  - Extended [`cashu.service.js`](src/services/cashu.service.js) with core wallet operations using cashu-ts library
  - [`mintTokens(npub, amount)`](src/services/cashu.service.js:155) - Create mint quotes and mint tokens from Lightning invoices
  - [`completeMinting(npub, quoteId, amount, transactionId)`](src/services/cashu.service.js:199) - Complete minting process after Lightning payment
  - [`sendTokens(npub, amount, recipientPubkey?)`](src/services/cashu.service.js:270) - Send tokens to another user with optional P2PK locking
  - [`receiveTokens(npub, encodedToken, privateKey?)`](src/services/cashu.service.js:376) - Receive tokens from encoded token strings
  - [`meltTokens(npub, invoice)`](src/services/cashu.service.js:447) - Pay Lightning invoices with tokens (melt operation)
  - [`getBalance(npub)`](src/services/cashu.service.js:566) - Calculate total wallet balance using repository layer
  - [`checkProofStates(npub, proofs?)`](src/services/cashu.service.js:598) - Verify proof states with mint
  - Integrated with existing wallet repository service for database operations
  - Comprehensive error handling and logging for all Cashu operations
  - Support for P2PK (Pay-to-Public-Key) transactions for enhanced security
- **Cashu Wallet Phase 1**: Database Models and Repository Layer
  - [`CashuWallet.model.js`](src/models/CashuWallet.model.js) - MongoDB schema for Cashu wallet storage with npub/mint_url indexing
  - [`CashuToken.model.js`](src/models/CashuToken.model.js) - MongoDB schema for Cashu proof storage with transaction tracking
  - [`walletRepository.service.js`](src/services/walletRepository.service.js) - Complete data access layer with CRUD operations, balance calculations, and proof state management
- Configurable Nostr relay connections via environment variables (`NOSTR_RELAY_MODE`, `NOSTR_LOCAL_RELAYS`, `NOSTR_REMOTE_RELAYS`). This allows switching between local and remote relay sets without code changes.
- Conditional Proof of Work for Nostr events: PoW is now skipped if `NOSTR_RELAY_MODE` is set to `local`, even if `POW_BITS` is configured.
- Environment variable `MINT_URL` for configurable Cashu mint endpoint (defaults to Minibits mint)
