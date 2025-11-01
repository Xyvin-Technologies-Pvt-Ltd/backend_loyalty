# Transaction App Type Update Guide

## Overview

This guide explains how to update transactions that have `null` values for the `app_type` field by using the `metadata.requested_by` field to look up the correct app type.

## Problem

In the loyalty system:
- **Redeem transactions** have the `app_type` field set correctly during creation
- **Earn transactions** were created **without** the `app_type` field (it's `null`)
- However, earn transactions DO have `metadata.requested_by` which contains the app name (e.g., "Khedmah", "Khedmah Delivery")

This causes issues when generating reports that segment data by app type.

## Solution

We've created two ways to update transaction app types:

### 1. Via API (Recommended for Production)

**Endpoint:** `POST /api/reports/update-transaction-app-types`

**Permissions Required:** `MANAGE_TRANSACTIONS` or `SUPER_ADMIN`

**How it works:**
1. Fetches all app types from the database
2. Finds all transactions with `app_type: null` but with `metadata.requested_by` populated
3. Matches `metadata.requested_by` (case-insensitive) to app type names
4. Updates the transaction's `app_type` field with the correct ObjectId
5. Returns statistics about the update

**Frontend Access:**
- Navigate to **Reports** page in the admin dashboard
- Scroll to **Data Maintenance** section
- Click **Update Now** button
- Confirm the action

**Response Format:**
```json
{
  "success": true,
  "message": "Successfully updated X out of Y transactions",
  "data": {
    "total": 150,
    "success": 148,
    "failed": 2,
    "updates": [...],
    "failed_transactions": [...]
  }
}
```

### 2. Via Script (For Initial Bulk Updates)

**Script Location:** `src/scripts/update-transaction-app-types.js`

**How to run:**
```bash
cd loyalty-backend
node src/scripts/update-transaction-app-types.js
```

**Requirements:**
- MongoDB connection string in `.env` file
- Proper `MONGODB_URI` environment variable

**Output:**
The script provides detailed console output showing:
- Connected app types
- Progress of each transaction update
- Success/failure statistics
- List of failed transactions with reasons

## How It Works

### Matching Logic

1. Script fetches all `AppType` documents from the database
2. Creates a lowercase mapping: `{ "khedmah": ObjectId(...), "khedmah delivery": ObjectId(...) }`
3. For each transaction with `null` app_type:
   - Gets `metadata.requested_by` value
   - Converts to lowercase and trims whitespace
   - Looks up the matching app type ObjectId
   - Updates the transaction if found

### Example

**Before:**
```javascript
{
  _id: ObjectId("..."),
  transaction_type: "earn",
  points: 50,
  app_type: null,  // ❌ null
  metadata: {
    requested_by: "Khedmah"  // ✅ Has app name
  }
}
```

**After:**
```javascript
{
  _id: ObjectId("..."),
  transaction_type: "earn",
  points: 50,
  app_type: ObjectId("67cdc114f68923d1a0e2ce26"),  // ✅ Updated!
  metadata: {
    requested_by: "Khedmah"
  }
}
```

## Error Handling

### Common Errors

1. **App Type Not Found**
   - Occurs when `metadata.requested_by` doesn't match any app type name
   - Check for typos or variations in naming
   - Verify app types exist in the database

2. **metadata.requested_by Missing**
   - Transaction has `null` app_type but no `metadata.requested_by`
   - These transactions will be skipped
   - Manual intervention may be required

## Verification

After running the update, verify the results:

### Check Updated Transactions
```javascript
// In MongoDB
db.transactions.find({ 
  app_type: { $ne: null },
  "metadata.requested_by": { $exists: true }
}).count()
```

### Check Remaining Null App Types
```javascript
// In MongoDB
db.transactions.find({ 
  app_type: null,
  "metadata.requested_by": { $exists: true }
}).count()
```

### Generate Test Report
1. Go to Reports page
2. Generate a Points Activity Report
3. Verify that data appears in both Khedmah and Khedmah Delivery columns

## Best Practices

1. **Backup First**: Always backup your database before running bulk updates
2. **Test on Staging**: Run on staging environment first
3. **Check Results**: Review the output/logs carefully
4. **Run Once**: This is typically a one-time migration
5. **Monitor Reports**: After update, verify reports show correct data

## Preventing Future Issues

To prevent this issue in future transactions, ensure that when creating earn transactions, the `app_type` field is set:

**Update the earn transaction creation** (in `new_kedmah_sdk.controller.js`):

```javascript
// Find the app type
const appType = await AppType.findOne({ name: requested_by });

// Create transaction with app_type
const transaction = await Transaction.create({
  customer_id: customer._id,
  transaction_type: "earn",
  points: totalPoints,
  app_type: appType?._id,  // ✅ Add this!
  metadata: {
    requested_by: requested_by,
    // ... other metadata
  }
});
```

## Audit Trail

All updates via the API are logged in the audit trail with:
- Action: `update_transaction_app_types`
- Target Model: `Transaction`
- Admin user who triggered the update
- Timestamp

## Troubleshooting

### Issue: "App type not found in database"
**Solution:** Check app type names:
```javascript
// List all app types
db.app_types.find({}, { name: 1 })
```

### Issue: Script hangs or times out
**Solution:** 
- Check MongoDB connection
- Verify network connectivity
- Check if database is accessible

### Issue: Permission denied
**Solution:**
- Verify user has `MANAGE_TRANSACTIONS` or `SUPER_ADMIN` permission
- Check authentication token is valid

## Summary

This utility is essential for ensuring accurate reporting in the loyalty system. It bridges the gap between older transactions (without `app_type`) and the current reporting requirements. Run it once to migrate historical data, then ensure new transactions always include the `app_type` field.

