const mongoose = require("mongoose");
const Transaction = require("../models/transaction_model");
const AppType = require("../models/app_type_model");
const { logger } = require("../middlewares/logger");
require("dotenv").config();

/**
 * Script to update transactions with null app_type
 * by looking up the app_type from metadata.requested_by
 */
async function updateTransactionAppTypes() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log("✅ Connected to MongoDB");
    logger.info("Starting transaction app_type update process");

    // Get all app types for mapping
    const appTypes = await AppType.find({});
    console.log(`📋 Found ${appTypes.length} app types in database`);

    // Create a map of app names to app IDs (case-insensitive)
    const appTypeMap = {};
    appTypes.forEach((app) => {
      appTypeMap[app.name.toLowerCase()] = app._id;
      console.log(`  - ${app.name} => ${app._id}`);
    });

    // Find all transactions with null app_type but with metadata.requested_by
    const transactionsToUpdate = await Transaction.find({
      app_type: null,
      "metadata.requested_by": { $exists: true, $ne: null },
    });

    console.log(
      `\n🔍 Found ${transactionsToUpdate.length} transactions with null app_type but with metadata.requested_by`
    );

    if (transactionsToUpdate.length === 0) {
      console.log("✅ No transactions to update. All done!");
      process.exit(0);
    }

    let successCount = 0;
    let failCount = 0;
    const failedTransactions = [];

    // Update each transaction
    for (const transaction of transactionsToUpdate) {
      const requestedBy = transaction.metadata.requested_by;
      const requestedByLower = requestedBy.toLowerCase().trim();

      // Find matching app_type
      const appTypeId = appTypeMap[requestedByLower];

      if (appTypeId) {
        try {
          await Transaction.updateOne(
            { _id: transaction._id },
            { $set: { app_type: appTypeId } }
          );

          successCount++;
          console.log(
            `✅ Updated transaction ${transaction.transaction_id} (${transaction._id}) - Set app_type to ${requestedBy} (${appTypeId})`
          );
        } catch (error) {
          failCount++;
          failedTransactions.push({
            id: transaction._id,
            transaction_id: transaction.transaction_id,
            requested_by: requestedBy,
            error: error.message,
          });
          console.error(
            `❌ Failed to update transaction ${transaction.transaction_id}:`,
            error.message
          );
        }
      } else {
        failCount++;
        failedTransactions.push({
          id: transaction._id,
          transaction_id: transaction.transaction_id,
          requested_by: requestedBy,
          error: "App type not found",
        });
        console.warn(
          `⚠️  No matching app_type found for "${requestedBy}" in transaction ${transaction.transaction_id}`
        );
      }
    }

    // Summary
    console.log("\n" + "=".repeat(60));
    console.log("📊 UPDATE SUMMARY");
    console.log("=".repeat(60));
    console.log(`Total transactions processed: ${transactionsToUpdate.length}`);
    console.log(`✅ Successfully updated: ${successCount}`);
    console.log(`❌ Failed to update: ${failCount}`);

    if (failedTransactions.length > 0) {
      console.log("\n❌ Failed transactions:");
      failedTransactions.forEach((ft) => {
        console.log(
          `  - ${ft.transaction_id} (${ft.id}): requested_by="${ft.requested_by}" - ${ft.error}`
        );
      });
    }

    logger.info("Transaction app_type update process completed", {
      total: transactionsToUpdate.length,
      success: successCount,
      failed: failCount,
    });

    console.log("\n✅ Update process completed!");
    process.exit(0);
  } catch (error) {
    console.error("❌ Error during update process:", error);
    logger.error("Error updating transaction app_types", {
      error: error.message,
      stack: error.stack,
    });
    process.exit(1);
  } finally {
    await mongoose.connection.close();
  }
}

// Run the script
updateTransactionAppTypes();
