const mongoose = require("mongoose");
const Transaction = require("../models/transaction_model");
const { connectDatabase, disconnectDatabase } = require("../config/database");
const { logger } = require("../middlewares/logger");

/**
 * Preview/dry-run function to check migration impact without making changes
 * Returns statistics on what would succeed, fail, or be skipped
 */
async function previewMigration() {
    const startedAt = new Date();
    let successCount = 0;
    let errorCount = 0;
    let skippedCount = 0;
    const errors = [];
    const skippedReasons = {
        invalidReferenceId: 0,
        originalTransactionNotFound: 0,
    };

    try {
        // Connect to database
        await connectDatabase();
        logger.info("=".repeat(60));
        logger.info("PREVIEW MODE - No changes will be made");
        logger.info("=".repeat(60));

        // Find all expired transactions that need updating
        const expiredTransactions = await Transaction.find({
            transaction_type: "expire",
            reference_id: { $exists: true, $ne: null },
        }).lean();

        logger.info(`Found ${expiredTransactions.length} expired transactions to analyze`);

        if (expiredTransactions.length === 0) {
            logger.info("No expired transactions found that need migration");
            await disconnectDatabase();
            return {
                total: 0,
                success: 0,
                failed: 0,
                skipped: 0,
                errors: [],
                skippedReasons: {},
            };
        }

        // Analyze each expired transaction without making changes
        for (let i = 0; i < expiredTransactions.length; i++) {
            const expiredTx = expiredTransactions[i];
            const progress = `[${i + 1}/${expiredTransactions.length}]`;

            try {
                // Check if reference_id is a valid ObjectId string
                let referenceIdObjectId = null;

                if (
                    expiredTx.reference_id &&
                    mongoose.Types.ObjectId.isValid(expiredTx.reference_id)
                ) {
                    referenceIdObjectId = new mongoose.Types.ObjectId(
                        expiredTx.reference_id
                    );
                } else {
                    // Not a valid ObjectId, skip this record
                    skippedCount++;
                    skippedReasons.invalidReferenceId++;
                    continue;
                }

                // Find the original transaction
                const originalTransaction = await Transaction.findById(
                    referenceIdObjectId
                ).lean();

                if (!originalTransaction) {
                    skippedCount++;
                    skippedReasons.originalTransactionNotFound++;
                    continue;
                }

                // If we get here, the migration would succeed
                successCount++;

                // Log progress every 100 records
                if ((i + 1) % 100 === 0) {
                    logger.info(
                        `${progress} Analyzed: ${successCount} would succeed, ${errorCount} would fail, ${skippedCount} would skip`
                    );
                }
            } catch (error) {
                errorCount++;
                errors.push({
                    transactionId: expiredTx._id.toString(),
                    referenceId: expiredTx.reference_id,
                    message: error.message,
                });
            }
        }

        const completedAt = new Date();
        const duration = completedAt - startedAt;

        // Final summary
        logger.info("=".repeat(60));
        logger.info("PREVIEW SUMMARY (No changes made):");
        logger.info(`Total transactions found: ${expiredTransactions.length}`);
        logger.info(`✅ Would successfully update: ${successCount}`);
        logger.info(`❌ Would fail: ${errorCount}`);
        logger.info(`⏭️  Would skip: ${skippedCount}`);
        logger.info(`   - Invalid reference_id format: ${skippedReasons.invalidReferenceId}`);
        logger.info(
            `   - Original transaction not found: ${skippedReasons.originalTransactionNotFound}`
        );
        logger.info(`Duration: ${duration}ms (${(duration / 1000).toFixed(2)}s)`);
        logger.info("=".repeat(60));

        if (errors.length > 0) {
            logger.warn(`Would encounter errors: ${errors.length}`);
            logger.warn("First 10 potential errors:");
            errors.slice(0, 10).forEach((err, idx) => {
                logger.warn(
                    `${idx + 1}. Transaction ${err.transactionId}: ${err.message}`
                );
            });
        }

        logger.info("Preview completed. Run without --preview flag to execute migration.");

        return {
            total: expiredTransactions.length,
            success: successCount,
            failed: errorCount,
            skipped: skippedCount,
            errors: errors,
            skippedReasons: skippedReasons,
        };
    } catch (error) {
        logger.error("Fatal error in preview script:", {
            error: error.message,
            stack: error.stack,
        });
        throw error;
    } finally {
        // Disconnect from database
        await disconnectDatabase();
        logger.info("Database disconnected");
    }
}

/**
 * One-time migration script to update expired transactions
 * - Converts reference_id from string to ObjectId
 * - Adds metadata.requested_by from the original transaction
 */
async function migrateExpiredTransactions() {
    const startedAt = new Date();
    let successCount = 0;
    let errorCount = 0;
    let skippedCount = 0;
    const errors = [];

    try {
        // Connect to database
        await connectDatabase();
        logger.info("Starting migration of expired transactions");

        // Find all expired transactions that need updating
        // Filter for records where reference_id exists and is a string (not ObjectId)
        const expiredTransactions = await Transaction.find({
            transaction_type: "expire",
            reference_id: { $exists: true, $ne: null },
        }).lean();

        logger.info(`Found ${expiredTransactions.length} expired transactions to process`);

        if (expiredTransactions.length === 0) {
            logger.info("No expired transactions found that need migration");
            await disconnectDatabase();
            return;
        }

        // Process each expired transaction
        for (let i = 0; i < expiredTransactions.length; i++) {
            const expiredTx = expiredTransactions[i];
            const progress = `[${i + 1}/${expiredTransactions.length}]`;

            try {
                // Check if reference_id is already an ObjectId
                // If it's a string, it needs conversion
                let referenceIdObjectId = null;

                // Check if reference_id is a valid ObjectId string
                if (
                    expiredTx.reference_id &&
                    mongoose.Types.ObjectId.isValid(expiredTx.reference_id)
                ) {
                    // Convert string to ObjectId (lean() returns plain objects, so always convert)
                    referenceIdObjectId = new mongoose.Types.ObjectId(
                        expiredTx.reference_id
                    );
                } else {
                    // Not a valid ObjectId, skip this record
                    logger.warn(
                        `${progress} Skipping transaction ${expiredTx._id}: invalid reference_id format - ${expiredTx.reference_id}`
                    );
                    skippedCount++;
                    continue;
                }

                // Find the original transaction
                const originalTransaction = await Transaction.findById(
                    referenceIdObjectId
                ).lean();

                if (!originalTransaction) {
                    logger.warn(
                        `${progress} Original transaction not found for reference_id: ${expiredTx.reference_id}`
                    );
                    skippedCount++;
                    continue;
                }

                // Prepare update data
                const updateData = {
                    reference_id: referenceIdObjectId,
                };

                // Add metadata.requested_by if it exists in original transaction
                if (originalTransaction.metadata?.requested_by) {
                    updateData.metadata = {
                        ...expiredTx.metadata,
                        requested_by: originalTransaction.metadata.requested_by,
                    };
                } else if (expiredTx.metadata) {
                    // Preserve existing metadata if no requested_by in original
                    updateData.metadata = expiredTx.metadata;
                } else {
                    // No metadata exists, create empty object
                    updateData.metadata = {};
                }

                // Update the expired transaction
                await Transaction.findByIdAndUpdate(expiredTx._id, updateData);

                successCount++;

                // Log progress every 100 records
                if ((i + 1) % 100 === 0) {
                    logger.info(
                        `${progress} Processed ${successCount} successful, ${errorCount} failed, ${skippedCount} skipped`
                    );
                }
            } catch (error) {
                errorCount++;
                errors.push({
                    transactionId: expiredTx._id.toString(),
                    referenceId: expiredTx.reference_id,
                    message: error.message,
                });

                logger.error(
                    `${progress} Error processing transaction ${expiredTx._id}:`,
                    {
                        error: error.message,
                        stack: error.stack,
                    }
                );
                // Continue with next record
            }
        }

        const completedAt = new Date();
        const duration = completedAt - startedAt;

        // Final summary
        logger.info("=".repeat(60));
        logger.info("Migration Summary:");
        logger.info(`Total transactions found: ${expiredTransactions.length}`);
        logger.info(`Successfully updated: ${successCount}`);
        logger.info(`Failed: ${errorCount}`);
        logger.info(`Skipped: ${skippedCount}`);
        logger.info(`Duration: ${duration}ms (${(duration / 1000).toFixed(2)}s)`);
        logger.info("=".repeat(60));

        if (errors.length > 0) {
            logger.warn(`Errors encountered: ${errors.length}`);
            logger.warn("First 10 errors:");
            errors.slice(0, 10).forEach((err, idx) => {
                logger.warn(
                    `${idx + 1}. Transaction ${err.transactionId}: ${err.message}`
                );
            });
        }

        logger.info("Migration completed successfully!");
    } catch (error) {
        logger.error("Fatal error in migration script:", {
            error: error.message,
            stack: error.stack,
        });
        throw error;
    } finally {
        // Disconnect from database
        await disconnectDatabase();
        logger.info("Database disconnected");
    }
}

// Run migration if script is executed directly
if (require.main === module) {
    // Check for --preview flag
    const isPreview = process.argv.includes("--preview") || process.argv.includes("-p");

    if (isPreview) {
        previewMigration()
            .then(() => {
                logger.info("Preview script finished");
                process.exit(0);
            })
            .catch((error) => {
                logger.error("Preview script failed:", error);
                process.exit(1);
            });
    } else {
        migrateExpiredTransactions()
            .then(() => {
                logger.info("Migration script finished");
                process.exit(0);
            })
            .catch((error) => {
                logger.error("Migration script failed:", error);
                process.exit(1);
            });
    }
}

module.exports = { migrateExpiredTransactions, previewMigration };

