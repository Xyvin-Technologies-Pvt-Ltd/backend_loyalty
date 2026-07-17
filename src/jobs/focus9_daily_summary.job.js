const { logger } = require("../middlewares/logger");
const moment = require("moment-timezone");
const Transaction = require("../models/transaction_model");
const Focus9DailySummary = require("../models/focus9_daily_summary_model");
const JobExecutionLog = require("../models/job_execution_log_model");

const OMAN_TIMEZONE = "Asia/Muscat";
const POINTS_TO_OMR = 1000; // 1000 points = 1 OMR

/**
 * Convert points to OMR amount
 * @param {Number} points - Points value (can be positive or negative)
 * @returns {Number} - OMR amount (always positive)
 */
function pointsToOMR(points) {
  return Math.abs(points) / POINTS_TO_OMR;
}

/**
 * Normalize requested_by value to standard format
 * @param {String} requestedBy - The requested_by value from metadata
 * @returns {String} - Normalized value: "Khedmah App", "Khedmah Delivery", or null
 */
function normalizeRequestedBy(requestedBy) {
  if (!requestedBy) return null;

  const normalized = String(requestedBy).trim();

  // Check for Khedmah App variations
  if (
    normalized.toLowerCase().includes("khedmah app") ||
    normalized.toLowerCase() === "khedmah app" ||
    normalized.toLowerCase() === "app"
  ) {
    return "Khedmah App";
  }

  // Check for Khedmah Delivery variations
  if (
    normalized.toLowerCase().includes("khedmah delivery") ||
    normalized.toLowerCase().includes("delivery") ||
    normalized.toLowerCase() === "khedmah delivery"
  ) {
    return "Khedmah Delivery";
  }

  // Default to Khedmah App if it contains "khedmah" but not delivery
  if (normalized.toLowerCase().includes("khedmah")) {
    return "Khedmah App";
  }

  return null;
}

/**
 * Detect redeem-cancellation adjust transactions
 */
function isRedeemCancellation(transaction) {
  return Boolean(
    transaction.metadata?.cancellation_triggered_by ||
      (transaction.transaction_id &&
        String(transaction.transaction_id).endsWith("_cancelled"))
  );
}

/**
 * Apply an OMR amount to the correct App/Delivery bucket on the summary object
 */
function applyAmountToBucket(summary, requestedBy, fieldPrefix, omrAmount) {
  if (requestedBy === "Khedmah App") {
    summary[`khedmah_app_${fieldPrefix}`] += omrAmount;
    summary.khedmahAppCount++;
  } else if (requestedBy === "Khedmah Delivery") {
    summary[`khedmah_delivery_${fieldPrefix}`] += omrAmount;
    summary.khedmahDeliveryCount++;
  } else {
    summary.otherCount++;
    summary[`khedmah_app_${fieldPrefix}`] += omrAmount;
  }
}

/**
 * Build lookup maps for original transactions (expire/adjust source resolution)
 */
async function buildOriginalTransactionLookups(transactions) {
  const referenceIds = [
    ...new Set(
      transactions
        .filter((tx) => tx.transaction_type === "expire" && tx.reference_id)
        .map((tx) => String(tx.reference_id))
    ),
  ];

  const originalTxIds = [
    ...new Set(
      transactions
        .filter(
          (tx) =>
            tx.transaction_type === "adjust" &&
            tx.metadata?.original_transaction_id
        )
        .map((tx) => tx.metadata.original_transaction_id)
    ),
  ];

  const originalById = new Map();
  const originalByTxId = new Map();

  if (referenceIds.length) {
    const originals = await Transaction.find({ _id: { $in: referenceIds } })
      .select("metadata.requested_by")
      .lean();
    for (const doc of originals) {
      originalById.set(String(doc._id), doc);
    }
  }

  if (originalTxIds.length) {
    const originals = await Transaction.find({
      transaction_id: { $in: originalTxIds },
    })
      .select("transaction_id metadata.requested_by")
      .lean();
    for (const doc of originals) {
      originalByTxId.set(doc.transaction_id, doc);
    }
  }

  return { originalById, originalByTxId };
}

/**
 * Resolve requested_by using original transaction for expire/adjust rows
 */
function resolveEffectiveRequestedBy(transaction, originalById, originalByTxId) {
  const transactionType = transaction.transaction_type;

  if (transactionType === "expire" && transaction.reference_id) {
    const original = originalById.get(String(transaction.reference_id));
    if (original?.metadata?.requested_by) {
      return original.metadata.requested_by;
    }
  }

  if (transactionType === "adjust" && transaction.metadata?.original_transaction_id) {
    const original = originalByTxId.get(transaction.metadata.original_transaction_id);
    if (original?.metadata?.requested_by) {
      return original.metadata.requested_by;
    }
  }

  return transaction.metadata?.requested_by ?? null;
}

/**
 * Generate daily summary for Focus9 integration
 * Aggregates all transactions (additions, expirations, redemptions) for the day
 * and groups them by Khedmah App and Khedmah Delivery
 * Runs daily at 11:59 PM Oman time
 */
async function generateFocus9DailySummary(jobType = "daily", targetDate = null) {
  const startedAt = new Date();
  let executionLog = null;

  try {
    // Create execution log entry
    executionLog = await JobExecutionLog.create({
      jobName: "focus9_daily_summary",
      jobType: jobType,
      startedAt: startedAt,
      status: "running",
      metrics: {
        totalTransactions: 0,
        khedmahAppTransactions: 0,
        khedmahDeliveryTransactions: 0,
        otherTransactions: 0,
      },
    });

    logger.info("Starting Focus9 daily summary generation", {
      executionLogId: executionLog._id,
    });

    // Get the target date in Oman timezone (start of day)
    const now = targetDate
      ? moment.tz(targetDate, "YYYY-MM-DD", OMAN_TIMEZONE)
      : moment().tz(OMAN_TIMEZONE);
    const startOfDay = now.clone().startOf("day").toDate();
    const endOfDay = now.clone().endOf("day").toDate();

    logger.info(
      `Processing transactions for date: ${now.format("YYYY-MM-DD")} (Oman time)`,
      {
        startOfDay: startOfDay.toISOString(),
        endOfDay: endOfDay.toISOString(),
      }
    );

    // Fetch all completed transactions for the day
    const dailyTransactions = await Transaction.find({
      transaction_date: { $gte: startOfDay, $lte: endOfDay },
      status: "completed",
      transaction_type: { $in: ["earn", "expire", "redeem", "adjust"] },
    }).lean();

    logger.info(`Found ${dailyTransactions.length} transactions to process`);

    const { originalById, originalByTxId } =
      await buildOriginalTransactionLookups(dailyTransactions);

    // Initialize summary object
    const summary = {
      khedmah_app_addition_amt: 0,
      khedmah_app_expired_amt: 0,
      khedmah_app_redeemed_amt: 0,
      khedmah_delivery_addition_amt: 0,
      khedmah_delivery_expired_amt: 0,
      khedmah_delivery_redeemed_amt: 0,
      khedmah_app_redeem_cancellation_amt: 0,
      khedmah_delivery_redeem_cancellation_amt: 0,
      khedmah_app_manual_addition_amt: 0,
      khedmah_delivery_manual_addition_amt: 0,
      khedmah_app_manual_reduction_amt: 0,
      khedmah_delivery_manual_reduction_amt: 0,
      total_transactions_processed: dailyTransactions.length,
      khedmahAppCount: 0,
      khedmahDeliveryCount: 0,
      otherCount: 0,
    };

    // Process each transaction
    for (const transaction of dailyTransactions) {
      const effectiveRequestedBy = normalizeRequestedBy(
        resolveEffectiveRequestedBy(transaction, originalById, originalByTxId)
      );
      const points = transaction.points;
      const transactionType = transaction.transaction_type;
      const omrAmount = pointsToOMR(points);

      if (transactionType === "adjust") {
        if (isRedeemCancellation(transaction)) {
          applyAmountToBucket(
            summary,
            effectiveRequestedBy,
            "redeem_cancellation_amt",
            omrAmount
          );
        } else if (points > 0) {
          applyAmountToBucket(
            summary,
            effectiveRequestedBy,
            "manual_addition_amt",
            omrAmount
          );
        } else if (points < 0) {
          applyAmountToBucket(
            summary,
            effectiveRequestedBy,
            "manual_reduction_amt",
            omrAmount
          );
        }
        continue;
      }

      // Determine which category this transaction belongs to
      if (effectiveRequestedBy === "Khedmah App") {
        summary.khedmahAppCount++;

        if (transactionType === "earn") {
          summary.khedmah_app_addition_amt += omrAmount;
        } else if (transactionType === "expire") {
          summary.khedmah_app_expired_amt += omrAmount;
        } else if (transactionType === "redeem") {
          summary.khedmah_app_redeemed_amt += omrAmount;
        }
      } else if (effectiveRequestedBy === "Khedmah Delivery") {
        summary.khedmahDeliveryCount++;

        if (transactionType === "earn") {
          summary.khedmah_delivery_addition_amt += omrAmount;
        } else if (transactionType === "expire") {
          summary.khedmah_delivery_expired_amt += omrAmount;
        } else if (transactionType === "redeem") {
          summary.khedmah_delivery_redeemed_amt += omrAmount;
        }
      } else {
        summary.otherCount++;
        // Transactions without requested_by or with unknown values
        // Default to Khedmah App for now (can be adjusted based on business logic)
        if (transactionType === "earn") {
          summary.khedmah_app_addition_amt += omrAmount;
        } else if (transactionType === "expire") {
          summary.khedmah_app_expired_amt += omrAmount;
        } else if (transactionType === "redeem") {
          summary.khedmah_app_redeemed_amt += omrAmount;
        }
      }
    }

    // Round amounts to 3 decimal places (for baisa precision: 1 point = 1 baisa = 0.001 OMR)
    const roundToThreeDecimals = (num) => Math.round(num * 1000) / 1000;

    // Create or update the daily summary record
    const summaryDate = startOfDay; // Use start of day as the date key

    const dailySummary = await Focus9DailySummary.findOneAndUpdate(
      { date: summaryDate },
      {
        date: summaryDate,
        khedmah_app_addition_amt: roundToThreeDecimals(
          summary.khedmah_app_addition_amt
        ),
        khedmah_app_expired_amt: roundToThreeDecimals(
          summary.khedmah_app_expired_amt
        ),
        khedmah_app_redeemed_amt: roundToThreeDecimals(
          summary.khedmah_app_redeemed_amt
        ),
        khedmah_delivery_addition_amt: roundToThreeDecimals(
          summary.khedmah_delivery_addition_amt
        ),
        khedmah_delivery_expired_amt: roundToThreeDecimals(
          summary.khedmah_delivery_expired_amt
        ),
        khedmah_delivery_redeemed_amt: roundToThreeDecimals(
          summary.khedmah_delivery_redeemed_amt
        ),
        khedmah_app_redeem_cancellation_amt: roundToThreeDecimals(
          summary.khedmah_app_redeem_cancellation_amt
        ),
        khedmah_delivery_redeem_cancellation_amt: roundToThreeDecimals(
          summary.khedmah_delivery_redeem_cancellation_amt
        ),
        khedmah_app_manual_addition_amt: roundToThreeDecimals(
          summary.khedmah_app_manual_addition_amt
        ),
        khedmah_delivery_manual_addition_amt: roundToThreeDecimals(
          summary.khedmah_delivery_manual_addition_amt
        ),
        khedmah_app_manual_reduction_amt: roundToThreeDecimals(
          summary.khedmah_app_manual_reduction_amt
        ),
        khedmah_delivery_manual_reduction_amt: roundToThreeDecimals(
          summary.khedmah_delivery_manual_reduction_amt
        ),
        posting_flag: 0,
        total_transactions_processed: summary.total_transactions_processed,
        summary_generated_at: new Date(),
        sql_synced: false,
        sql_synced_at: null,
        sql_sync_error: null,
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      }
    );

    // Update execution log with results
    const completedAt = new Date();
    const duration = completedAt - startedAt;

    executionLog.status = "completed";
    executionLog.completedAt = completedAt;
    executionLog.duration = duration;
    executionLog.metrics.totalTransactions = summary.total_transactions_processed;
    executionLog.metrics.khedmahAppTransactions = summary.khedmahAppCount;
    executionLog.metrics.khedmahDeliveryTransactions =
      summary.khedmahDeliveryCount;
    executionLog.metrics.otherTransactions = summary.otherCount;
    executionLog.details = {
      summaryId: dailySummary._id.toString(),
      date: summaryDate.toISOString(),
      khedmahApp: {
        addition: summary.khedmah_app_addition_amt,
        expired: summary.khedmah_app_expired_amt,
        redeemed: summary.khedmah_app_redeemed_amt,
        redeemCancellation: summary.khedmah_app_redeem_cancellation_amt,
        manualAddition: summary.khedmah_app_manual_addition_amt,
        manualReduction: summary.khedmah_app_manual_reduction_amt,
      },
      khedmahDelivery: {
        addition: summary.khedmah_delivery_addition_amt,
        expired: summary.khedmah_delivery_expired_amt,
        redeemed: summary.khedmah_delivery_redeemed_amt,
        redeemCancellation: summary.khedmah_delivery_redeem_cancellation_amt,
        manualAddition: summary.khedmah_delivery_manual_addition_amt,
        manualReduction: summary.khedmah_delivery_manual_reduction_amt,
      },
    };

    await executionLog.save();

    logger.info(
      `Successfully generated Focus9 daily summary for ${now.format("YYYY-MM-DD")}`,
      {
        executionLogId: executionLog._id,
        summaryId: dailySummary._id,
        duration: `${duration}ms`,
        totals: {
          khedmahApp: {
            addition: summary.khedmah_app_addition_amt,
            expired: summary.khedmah_app_expired_amt,
            redeemed: summary.khedmah_app_redeemed_amt,
            redeemCancellation: summary.khedmah_app_redeem_cancellation_amt,
            manualAddition: summary.khedmah_app_manual_addition_amt,
            manualReduction: summary.khedmah_app_manual_reduction_amt,
          },
          khedmahDelivery: {
            addition: summary.khedmah_delivery_addition_amt,
            expired: summary.khedmah_delivery_expired_amt,
            redeemed: summary.khedmah_delivery_redeemed_amt,
            redeemCancellation: summary.khedmah_delivery_redeem_cancellation_amt,
            manualAddition: summary.khedmah_delivery_manual_addition_amt,
            manualReduction: summary.khedmah_delivery_manual_reduction_amt,
          },
        },
      }
    );

    return dailySummary;
  } catch (error) {
    // Handle unexpected errors
    const completedAt = new Date();
    const duration = completedAt - startedAt;

    if (executionLog) {
      executionLog.status = "failed";
      executionLog.completedAt = completedAt;
      executionLog.duration = duration;
      executionLog.error = {
        message: error.message,
        stack: error.stack,
        code: error.code || "UNKNOWN_ERROR",
      };
      await executionLog.save();
    }

    logger.error("Error in Focus9 daily summary generation:", {
      error: error.message,
      stack: error.stack,
      executionLogId: executionLog?._id,
    });
    throw error;
  }
}

module.exports = {
  generateFocus9DailySummary,
};

