const { logger } = require("../middlewares/logger");
const LoyaltyPoints = require("../models/loyalty_points_model");
const Customer = require("../models/customer_model");
const Transaction = require("../models/transaction_model");
const JobExecutionLog = require("../models/job_execution_log_model");
const { SafeTransaction } = require("../helpers/transaction");

/**
 * Process expired points and update customer balances
 * Runs daily at 2 AM Oman time
 * Each record is processed in its own transaction for resilience
 */
async function processExpiredPoints(jobType = "daily") {
    const startedAt = new Date();
    let executionLog = null;

    try {
        // Create execution log entry
        executionLog = await JobExecutionLog.create({
            jobName: "point_expiry_checker",
            jobType: jobType,
            startedAt: startedAt,
            status: "running",
            metrics: {
                totalRecords: 0,
                processedRecords: 0,
                successfulRecords: 0,
                failedRecords: 0,
            },
        });

        logger.info("Starting daily points expiration process", {
            executionLogId: executionLog._id,
        });

        // Find all expired points (status: active and expiryDate < now)
        const now = new Date();
        const expiredPoints = await LoyaltyPoints.find({
            status: "active",
            expiryDate: { $lt: now },
        }).lean();

        logger.info(`Found ${expiredPoints.length} expired point records`);

        // Update total records in log
        executionLog.metrics.totalRecords = expiredPoints.length;
        await executionLog.save();

        let successCount = 0;
        let errorCount = 0;
        const errors = [];

        // Process each expired points record in its own transaction
        for (const pointRecord of expiredPoints) {
            const transaction = new SafeTransaction();
            let transactionCommitted = false;

            try {
                await transaction.start();
                const session = transaction.session;

                // Fetch the original transaction to get its transaction_id
                const originalTransaction = await Transaction.findById(
                    pointRecord.transaction_id
                ).session(session);

                if (!originalTransaction) {
                    throw new Error(
                        `Original transaction not found: ${pointRecord.transaction_id}`
                    );
                }

                // Mark points as expired
                await LoyaltyPoints.findByIdAndUpdate(
                    pointRecord._id,
                    { status: "expired" },
                    { session }
                );

                // Create expiration transaction using the original transaction's transaction_id
                await Transaction.create(
                    [
                        {
                            customer_id: pointRecord.customer_id,
                            transaction_type: "expire",
                            points: -pointRecord.points,
                            transaction_id: `EXP-${originalTransaction.transaction_id}`,
                            status: "completed",
                            note: `Points expired on ${now.toISOString()}`,
                            reference_id: originalTransaction._id,
                            metadata: {
                                requested_by: originalTransaction.metadata?.requested_by || null,
                            },
                            transaction_date: now,
                        },
                    ],
                    { session }
                );

                // Update customer's total points
                await Customer.findByIdAndUpdate(
                    pointRecord.customer_id,
                    { $inc: { total_points: -pointRecord.points } },
                    { session }
                );

                await transaction.commit();
                transactionCommitted = true;
                successCount++;

                logger.info(
                    `Processed expiration for customer ${pointRecord.customer_id}: ${pointRecord.points} points`
                );
            } catch (error) {
                // Only abort if transaction wasn't committed
                if (!transactionCommitted && transaction.hasTransaction) {
                    try {
                        await transaction.abort();
                    } catch (abortError) {
                        // Ignore abort errors if transaction was already aborted
                        logger.debug(
                            `Transaction already aborted for record ${pointRecord._id}`
                        );
                    }
                }

                errorCount++;
                errors.push({
                    recordId: pointRecord._id.toString(),
                    customerId: pointRecord.customer_id.toString(),
                    message: error.message,
                });

                logger.error(
                    `Error processing expired points for record ${pointRecord._id}:`,
                    {
                        error: error.message,
                        stack: error.stack,
                    }
                );
                // Continue with next record
            } finally {
                await transaction.end();
            }
        }

        // Determine final status
        let finalStatus = "completed";
        if (errorCount > 0 && successCount > 0) {
            finalStatus = "partial";
        } else if (errorCount > 0 && successCount === 0) {
            finalStatus = "failed";
        }

        const completedAt = new Date();
        const duration = completedAt - startedAt;

        // Update execution log with results
        executionLog.status = finalStatus;
        executionLog.completedAt = completedAt;
        executionLog.duration = duration;
        executionLog.metrics.processedRecords = expiredPoints.length;
        executionLog.metrics.successfulRecords = successCount;
        executionLog.metrics.failedRecords = errorCount;
        executionLog.details = {
            errors: errors.slice(0, 10), // Store first 10 errors to avoid huge documents
            totalErrors: errors.length,
        };

        await executionLog.save();

        logger.info(
            `Successfully completed daily points expiration process. Processed: ${successCount} successful, ${errorCount} failed out of ${expiredPoints.length} total records`,
            {
                executionLogId: executionLog._id,
                duration: `${duration}ms`,
            }
        );
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

        logger.error("Error in daily points expiration process:", {
            error: error.message,
            stack: error.stack,
            executionLogId: executionLog?._id,
        });
        throw error;
    }
}

module.exports = {
    processExpiredPoints,
};

