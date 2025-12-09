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
 * Generate daily summary for Focus9 integration
 * Aggregates all transactions (additions, expirations, redemptions) for the day
 * and groups them by Khedmah App and Khedmah Delivery
 * Runs daily at 11:59 PM Oman time
 */
async function generateFocus9DailySummary(jobType = "daily") {
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

    // Get the current date in Oman timezone (start of day)
    const now = moment().tz(OMAN_TIMEZONE);
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
      transaction_type: { $in: ["earn", "expire", "redeem"] },
    }).lean();

    logger.info(`Found ${dailyTransactions.length} transactions to process`);

    // Initialize summary object
    const summary = {
      khedmah_app_addition_amt: 0,
      khedmah_app_expired_amt: 0,
      khedmah_app_redeemed_amt: 0,
      khedmah_delivery_addition_amt: 0,
      khedmah_delivery_expired_amt: 0,
      khedmah_delivery_redeemed_amt: 0,
      total_transactions_processed: dailyTransactions.length,
      khedmahAppCount: 0,
      khedmahDeliveryCount: 0,
      otherCount: 0,
    };

    // Process each transaction
    for (const transaction of dailyTransactions) {
      const requestedBy = normalizeRequestedBy(
        transaction.metadata?.requested_by
      );
      const points = transaction.points;
      const transactionType = transaction.transaction_type;
      const omrAmount = pointsToOMR(points);

      // Determine which category this transaction belongs to
      if (requestedBy === "Khedmah App") {
        summary.khedmahAppCount++;

        if (transactionType === "earn") {
          summary.khedmah_app_addition_amt += omrAmount;
        } else if (transactionType === "expire") {
          summary.khedmah_app_expired_amt += omrAmount;
        } else if (transactionType === "redeem") {
          summary.khedmah_app_redeemed_amt += omrAmount;
        }
      } else if (requestedBy === "Khedmah Delivery") {
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
        posting_flag: 0, // Start with 0, Focus9 will update to 1 after reading
        total_transactions_processed: summary.total_transactions_processed,
        summary_generated_at: new Date(),
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
      },
      khedmahDelivery: {
        addition: summary.khedmah_delivery_addition_amt,
        expired: summary.khedmah_delivery_expired_amt,
        redeemed: summary.khedmah_delivery_redeemed_amt,
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
          },
          khedmahDelivery: {
            addition: summary.khedmah_delivery_addition_amt,
            expired: summary.khedmah_delivery_expired_amt,
            redeemed: summary.khedmah_delivery_redeemed_amt,
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

