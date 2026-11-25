const response_handler = require("../../helpers/response_handler");
const Tier = require("../../models/tier_model");
const validator = require("./tier.validator");
const { logger } = require("../../middlewares/logger");
const TierEligibilityCriteria = require("../../models/tier_eligibility_criteria_model");
const Customer = require("../../models/customer_model");
const Transaction = require("../../models/transaction_model");
const { SafeTransaction } = require("../../helpers/transaction");
const { formatOmanDate } = require("../../utils/date");

exports.create = async (req, res) => {
  try {
    const { error } = validator.create_tier.validate(req.body, {
      abortEarly: false,
    });
    if (error) {
      const error_messages = error.details.map((err) => err.message).join(", ");
      return response_handler(res, 400, `Invalid input: ${error_messages}`);
    }

    if (!req.body.hierarchy_level) {
      const highestHierarchyLevel = await Tier.findOne({}).sort({ hierarchy_level: -1 });
      if (highestHierarchyLevel) {
        req.body.hierarchy_level = highestHierarchyLevel.hierarchy_level + 1;
      } else {
        req.body.hierarchy_level = 1;
      }
    }

    const new_tier = await Tier.create(req.body);

    return response_handler(res, 201, "Tier created successfully!", new_tier);
  } catch (error) {
    return response_handler(
      res,
      500,
      `Internal Server Error. ${error.message}`
    );
  }
};

exports.list = async (req, res) => {
  try {
    const tiers = await Tier.find().populate({
      path: "tier_point_multiplier.appType",
      select: "name",
    });
    return response_handler(res, 200, "Tiers fetched successfully!", tiers);
  } catch (error) {
    return response_handler(
      res,
      500,
      `Internal Server Error. ${error.message}`
    );
  }
};

exports.get_tier = async (req, res) => {
  try {
    const { id } = req.params;
    const tier = await Tier.findById(id).sort({ hierarchy_level: 1 });
    console.log(tier);
    return response_handler(res, 200, "Tier fetched successfully!", tier);
  } catch (error) {
    return response_handler(
      res,
      500,
      `Internal Server Error. ${error.message}`
    );
  }
};

exports.update_tier = async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = validator.update_tier.validate(req.body, {
      abortEarly: false,
    });
    if (error) {
      const error_messages = error.details.map((err) => err.message).join(", ");
      return response_handler(res, 400, `Invalid input: ${error_messages}`);
    }

    //if priority present we should shift the existing tier to the next priority
    const tier = await Tier.findById(id);
    const oldPriority = tier.hierarchy_level;
    const newPriority = req.body.hierarchy_level;
    if (newPriority < oldPriority) {
      // Moving UP
      console.log("Moving UP");
      await Tier.updateMany(
        { hierarchy_level: { $gte: newPriority, $lt: oldPriority } },
        { $inc: { hierarchy_level: 1 } }
      );
    } else if (newPriority > oldPriority) {
      // Moving DOWN
      console.log("Moving DOWN");
      await Tier.updateMany(
        { hierarchy_level: { $gt: oldPriority, $lte: newPriority } },
        { $inc: { hierarchy_level: -1 } }
      );
    }
    


    const updated_tier = await Tier.findByIdAndUpdate(id, req.body, {
      new: true,
    });
    return response_handler(
      res,
      200,
      "Tier updated successfully!",
      updated_tier
    );
  } catch (error) {
    return response_handler(
      res,
      500,
      `Internal Server Error. ${error.message}`
    );
  }
};

exports.delete_tier = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted_tier = await Tier.findByIdAndDelete(id);
    return response_handler(
      res,
      200,
      "Tier deleted successfully!",
      deleted_tier
    );
  } catch (error) {
    return response_handler(
      res,
      500,
      `Internal Server Error. ${error.message}`
    );
  }
};

/**
 * Get detailed tier progress information for a customer
 * @param {string} customerId - MongoDB ObjectId of the customer
 * @param {string} appType - MongoDB ObjectId of the app type (optional)
 * @returns {Object} - Detailed tier progress information
 */
exports.getCustomerTierProgress = async (customerId, appType = null) => {
  try {
    // Get customer with current tier
    const customer = await Customer.findById(customerId).populate("tier");

    if (!customer) {
      logger.error(`Customer not found for tier progress check: ${customerId}`);
      return {
        success: false,
        message: "Customer not found",
      };
    }

    // Get current tier hierarchy level
    const currentHierarchyLevel = customer.tier
      ? customer.tier.hierarchy_level
      : -1;

    // Get all tiers ordered by hierarchy level (ascending)
    const tiers = await Tier.find({ isActive: true }).sort({
      hierarchy_level: 1,
    });

    if (!tiers.length) {
      logger.warn("No tiers found in the system for progress check");
      return {
        success: false,
        message: "No tiers configured in the system",
      };
    }

    // Find the next tier above current tier (exactly one level higher)
    let nextTier = null;
    for (const tier of tiers) {
      if (tier.hierarchy_level === currentHierarchyLevel + 1) {
        nextTier = tier;
        break;
      }
    }

    // If no exact next tier found, find any higher tier
    if (!nextTier) {
      for (const tier of tiers) {
        if (tier.hierarchy_level > currentHierarchyLevel) {
          nextTier = tier;
          break;
        }
      }
    }

    if (!nextTier) {
      return {
        success: true,
        message: "Customer is already at the highest tier level",
        currentTier: {
          id: customer.tier._id,
          name: customer.tier.name?.en || customer.tier.name,
          hierarchy_level: customer.tier.hierarchy_level,
          points_required: customer.tier.points_required,
        },
        nextTier: null,
        progress: {
          points: {
            current: customer.total_points,
            required: null,
            remaining: 0,
            percentage: 100,
          },
          streak: null,
        },
      };
    }

    // Get eligibility criteria for next tier
    const criteria = await TierEligibilityCriteria.getCriteriaForTier(
      nextTier._id,
      appType
    );

    // Basic points progress (for display purposes only)
    const pointsProgress = {
      current: customer.total_points,
      required: nextTier.points_required,
      remaining: Math.max(0, nextTier.points_required - customer.total_points),
      percentage: Math.min(
        100,
        Math.round((customer.total_points / nextTier.points_required) * 100)
      ),
    };

    // If no criteria, return basic tier progress information
    if (!criteria) {
      return {
        success: true,
        message:
          "No eligibility criteria defined for next tier, using points threshold only",
        currentTier: customer.tier
          ? {
              id: customer.tier._id,
              name: customer.tier.name?.en || customer.tier.name,
              hierarchy_level: customer.tier.hierarchy_level,
              points_required: customer.tier.points_required,
            }
          : null,
        nextTier: {
          id: nextTier._id,
          name: nextTier.name?.en || nextTier.name,
          hierarchy_level: nextTier.hierarchy_level,
          points_required: nextTier.points_required,
        },
        progress: {
          points: pointsProgress,
          streak: null,
        },
      };
    }

    // Get detailed eligibility progress
    const eligibilityResult = await criteria.validateCustomerEligibility(
      customerId
    );

    // Format streak information
    const periodDetails = eligibilityResult.details.period_breakdown.map(
      (period, index) => {
        // Format dates in Oman time — local getters (getDate/getMonth/
        // getFullYear) read server-local (UTC) time and can print the wrong
        // day for a period boundary near midnight Oman.
        const startFormatted = formatOmanDate(period.start, "D/M/YYYY");
        const endFormatted = formatOmanDate(period.end, "D/M/YYYY");

        return {
          period_number: index + 1,
          period_name: `Period ${index + 1}`,
          date_range: `${startFormatted} - ${endFormatted}`,
          points_earned: period.netEarned,
          points_required: criteria.net_earning_required,
          points_remaining: Math.max(
            0,
            criteria.net_earning_required - period.netEarned
          ),
          completed: period.meetsRequirement,
          percentage: Math.min(
            100,
            Math.round((period.netEarned / criteria.net_earning_required) * 100)
          ),
        };
      }
    );

    // Calculate overall streak progress
    const completedPeriods = periodDetails.filter((p) => p.completed).length;
    const streakProgress = {
      completed_periods: completedPeriods,
      required_periods: criteria.consecutive_periods_required,
      remaining_periods: Math.max(
        0,
        criteria.consecutive_periods_required - completedPeriods
      ),
      percentage: Math.min(
        100,
        Math.round(
          (completedPeriods / criteria.consecutive_periods_required) * 100
        )
      ),
      period_details: periodDetails,
      is_consecutive: criteria.settings.require_consecutive,
    };

    return {
      success: true,
      message: "Tier progress retrieved successfully",
      currentTier: customer.tier
        ? {
            id: customer.tier._id,
            name: customer.tier.name?.en || customer.tier.name,
            hierarchy_level: customer.tier.hierarchy_level,
            points_required: customer.tier.points_required,
          }
        : null,
      nextTier: {
        id: nextTier._id,
        name: nextTier.name?.en || nextTier.name,
        hierarchy_level: nextTier.hierarchy_level,
        points_required: nextTier.points_required,
      },
      progress: {
        points: pointsProgress,
        streak: streakProgress,
        criteria_details: {
          net_earning_required: criteria.net_earning_required,
          evaluation_period_days: criteria.evaluation_period_days,
          consecutive_periods_required: criteria.consecutive_periods_required,
        },
      },
      eligibility_status: eligibilityResult.eligible
        ? "Eligible for upgrade"
        : "Not yet eligible for upgrade",
    };
  } catch (error) {
    logger.error(`Error getting tier progress: ${error.message}`, {
      customerId,
      appType,
      error: error.stack,
    });

    return {
      success: false,
      message: `Error checking tier progress: ${error.message}`,
    };
  }
};

/**
 * Check if a customer is eligible for tier upgrade and upgrade if eligible
 * @param {string} customerId - MongoDB ObjectId of the customer
 * @param {string} appType - MongoDB ObjectId of the app type (optional)
 * @param {Object} session - MongoDB session for transaction
 * @returns {Object} - Result of the tier upgrade check
 */
exports.checkAndUpgradeTier = async (
  customerId,
  appType = null,
  session = null
) => {
  const safeTransaction = !session ? new SafeTransaction() : null;

  try {
    // Start a transaction if one wasn't provided
    if (!session && safeTransaction) {
      session = await safeTransaction.start();
    }

    // Get customer with current tier
    const customer = await Customer.findById(customerId)
      .populate("tier")
      .session(session);

    if (!customer) {
      logger.error(`Customer not found for tier upgrade check: ${customerId}`);
      return {
        success: false,
        message: "Customer not found",
      };
    }

    // Get current tier hierarchy level
    const currentHierarchyLevel = customer.tier
      ? customer.tier.hierarchy_level
      : -1;

    // Get all tiers ordered by hierarchy level (ascending)
    const tiers = await Tier.find({ isActive: true })
      .sort({ hierarchy_level: 1 })
      .session(session);

    if (!tiers.length) {
      logger.warn("No tiers found in the system for upgrade check");
      return {
        success: false,
        message: "No tiers configured in the system",
      };
    }

    // Find the next tier above current tier (exactly one level higher)
    let nextTier = null;
    for (const tier of tiers) {
      if (tier.hierarchy_level === currentHierarchyLevel + 1) {
        nextTier = tier;
        break;
      }
    }

    // If no exact next tier found, find any higher tier
    if (!nextTier) {
      for (const tier of tiers) {
        if (tier.hierarchy_level > currentHierarchyLevel) {
          nextTier = tier;
          break;
        }
      }
    }

    if (!nextTier) {
      logger.info(
        `Customer ${customerId} is already at the highest tier level`
      );
      return {
        success: true,
        message: "Customer is already at the highest tier level",
        upgraded: false,
      };
    }

    logger.info(
      `Checking eligibility for upgrade to ${
        nextTier.name?.en || nextTier.name
      } tier for customer ${customerId}`
    );

    // We only check eligibility criteria, not points requirement
    // Points are just a display value, not a strict requirement for tier upgrade
    // We'll check the tier eligibility criteria directly

    // Get eligibility criteria for next tier
    const criteria = await TierEligibilityCriteria.getCriteriaForTier(
      nextTier._id,
      appType
    );

    if (!criteria) {
      logger.warn(`No eligibility criteria found for tier ${nextTier._id}`);

      // Only allow upgrade if this is the immediate next tier in hierarchy
      if (nextTier.hierarchy_level === currentHierarchyLevel + 1) {
        // Upgrade customer to next tier
        const previousTier = customer.tier
          ? {
              id: customer.tier._id,
              name: customer.tier.name?.en || customer.tier.name,
            }
          : { id: null, name: "None" };

        await Customer.findByIdAndUpdate(
          customerId,
          { tier: nextTier._id },
          { session }
        );

        // Create transaction record for the tier upgrade
        await Transaction.create(
          [
            {
              customer_id: customerId,
              transaction_type: "adjust",
              points: 0, // No points change for tier upgrade
              transaction_id: `TIER-UP-${Date.now()}-${customerId}`,
              status: "completed",
              note: `Tier upgraded from ${previousTier.name} to ${
                nextTier.name?.en || nextTier.name
              } based on points threshold`,
              metadata: {
                previous_tier: previousTier.name,
                new_tier: nextTier.name?.en || nextTier.name,
                total_points: customer.total_points,
                upgrade_reason: "points_threshold_met",
              },
              transaction_date: new Date(),
            },
          ],
          { session }
        );

        logger.info(
          `Customer ${customerId} upgraded to ${
            nextTier.name?.en || nextTier.name
          } tier based on points threshold`,
          {
            previousTier: previousTier.name,
            newTier: nextTier.name?.en || nextTier.name,
            totalPoints: customer.total_points,
          }
        );

        if (safeTransaction) await safeTransaction.commit();

        return {
          success: true,
          message: `Customer upgraded to ${
            nextTier.name?.en || nextTier.name
          } tier based on points threshold`,
          upgraded: true,
          previousTier,
          newTier: {
            id: nextTier._id,
            name: nextTier.name?.en || nextTier.name,
          },
        };
      }

      return {
        success: true,
        message:
          "Customer can only be upgraded to the immediate next tier level",
        upgraded: false,
      };
    }

    // Check eligibility using the criteria
    const eligibilityResult = await criteria.validateCustomerEligibility(
      customerId,
      session
    );

    if (eligibilityResult.eligible) {
      // Customer is eligible for upgrade
      const previousTier = customer.tier
        ? {
            id: customer.tier._id,
            name: customer.tier.name?.en || customer.tier.name,
          }
        : { id: null, name: "None" };

      await Customer.findByIdAndUpdate(
        customerId,
        { tier: nextTier._id },
        { session }
      );

      // Create transaction record for the tier upgrade
      await Transaction.create(
        [
          {
            customer_id: customerId,
            transaction_type: "adjust",
            points: 0, // No points change for tier upgrade
            transaction_id: `TIER-UP-${Date.now()}-${customerId}`,
            status: "completed",
            note: `Tier upgraded from ${previousTier.name} to ${
              nextTier.name?.en || nextTier.name
            } based on eligibility criteria`,
            metadata: {
              previous_tier: previousTier.name,
              new_tier: nextTier.name?.en || nextTier.name,
              total_points: customer.total_points,
              upgrade_reason: "eligibility_criteria_met",
              eligibility_details: eligibilityResult.details,
            },
            transaction_date: new Date(),
          },
        ],
        { session }
      );

      logger.info(
        `Customer ${customerId} upgraded to ${
          nextTier.name?.en || nextTier.name
        } tier based on eligibility criteria`,
        {
          previousTier: previousTier.name,
          newTier: nextTier.name?.en || nextTier.name,
          totalPoints: customer.total_points,
          eligibilityDetails: eligibilityResult.details,
        }
      );

      if (safeTransaction) await safeTransaction.commit();

      return {
        success: true,
        message: `Customer upgraded to ${
          nextTier.name?.en || nextTier.name
        } tier`,
        upgraded: true,
        previousTier,
        newTier: {
          id: nextTier._id,
          name: nextTier.name?.en || nextTier.name,
        },
        eligibilityDetails: eligibilityResult.details,
      };
    } else {
      logger.info(
        `Customer ${customerId} not eligible for upgrade to ${
          nextTier.name?.en || nextTier.name
        } tier`,
        {
          eligibilityDetails: eligibilityResult.details,
        }
      );

      return {
        success: true,
        message: "Customer does not meet eligibility criteria for next tier",
        upgraded: false,
        eligibilityDetails: eligibilityResult.details,
      };
    }
  } catch (error) {
    logger.error(`Error checking and upgrading tier: ${error.message}`, {
      customerId,
      appType,
      error: error.stack,
    });

    if (safeTransaction) await safeTransaction.abort();

    return {
      success: false,
      message: `Error checking tier eligibility: ${error.message}`,
    };
  } finally {
    if (safeTransaction) await safeTransaction.end();
  }
};
