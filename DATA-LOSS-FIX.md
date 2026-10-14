# Data Loss Bug Fix - User ID 1338852193

## Problem Identified

**Date**: 2026-10-12
**User Affected**: User ID `1338852193`
**Tabs Affected**: `Dashboard 281c` and `Transactions 281c`

### Root Cause

Pre-existing bug in `syncUserTransactionsToMaster()` and `syncUserRecurringToMaster()` functions in `lib/sheets.ts` (lines 370-420 and 470-520):

1. **Destructive clear without safety checks**: Functions execute `sheets.spreadsheets.values.clear()` on master tab BEFORE validating that merged data is complete
2. **Filter failure**: If `userId` filtering fails (whitespace, null, or format issues), all data gets filtered out
3. **No rollback mechanism**: Once `clear()` is executed, data is permanently lost if the subsequent `update()` fails or contains empty `mergedRows`

### Code Pattern (Before Fix)

```typescript
// DANGEROUS: Clear master data first
const otherUsers = (masterData.data.values || []).filter((row) => 
  String(row[1] ?? '').trim() !== userId
);
const mergedRows = [...otherUsers, ...userRows];

// If mergedRows is empty due to filter bug, all data is lost!
await sheets.spreadsheets.values.clear({ spreadsheetId, range: 'transactions!A2:J' });
if (mergedRows.length) {
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: 'transactions!A2',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: mergedRows }
  });
}
```

## Solution Implemented

### Safety Checks Added

1. **Pre-filter validation**: Log before/after filter counts to detect data loss
2. **Destructive operation blocking**: Prevent `clear()` if `mergedRows` is empty when `masterRows` had data
3. **Detailed logging**: Console warnings for debugging future issues
4. **Filter robustness**: Check for empty strings in `userId` field

### Code Pattern (After Fix)

```typescript
const masterRows = masterData.data.values || [];

// SAFETY CHECK: Log filtering for debugging
const beforeFilterCount = masterRows.length;
const otherUsers = masterRows.filter((row) => {
  const rowUserId = String(row[1] ?? '').trim();
  return rowUserId !== '' && rowUserId !== userId;
});
const afterFilterCount = otherUsers.length;

// Log if data loss detected
if (beforeFilterCount > 0 && afterFilterCount + userDataInMaster.length < beforeFilterCount) {
  console.warn(`[syncUserTransactions] Potential data loss detected`, {
    beforeFilter: beforeFilterCount,
    afterFilter: afterFilterCount,
    userDataInMaster: userDataInMaster.length,
    missing: beforeFilterCount - afterFilterCount - userDataInMaster.length
  });
}

const mergedRows = [...otherUsers, ...userRows];

// SAFETY CHECK: Block destructive clear if data would be lost
if (mergedRows.length === 0 && masterRows.length > 0) {
  console.error(`[syncUserTransactions] BLOCKED: Attempted to clear all data. This would cause data loss.`);
  return false;
}

// Now safe to clear and update
await sheets.spreadsheets.values.clear({ spreadsheetId, range: 'transactions!A2:J' });
if (mergedRows.length) {
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: 'transactions!A2',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: mergedRows }
  });
}
```

## Data Recovery Options

### Option 1: Google Sheets Version History (Recommended)

1. Open the Google Spreadsheet
2. Go to **File → Version history → See version history**
3. Look for versions BEFORE the data loss occurred
4. Identify the timestamp when data was still present for user `1338852193`
5. Either:
   - **Restore entire sheet**: Click "Restore this version"
   - **Manual copy**: Open old version in new tab, copy affected rows, paste back into current version

### Option 2: Git History Recovery

If data was committed to git at any point:

```bash
# Check git history for sheets data backup
git log --all --full-history -- "lib/sheets.ts"

# Show file content at specific commit
git show <commit-hash>:lib/sheets.ts

# If there's a backup file or data dump
git log --all --full-history -- "**/backup*" "**/data*"
```

### Option 3: Application Logs

Check Vercel deployment logs or local console logs for:
- API calls that recorded transactions for user `1338852193`
- Webhook payloads from WhatsApp/Telegram
- Raw message data that can be re-parsed

### Option 4: Message Source Re-processing

If original WhatsApp/Telegram messages are still available:
1. Retrieve message history for user `1338852193`
2. Re-send messages to `/api/simulate` endpoint with `simulate=true` parameter
3. Bot will re-parse and re-create transactions

## Prevention Measures

### Implemented in Fix

✅ Safety checks before destructive operations  
✅ Detailed logging for debugging  
✅ Filter validation and warnings  
✅ Blocking mechanism for dangerous clears  

### Recommended Additional Measures

1. **Backup mechanism**: Implement daily exports of master tabs to separate backup sheets
2. **Atomic transactions**: Use Google Sheets API batch update with rollback capability
3. **Data validation**: Add data integrity checks before/after sync operations
4. **Alert system**: Send notifications when data loss is detected (via Telegram/email)
5. **Rate limiting**: Add delays between sync operations to prevent race conditions

## Testing Fix

### Unit Test Scenarios

1. **Normal sync**: User with data, filter succeeds, sync completes
2. **Empty user tab**: User tab empty, master has other users, should preserve other users
3. **Filter failure**: User ID format mismatch, should BLOCK clear operation
4. **Empty master**: Master empty, user tab has data, should write user data
5. **Mixed data**: Multiple users, partial user data, should preserve all correctly

### Manual Test Script

```typescript
// Test file: scripts/test-sync-safety.mjs
import { getSheetsClient } from '../lib/sheets.js';

async function testSyncSafety() {
  const client = getSheetsClient();
  const testUserId = '1338852193';
  
  // 1. Check current state
  const before = await client.sheets.spreadsheets.values.get({
    spreadsheetId: client.sheetId,
    range: 'transactions!A2:J'
  });
  console.log('Before sync:', before.data.values?.length || 0, 'rows');
  
  // 2. Trigger sync
  await syncUserTransactionsToMaster(client.sheets, client.sheetId, testUserId);
  
  // 3. Verify data preserved
  const after = await client.sheets.spreadsheets.values.get({
    spreadsheetId: client.sheetId,
    range: 'transactions!A2:J'
  });
  console.log('After sync:', after.data.values?.length || 0, 'rows');
  
  // 4. Assert no data loss
  const beforeCount = before.data.values?.length || 0;
  const afterCount = after.data.values?.length || 0;
  
  if (afterCount < beforeCount) {
    console.error('❌ DATA LOSS DETECTED!', {
      before: beforeCount,
      after: afterCount,
      lost: beforeCount - afterCount
    });
  } else {
    console.log('✅ Data preserved successfully');
  }
}

testSyncSafety().catch(console.error);
```

## Deployment Notes

### Pre-Deployment Checklist

- [x] Code fix implemented in `lib/sheets.ts`
- [x] Build verification passed (`npm run build` succeeded)
- [x] TypeScript compilation passed with no errors
- [ ] Backup current Google Sheets data
- [ ] Test on staging environment
- [ ] Deploy to production
- [ ] Monitor logs for safety check warnings
- [ ] Verify user `1338852193` data is restored

### Post-Deployment Monitoring

Monitor console logs for these patterns:

```
[syncUserTransactions] Potential data loss detected
[syncUserTransactions] BLOCKED: Attempted to clear all data
[syncUserRecurring] Potential data loss detected
[syncUserRecurring] BLOCKED: Attempted to clear all data
```

If you see `BLOCKED` messages:
1. This is **GOOD** - the safety check prevented data loss
2. Investigate the root cause (filter logic, user ID format, etc.)
3. Fix the underlying issue before allowing sync to proceed

## Contact & Support

For questions or issues related to this fix:
- Check deployment logs: `vercel logs --follow`
- Review Google Sheets version history
- Test with simulate endpoint: `/api/simulate?userId=1338852193&message=test`

---

**Fix Status**: ✅ Implemented and build verified  
**Deployment Status**: ⏳ Pending user data recovery confirmation  
**Next Steps**: Recover user 1338852193 data from Google Sheets version history
