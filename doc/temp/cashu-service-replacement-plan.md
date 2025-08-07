# Cashu Service Replacement Plan

## Current Implementation Analysis

### Key Components in Current cashu.service.js:
1. **Basic imports**: crypto, nostr-tools, @cashu/cashu-ts, walletRepositoryService, logger
2. **Global mint instance**: `let mint = new CashuMint(MINT_URL);`
3. **Basic connectivity testing**: `testMintConnectivity()`
4. **Retry wrapper**: `retryMintOperation()` with exponential backoff
5. **Core functions**:
   - `generateP2PKKeypair()`
   - `checkWalletExists()`
   - `getWalletDetails()`
   - `initializeWallet()` - **INCLUDES KEYSET LOADING FIX**
   - `mintTokens()`
   - `completeMinting()`
   - `sendTokens()`
   - `receiveTokens()`
   - `meltTokens()` - **THIS IS WHERE THE EMPTY ERROR OCCURS**
   - `getBalance()`
   - `checkProofStates()`
   - `startMintPolling()`

### Issues with Current Implementation:
1. **Global mint state** - Uses single global mint instance
2. **Basic error handling** - Limited error details and categorization
3. **No custom fetch implementation** - Missing connectivity fixes
4. **No atomic operations** - Database operations not atomic
5. **No proof state reconciliation** - Missing state consistency checks
6. **Empty error messages** - Poor error handling in melt operations

## Working Implementation Benefits:

### Enhanced Features:
1. **Custom HTTPS Agent**: IPv4 forcing, proper timeouts, keep-alive
2. **Global fetch patching**: Ensures Cashu library uses custom connectivity
3. **Per-request mint instances**: No global state issues
4. **Comprehensive connectivity testing**: Multi-stage diagnostics
5. **Atomic database operations**: State consistency guarantees
6. **Proof state reconciliation**: Automatic state fixing
7. **Enhanced error handling**: Specific error codes and detailed logging
8. **Better polling system**: Cleanup, retry logic, timeout handling

### Missing Dependencies:
The working code imports these services that may not exist:
- `ValidationService` - For input validation
- `MonitoringService` - For metrics and health checks  
- `RecoveryService` - For stuck transaction cleanup

## Implementation Strategy:

### Phase 1: Analysis Complete ✅
- Current implementation analyzed
- Key differences identified
- Missing dependencies noted

### Phase 2: Backup and Replace
- Switch to code mode to make changes
- Create backup of current implementation
- Replace with working version
- Add missing service dependencies

### Phase 3: Dependency Resolution
- Check if ValidationService, MonitoringService, RecoveryService exist
- Create stub implementations if missing
- Ensure all imports resolve correctly

### Phase 4: Testing and Validation
- Test melt operation to verify fix
- Check error handling improvements
- Validate logging enhancements

### Phase 5: Documentation
- Document all changes made
- Update API documentation if needed
- Create migration notes

## Key Improvements Expected:

1. **Fix empty error messages**: Custom fetch and better error handling
2. **Maintain keyset loading**: Working code already includes this fix
3. **Add connectivity diagnostics**: Comprehensive mint testing
4. **Atomic operations**: Database consistency guarantees
5. **State reconciliation**: Automatic proof state fixing
6. **Enhanced monitoring**: Better metrics and health checks

## Next Steps:
1. Switch to code mode for implementation
2. Create backup in appropriate location
3. Replace cashu.service.js with working version
4. Resolve any missing dependencies
5. Test the implementation

## Risk Assessment:
- **Low risk**: Working code is proven and includes our keyset fix
- **Dependencies**: May need to create stub services for missing imports
- **Compatibility**: Should be fully backward compatible
- **Testing**: Need to verify melt operation works correctly

## Success Criteria:
- [ ] Melt operation completes without empty error messages
- [ ] All existing functionality preserved
- [ ] Enhanced error logging and diagnostics available
- [ ] No breaking changes to API
- [ ] Improved connectivity and reliability