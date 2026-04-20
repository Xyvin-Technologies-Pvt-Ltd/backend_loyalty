/**
 * Bulk Points Worker
 * Processes bulk manual points upload jobs in the background via BullMQ
 */

const { v4: uuidv4 } = require("uuid");
const mongoose = require("mongoose");
const { createWorker } = require("../config/queue");
const { logger } = require("../middlewares/logger");
const BulkPointsJob = require("../models/bulk_points_job_model");
const Transaction = require("../models/transaction_model");
const Customer = require("../models/customer_model");
const LoyaltyPoints = require("../models/loyalty_points_model");
const PointsExpirationRules = require("../models/points_expiration_rules_model");
const AppType = require("../models/app_type_model");

const PROGRESS_UPDATE_INTERVAL = 50;

const buildManualNote = (action, note) =>
  `Manual points ${action} by admin - ${(note || "").toString().trim()}`;

const buildManualMetadata = (additional = {}) => ({
  admin_entered: true,
  manual_source: "admin_panel",
  ...additional,
});

const findAppType = async (requestedBy) => {
  const normalized = (requestedBy || "").toString().trim();
  if (!normalized) return null;
  return AppType.findOne({
    name: new RegExp(`^${normalized}$`, "i"),
  }).lean();
};

/**
 * Process a bulk points job
 * @param {Object} job - BullMQ job
 * @returns {Promise<void>}
 */
const processBulkPointsJob = async (job) => {
  if (job.name !== "bulk-points-add") {
    logger.warn(`Bulk points worker received unknown job: ${job.name}`);
    return;
  }

  const { jobId, requestedBy, createdBy, enrichedRows } = job.data;

  logger.info(`Processing bulk points job: ${jobId}`, {
    totalRows: enrichedRows.length,
  });

  try {
    await BulkPointsJob.findOneAndUpdate(
      { jobId },
      { status: "processing", progress: 0 }
    );

    const requestedAppType = await findAppType(requestedBy);
    const processedDetails = [];
    let successCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    for (let i = 0; i < enrichedRows.length; i++) {
      const row = enrichedRows[i];
      const {
        rowNumber,
        customerId,
        criteriaId,
        criteriaUniqueCode,
        tierId,
        points,
        note,
      } = row;

      const customerObjectId = new mongoose.Types.ObjectId(customerId);
      const criteriaObjectId = new mongoose.Types.ObjectId(criteriaId);

      try {
        const existingDuplicate = await Transaction.findOne({
          customer_id: customerObjectId,
          transaction_type: "adjust",
          points,
          status: "completed",
          "metadata.point_criteria_code": criteriaUniqueCode,
          "metadata.admin_entered": true,
        });

        if (existingDuplicate) {
          skippedCount++;
          processedDetails.push({
            row: rowNumber,
            customer_id: row.customerIdStr || customerId,
            skipped: true,
            reason: `Duplicate: adjust transaction already exists (${existingDuplicate.transaction_id})`,
          });
        } else {
          const [createdTransaction] = await Transaction.create([
            {
              customer_id: customerObjectId,
              transaction_type: "adjust",
              points,
              transaction_id: `PROMO-$${uuidv4().slice(0, 8)}`,
              point_criteria: criteriaObjectId,
              app_type: requestedAppType?._id ?? null,
              status: "completed",
              note: buildManualNote("addition", note),
              metadata: buildManualMetadata({
                requested_by: requestedBy,
                point_criteria_code: criteriaUniqueCode,
                bulk_row: rowNumber,
              }),
              transaction_date: new Date(),
            },
          ]);

          const updatedCustomer = await Customer.findByIdAndUpdate(
            customerObjectId,
            {
              $inc: {
                total_points: points,
                coins: points,
              },
            },
            { new: true }
          );

          try {
            const expiryDate = await PointsExpirationRules.calculateExpiryDate(
              tierId ? new mongoose.Types.ObjectId(tierId) : null
            );

            await LoyaltyPoints.create([
              {
                customer_id: customerObjectId,
                points,
                expiryDate,
                transaction_id: createdTransaction._id,
                earnedAt: new Date(),
                status: "active",
                metadata: buildManualMetadata({
                  requested_by: requestedBy,
                  bulk_row: rowNumber,
                }),
              },
            ]);
          } catch (lpError) {
            logger.error(
              `Error creating loyalty point entry: ${lpError.message}`,
              { customer_id: row.customerIdStr, row: rowNumber }
            );
          }

          successCount++;
          processedDetails.push({
            row: rowNumber,
            customer_id: row.customerIdStr || customerId,
            transaction_id: createdTransaction.transaction_id,
            new_balance: updatedCustomer.total_points,
          });
        }
      } catch (rowError) {
        failedCount++;
        logger.error(`Bulk points row error: ${rowError.message}`, {
          row: rowNumber,
          customerId: row.customerIdStr,
        });
        processedDetails.push({
          row: rowNumber,
          customer_id: row.customerIdStr || customerId,
          skipped: false,
          failed: true,
          error: rowError.message,
        });
      }

      const processedCount = i + 1;
      if (processedCount % PROGRESS_UPDATE_INTERVAL === 0) {
        const progress = Math.round((processedCount / enrichedRows.length) * 100);
        await BulkPointsJob.findOneAndUpdate(
          { jobId },
          {
            processedCount,
            successCount,
            skippedCount,
            failedCount,
            progress,
          }
        );
        await job.updateProgress(progress);
      }
    }

    try {
      const tierController = require("../modules/tier/tier.controller");
      for (const row of enrichedRows) {
        try {
          await tierController.checkAndUpgradeTier(
            new mongoose.Types.ObjectId(row.customerId),
            null
          );
        } catch (tierError) {
          logger.error(`Tier upgrade check failed: ${tierError.message}`, {
            customerId: row.customerId,
          });
        }
      }
    } catch (tierError) {
      logger.error(
        `Error evaluating tier upgrades for bulk upload: ${tierError.message}`
      );
    }

    await BulkPointsJob.findOneAndUpdate(
      { jobId },
      {
        status: "completed",
        processedCount: enrichedRows.length,
        successCount,
        skippedCount,
        failedCount,
        progress: 100,
        result: {
          total_rows: enrichedRows.length,
          success_count: successCount,
          skipped_count: skippedCount,
          failed_count: failedCount,
          details: processedDetails,
        },
        completedAt: new Date(),
      }
    );

    logger.info(`Bulk points job completed: ${jobId}`, {
      successCount,
      skippedCount,
      failedCount,
    });
  } catch (error) {
    logger.error(`Bulk points job failed: ${jobId}`, {
      error: error.message,
      stack: error.stack,
    });

    await BulkPointsJob.findOneAndUpdate(
      { jobId },
      {
        status: "failed",
        error: error.message,
        completedAt: new Date(),
      }
    );

    throw error;
  }
};

/**
 * Initialize the bulk points worker
 * @returns {Object} - The created worker
 */
const initializeBulkPointsWorker = () => {
  const worker = createWorker("points", processBulkPointsJob, {
    concurrency: 1,
  });

  logger.info("Bulk points worker initialized");

  return worker;
};

module.exports = {
  initializeBulkPointsWorker,
  processBulkPointsJob,
};
