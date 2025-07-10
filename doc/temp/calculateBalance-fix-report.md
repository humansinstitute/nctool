# CashuToken.calculateBalance Bug Fix Report

## Issue Fixed

Fixed the wallet balance calculation bug in the [`CashuToken.calculateBalance`](../../src/models/CashuToken.model.js:305) method.

## Problem Description

The `calculateBalance` method incorrectly created a MongoDB query with `status: null` when calculating total balance, causing it to return 0 instead of the correct sum.

**Root Cause**: Line 305 created `const query = { npub, status };` which when `status` is `null` creates a query that matches no documents, since MongoDB looks for documents where the status field is explicitly `null`.

## Solution Implemented

Modified the query construction to conditionally include the status filter only when status is not null:

**Before:**

```javascript
const query = { npub, status };
```

**After:**

```javascript
const query = { npub };
if (status !== null) {
  query.status = status;
}
```

## Testing Results

Created and executed a comprehensive test that verified:

1. ✅ **Total balance calculation with status=null**: Correctly sums all tokens regardless of status (1250 total)
2. ✅ **Unspent balance calculation**: Correctly filters and sums only unspent tokens (1000)
3. ✅ **Spent balance calculation**: Correctly filters and sums only spent tokens (250)
4. ✅ **Pending balance calculation**: Correctly filters and sums only pending tokens (0)
5. ✅ **Empty balance calculation**: Returns 0 for non-existent users

## Impact

- When `status` is `null`, the query becomes `{ npub: "..." }` matching all tokens for the user
- When `status` has a value, the query includes the status filter as before
- Total balance calculation now works correctly for all scenarios
- No breaking changes to existing functionality

## Files Modified

- [`src/models/CashuToken.model.js`](../../src/models/CashuToken.model.js) - Fixed query construction in calculateBalance method
- [`tests/unit/cashuToken.model.test.js`](../../tests/unit/cashuToken.model.test.js) - Added comprehensive tests for calculateBalance method

## Status

✅ **COMPLETED** - Fix implemented and tested successfully
