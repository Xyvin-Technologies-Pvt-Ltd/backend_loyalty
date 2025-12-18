const { logger } = require("../middlewares/logger");
const Customer = require("../models/customer_model");
const Transaction = require("../models/transaction_model");
const Tier = require("../models/tier_model");
const TierEligibilityCriteria = require("../models/tier_eligibility_criteria_model");
const PriorityCustomer = require("../models/priority_customer_model");
const JobExecutionLog = require("../models/job_execution_log_model");
const { SafeTransaction } = require("../helpers/transaction");

/**
 * Check if customer meets tier eligibility criteria for tier retention
 * @param {Object} customer - Customer object
 * @param {Object} tier - Tier object
 * @param {Object} session - Database session
 * @returns {boolean} - Whether customer meets criteria
 */
const checkTierRetentionEligibility = async (customer, tier, session) => {
  try {
    // Get tier eligibility criteria for this tier
    const criteria = await TierEligibilityCriteria.findOne({
      tier_id: tier._id,
      is_active: true,
    }).session(session);

    if (!criteria) {
      logger.warn(
        `No tier eligibility criteria found for tier ${tier.name?.en || tier.name
        }`
      );
      // If no criteria defined, use basic point threshold only
      return customer.total_points >= tier.points_required;
    }

    // Check if customer has minimum points required for the tier for khedmah for all customers check
    if (customer.total_points >= 0) {
      //!kedmah sepcific
      logger.info(
        `Customer ${customer._id} below tier points threshold, checking consecutive periods`,
        {
          tier: tier.name?.en || tier.name,
          totalPoints: customer.total_points,
          tierRequired: tier.points_required,
          consecutivePeriodsRequired: criteria.consecutive_periods_required,
          evaluationPeriodDays: criteria.evaluation_period_days,
          netEarningRequired: criteria.net_earning_required,
        }
      );

      // Check consecutive evaluation periods
      const now = new Date();
      let consecutivePeriodsWithSufficientEarnings = 0;

      // Check each consecutive period starting from the most recent
      for (
        let periodIndex = 0;
        periodIndex < criteria.consecutive_periods_required;
        periodIndex++
      ) {
        // Calculate period start and end dates
        const periodEndDate = new Date(now);
        periodEndDate.setDate(
          periodEndDate.getDate() -
          periodIndex * criteria.evaluation_period_days
        );

        const periodStartDate = new Date(periodEndDate);
        periodStartDate.setDate(
          periodStartDate.getDate() - criteria.evaluation_period_days
        );

        // Get transactions within this specific period
        const periodTransactions = await Transaction.find({
          customer_id: customer._id,
          transaction_type: "earn",
          transaction_date: {
            $gte: periodStartDate,
            $lt: periodEndDate,
          },
          status: "completed",
        }).session(session);

        // Calculate net earnings in this period
        const periodNetEarnings = periodTransactions.reduce(
          (sum, transaction) => sum + transaction.points,
          0
        );

        logger.debug(
          `Period ${periodIndex + 1} check for customer ${customer._id}:`,
          {
            periodStart: periodStartDate.toISOString(),
            periodEnd: periodEndDate.toISOString(),
            periodNetEarnings,
            requiredEarnings: criteria.net_earning_required,
            meetsRequirement:
              periodNetEarnings >= criteria.net_earning_required,
          }
        );

        // Check if this period meets the earning requirement
        if (periodNetEarnings >= criteria.net_earning_required) {
          consecutivePeriodsWithSufficientEarnings++;
        } else {
          // Break the consecutive chain - customer fails retention
          logger.info(
            `Customer ${customer._id
            } failed tier retention - insufficient earnings in period ${periodIndex + 1
            }`,
            {
              tier: tier.name?.en || tier.name,
              periodNetEarnings,
              requiredEarnings: criteria.net_earning_required,
              consecutivePeriodsAchieved:
                consecutivePeriodsWithSufficientEarnings,
              consecutivePeriodsRequired: criteria.consecutive_periods_required,
            }
          );
          return false;
        }
      }

      // Check if customer met all consecutive periods requirement
      const meetsConsecutiveRequirement =
        consecutivePeriodsWithSufficientEarnings >=
        criteria.consecutive_periods_required;

      logger.info(`Customer ${customer._id} tier retention result:`, {
        tier: tier.name?.en || tier.name,
        totalPoints: customer.total_points,
        tierRequired: tier.points_required,
        consecutivePeriodsAchieved: consecutivePeriodsWithSufficientEarnings,
        consecutivePeriodsRequired: criteria.consecutive_periods_required,
        meetsRetentionCriteria: meetsConsecutiveRequirement,
        verdict: meetsConsecutiveRequirement ? "RETAIN_TIER" : "DOWNGRADE",
      });

      return meetsConsecutiveRequirement;
    }

    // Customer has sufficient points for their tier
    logger.debug(
      `Customer ${customer._id} has sufficient points for tier ${tier.name?.en || tier.name
      } (${customer.total_points} >= ${tier.points_required})`
    );
    return true; // Customer retains tier
  } catch (error) {
    logger.error(
      `Error checking tier retention eligibility: ${error.message}`,
      {
        customer_id: customer._id,
        tier_id: tier._id,
        error: error.stack,
      }
    );
    return true; // Default to retention in case of error
  }
};

/**
 * Process tier downgrades based on retention eligibility criteria
 * Runs on the last day of each month at 2 AM Oman time
 */
async function processTierDowngrades(jobType = "monthly") {
  const startedAt = new Date();
  let executionLog = null;
  const transaction = new SafeTransaction();

  try {
    // Create execution log entry
    executionLog = await JobExecutionLog.create({
      jobName: "tier_downgrade",
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

    await transaction.start();
    const session = transaction.session;

    logger.info("Starting monthly tier downgrade process", {
      executionLogId: executionLog._id,
    });

    const now = new Date();

    // Process tier downgrades using dynamic eligibility criteria
    // Get all tiers ordered by hierarchy_level (highest to lowest)
    const tiers = await Tier.find({})
      .sort({ hierarchy_level: -1 })
      .session(session);

    const bronzeTier =
      tiers.find((t) => t.hierarchy_level === 0) || tiers[tiers.length - 1]; // Lowest tier

    if (!bronzeTier) {
      throw new Error("Bronze/Base tier not found");
    }

    // Find customers in tiers above bronze (excluding bronze tier)
    const customersToCheck = await Customer.find({
      tier: { $ne: bronzeTier._id },
    })
      .populate("tier")
      .session(session);

    logger.info(
      `Processing tier downgrades for ${customersToCheck.length} customers in elevated tiers`
    );

    // Update total records in log
    executionLog.metrics.totalRecords = customersToCheck.length;
    await executionLog.save();

    let successCount = 0;
    let errorCount = 0;
    let downgradeCount = 0;
    const downgrades = [];
    const errors = [];

    for (const customer of customersToCheck) {
      try {
        const currentTier = customer.tier;

        const priorityRecord = await PriorityCustomer.findOne({
          customer_id: customer._id,
          is_active: true,
        })
          .session(session)
          .populate("tier_id");

        const priorityTier = priorityRecord?.tier_id || null;

        if (priorityTier) {
          logger.debug(
            `Priority protection found for customer ${customer._id}`,
            {
              minimumTier: priorityTier.name?.en || priorityTier.name,
              minimumHierarchy: priorityTier.hierarchy_level,
              currentHierarchy: currentTier?.hierarchy_level,
            }
          );
        }

        if (
          priorityTier &&
          currentTier &&
          currentTier.hierarchy_level < priorityTier.hierarchy_level
        ) {
          await Customer.findByIdAndUpdate(
            customer._id,
            { tier: priorityTier._id },
            { session }
          );

          await Transaction.create(
            [
              {
                customer_id: customer._id,
                transaction_type: "tier_protection_adjustment",
                points: 0,
                transaction_id: `TIER-PROTECT-${Date.now()}-${customer._id}`,
                status: "completed",
                note: `Priority protection enforced: upgraded to ${
                  priorityTier.name?.en || priorityTier.name
                } minimum tier`,
                metadata: {
                  previous_tier: currentTier.name?.en || currentTier.name,
                  enforced_minimum_tier:
                    priorityTier.name?.en || priorityTier.name,
                  total_points: customer.total_points,
                  reason: "priority_customer_protection",
                },
                transaction_date: now,
              },
            ],
            { session }
          );

          logger.info(
            `Priority protection enforced for customer ${customer._id}`,
            {
              customerId: customer._id,
              previousTier: currentTier.name?.en || currentTier.name,
              enforcedTier: priorityTier.name?.en || priorityTier.name,
              totalPoints: customer.total_points,
            }
          );

          continue;
        }

        // Check if customer meets retention criteria for current tier
        const meetsRetentionCriteria = await checkTierRetentionEligibility(
          customer,
          currentTier,
          session
        );

        if (!meetsRetentionCriteria) {
          // Find the appropriate tier to downgrade to
          let newTier = bronzeTier; // Default to bronze

          // Find the highest tier the customer is eligible for
          for (const tier of tiers) {
            if (tier._id.toString() === currentTier._id.toString()) continue; // Skip current tier
            // Check both hierarchy level and points requirement
            if (tier.hierarchy_level < currentTier.hierarchy_level) {
              const meetsNewTierCriteria = await checkTierRetentionEligibility(
                customer,
                tier,
                session
              );
              if (meetsNewTierCriteria) {
                newTier = tier;
                break; // Take the first (highest) tier they qualify for
              }
            }
          }

          if (
            priorityTier &&
            newTier.hierarchy_level < priorityTier.hierarchy_level
          ) {
            logger.info(
              `Priority protection applied for customer ${customer._id}: preventing downgrade below minimum tier`,
              {
                customerId: customer._id,
                attemptedTier: newTier.name?.en || newTier.name,
                minimumTier: priorityTier.name?.en || priorityTier.name,
                totalPoints: customer.total_points,
              }
            );
            newTier = priorityTier;
          }

          // Only downgrade if the new tier is actually lower
          if (newTier.hierarchy_level < currentTier.hierarchy_level) {
            if (newTier._id.toString() === currentTier._id.toString()) {
              logger.info(
                `Customer ${customer._id} retains ${
                  currentTier.name?.en || currentTier.name
                } tier due to priority protection`,
                {
                  customerId: customer._id,
                  currentTier: currentTier.name?.en || currentTier.name,
                  totalPoints: customer.total_points,
                }
              );
              continue;
            }

            await Customer.findByIdAndUpdate(
              customer._id,
              { tier: newTier._id },
              { session }
            );

            downgradeCount++;
            downgrades.push({
              customerId: customer._id.toString(),
              fromTier: currentTier.name?.en || currentTier.name,
              toTier: newTier.name?.en || newTier.name,
              totalPoints: customer.total_points,
            });

            // Log the downgrade with details
            logger.info(
              `Downgraded customer ${customer._id} from ${currentTier.name?.en || currentTier.name
              } to ${newTier.name?.en || newTier.name}`,
              {
                customerId: customer._id,
                fromTier: currentTier.name?.en || currentTier.name,
                toTier: newTier.name?.en || newTier.name,
                totalPoints: customer.total_points,
                reason: priorityTier
                  ? "Failed to meet tier retention criteria (priority protected)"
                  : "Failed to meet tier retention criteria",
              }
            );

            // Create audit transaction for tier change
            await Transaction.create(
              [
                {
                  customer_id: customer._id,
                  transaction_type: "tier_downgrade",
                  points: 0,
                  transaction_id: `TIER-DOWN-${Date.now()}-${customer._id}`,
                  status: "completed",
                  note: `Tier downgraded from ${currentTier.name?.en || currentTier.name
                    } to ${newTier.name?.en || newTier.name
                    } due to insufficient activity`,
                  metadata: {
                    previous_tier: currentTier.name?.en || currentTier.name,
                    new_tier: newTier.name?.en || newTier.name,
                    total_points: customer.total_points,
                    downgrade_reason: priorityTier
                      ? "tier_retention_criteria_not_met_priority_protected"
                      : "tier_retention_criteria_not_met",
                    priority_minimum_tier: priorityTier
                      ? priorityTier.name?.en || priorityTier.name
                      : null,
                  },
                  transaction_date: now,
                },
              ],
              { session }
            );
          } else {
            logger.info(
              `Customer ${customer._id} retains ${currentTier.name?.en || currentTier.name
              } tier (no lower eligible tier found)`,
              {
                customerId: customer._id,
                currentTier: currentTier.name?.en || currentTier.name,
                totalPoints: customer.total_points,
                priorityMinimumTier: priorityTier
                  ? priorityTier.name?.en || priorityTier.name
                  : null,
              }
            );
          }
        } else {
          logger.debug(
            `Customer ${customer._id} retains ${currentTier.name?.en || currentTier.name
            } tier (meets retention criteria)`,
            {
              customerId: customer._id,
              tier: currentTier.name?.en || currentTier.name,
              totalPoints: customer.total_points,
            }
          );
        }
        successCount++;
      } catch (error) {
        errorCount++;
        errors.push({
          customerId: customer._id.toString(),
          message: error.message,
        });

        logger.error(
          `Error processing tier downgrade for customer ${customer._id}:`,
          error
        );
        // Continue with next customer
        continue;
      }
    }

    await transaction.commit();

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
    executionLog.metrics.processedRecords = customersToCheck.length;
    executionLog.metrics.successfulRecords = successCount;
    executionLog.metrics.failedRecords = errorCount;
    executionLog.details = {
      downgrades: downgrades.slice(0, 50), // Store first 50 downgrades
      totalDowngrades: downgradeCount,
      errors: errors.slice(0, 10), // Store first 10 errors
      totalErrors: errors.length,
    };

    await executionLog.save();

    logger.info("Successfully completed monthly tier downgrade process", {
      executionLogId: executionLog._id,
      duration: `${duration}ms`,
      downgrades: downgradeCount,
      successful: successCount,
      failed: errorCount,
    });
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

    await transaction.abort();
    logger.error("Error in monthly tier downgrade process:", {
      error: error.message,
      stack: error.stack,
      executionLogId: executionLog?._id,
    });
    throw error;
  } finally {
    await transaction.end();
  }
}

module.exports = {
  processTierDowngrades,
};
