/**
 * One-time migration: set adjust (cancellation) transactions' metadata.requested_by
 * from the original redemption transaction, for correct accounting.
 *
 * Targets: transaction_type === "adjust" AND metadata.requested_by === "Khedmah SDK"
 * and metadata.original_transaction_id exists. Updates requested_by to the original
 * transaction's metadata.requested_by (fallback "Khedmah SDK") and sets
 * metadata.cancellation_triggered_by to "Khedmah SDK".
 *
 * Usage:
 *   node src/seeds/migrate_adjust_requested_by.js         # run migration
 *   node src/seeds/migrate_adjust_requested_by.js --preview  # dry run
 */

const Transaction = require("../models/transaction_model");
const { connectDatabase, disconnectDatabase } = require("../config/database");
const { logger } = require("../middlewares/logger");

async function previewMigration() {
  const startedAt = new Date();
  let successCount = 0;
  let skippedCount = 0;
  const skippedReasons = { noOriginal: 0, noRequestedBy: 0 };

  await connectDatabase();
  logger.info("=".repeat(60));
  logger.info("PREVIEW MODE - No changes will be made");
  logger.info("=".repeat(60));

  const adjustTransactions = await Transaction.find({
    transaction_type: "adjust",
    "metadata.requested_by": "Khedmah SDK",
    "metadata.original_transaction_id": { $exists: true, $ne: null },
  })
    .lean();

  logger.info(`Found ${adjustTransactions.length} adjust transactions to analyze`);

  if (adjustTransactions.length === 0) {
    logger.info("No adjust transactions found that need migration");
    await disconnectDatabase();
    return { total: 0, success: 0, skipped: 0, skippedReasons: {} };
  }

  for (let i = 0; i < adjustTransactions.length; i++) {
    const adjustTx = adjustTransactions[i];
    const originalTxId = adjustTx.metadata?.original_transaction_id;
    console.log("originalTxId", originalTxId);
    if (!originalTxId) {
      skippedCount++;
      skippedReasons.noOriginal++;
      continue;
    }

    const original = await Transaction.findOne({
      transaction_id: originalTxId,
      transaction_type: "redeem",
    }).lean();

    if (!original) {
      skippedCount++;
      skippedReasons.noOriginal++;
      continue;
    }

    const newRequestedBy = original.metadata?.requested_by || "Khedmah SDK";
    console.log("newRequestedBy", newRequestedBy);
    if (newRequestedBy === "Khedmah SDK") {
      skippedCount++;
      skippedReasons.noRequestedBy++;
      continue;
    }

    successCount++;
  }

  const duration = Date.now() - startedAt;
  logger.info("=".repeat(60));
  logger.info("Preview Summary:");
  logger.info(`Total adjust transactions: ${adjustTransactions.length}`);
  logger.info(`Would update: ${successCount}`);
  logger.info(`Would skip: ${skippedCount}`);
  logger.info(`Skipped (no original): ${skippedReasons.noOriginal}`);
  logger.info(`Skipped (original has no requested_by): ${skippedReasons.noRequestedBy}`);
  logger.info(`Duration: ${duration}ms`);
  logger.info("=".repeat(60));

  await disconnectDatabase();
  return {
    total: adjustTransactions.length,
    success: successCount,
    skipped: skippedCount,
    skippedReasons,
  };
}

async function migrateAdjustRequestedBy() {
  const startedAt = new Date();
  let successCount = 0;
  let errorCount = 0;
  let skippedCount = 0;
  const errors = [];
  const skippedReasons = { noOriginal: 0, noRequestedBy: 0 };

  await connectDatabase();
  logger.info("=".repeat(60));
  logger.info("Migration: Fix adjust transactions requested_by from original");
  logger.info("=".repeat(60));

  const adjustTransactions = await Transaction.find({
    transaction_type: "adjust",
    "metadata.requested_by": "Khedmah SDK",
    "metadata.original_transaction_id": { $exists: true, $ne: null },
  });

  logger.info(`Found ${adjustTransactions.length} adjust transactions`);

  if (adjustTransactions.length === 0) {
    logger.info("No adjust transactions to migrate");
    await disconnectDatabase();
    return { total: 0, success: 0, failed: 0, skipped: 0 };
  }

  for (let i = 0; i < adjustTransactions.length; i++) {
    const adjustTx = adjustTransactions[i];
    const progress = `[${i + 1}/${adjustTransactions.length}]`;
    const originalTxId = adjustTx.metadata?.original_transaction_id;

    if (!originalTxId) {
      skippedCount++;
      skippedReasons.noOriginal++;
      continue;
    }

    const original = await Transaction.findOne({
      transaction_id: originalTxId,
      transaction_type: "redeem",
    }).lean();

    if (!original) {
      skippedCount++;
      skippedReasons.noOriginal++;
      continue;
    }

    const newRequestedBy = original.metadata?.requested_by || "Khedmah SDK";
    if (newRequestedBy === "Khedmah SDK") {
      skippedCount++;
      skippedReasons.noRequestedBy++;
      continue;
    }

    try {
      await Transaction.findByIdAndUpdate(adjustTx._id, {
        $set: {
          "metadata.requested_by": newRequestedBy,
          "metadata.cancellation_triggered_by": "Khedmah SDK",
        },
      });
      successCount++;
      if ((i + 1) % 50 === 0) {
        logger.info(`${progress} Updated ${successCount}, skipped ${skippedCount}`);
      }
    } catch (error) {
      errorCount++;
      errors.push({
        adjustId: adjustTx._id.toString(),
        originalTxId,
        message: error.message,
      });
      logger.error(`${progress} Error updating ${adjustTx._id}:`, {
        error: error.message,
      });
    }
  }

  const duration = Date.now() - startedAt;
  logger.info("=".repeat(60));
  logger.info("Migration Summary:");
  logger.info(`Total: ${adjustTransactions.length}`);
  logger.info(`Updated: ${successCount}`);
  logger.info(`Failed: ${errorCount}`);
  logger.info(`Skipped: ${skippedCount}`);
  logger.info(`Duration: ${duration}ms`);
  logger.info("=".repeat(60));

  if (errors.length > 0) {
    logger.warn(`First 10 errors:`);
    errors.slice(0, 10).forEach((err, idx) => {
      logger.warn(`${idx + 1}. ${err.adjustId}: ${err.message}`);
    });
  }

  await disconnectDatabase();
  logger.info("Database disconnected");
  return {
    total: adjustTransactions.length,
    success: successCount,
    failed: errorCount,
    skipped: skippedCount,
  };
}

if (require.main === module) {
  const isPreview = process.argv.includes("--preview") || process.argv.includes("-p");

  const run = isPreview ? previewMigration() : migrateAdjustRequestedBy();

  run
    .then(() => {
      logger.info("Script finished");
      process.exit(0);
    })
    .catch((err) => {
      logger.error("Script failed:", err);
      process.exit(1);
    });
}

module.exports = { migrateAdjustRequestedBy, previewMigration };
