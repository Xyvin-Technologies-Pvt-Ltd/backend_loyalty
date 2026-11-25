const PointsCriteria = require("../../../models/point_criteria_model");
const Transaction = require("../../../models/transaction_model");
const response_handler = require("../../../helpers/response_handler");
const { logger } = require("../../../middlewares/logger");
const loyaltyPointsController = require("../../loyalty_points_core/loyalty_points.controller");
const Customer = require("../../../models/customer_model");
const { omanMonthRange } = require("../../../utils/date");


//process a loyalty point earning event from user based on trigger event, trigger service, app type , user tier, condition etc
// By processing loyalty event, we mean that the user has earned loyalty points based on a certain event, service, app type, tier, condition etc  
// This is the main function that will be used to process the loyalty event
exports.process_loyalty_event = async (req, res) => {
    try {
      const {
        criteria_code,
        paymentMethod,
        customerId,
        transactionValue,
        metadata,
        reference_id,
        app_type
      } = req.body;
  
      // Find the customer
      const customer = await Customer.findById(customerId);
      if (!customer) {
        return response_handler(res, 400, "Customer not found");
      }
  
      // Find the point criteria using our static method
      const pointCriteria = await Criteria.findMatchingCriteria(
        criteria_code    );
  
      if (!pointCriteria) {
        return response_handler(
          res,
          404,
          "No point criteria found for this event"
        );
      }
  
      // Use our new optimized method to check eligibility - no need to fetch transactions first!
      const eligibilityCheck = await pointCriteria.checkEligibilityOptimized(
        paymentMethod,
        transactionValue,
        customerId
      );
  
      if (!eligibilityCheck.eligible) {
        return response_handler(
          res,
          400,
          eligibilityCheck.message,
          { details: eligibilityCheck.details }
        );
      }
  
      // Calculate points using our new method
      const pointsToAward = eligibilityCheck.points;
  
      // Fetch expiry rules & calculate expiry date
      const expiryDate = await PointsExpirationRules.calculateExpiryDate(
        customer.tier
      );
  
      // Create a transaction
      const transaction = await Transaction.create({
        customer_id: customerId,
        transaction_type: "earn",
        points: pointsToAward,
        transaction_id: uuidv4(),
        point_criteria: pointCriteria._id,
        payment_method: paymentMethod,
        status: "pending",
        metadata: metadata,
        app_type: app_type,
        reference_id: reference_id,
      });
  
      // Add the points to the customer's loyalty points
      await LoyaltyPoints.create({
        customer_id: customerId,
        points: pointsToAward,
        expiryDate: expiryDate,
        transaction_id: transaction._id,
      });
  
      // Update customer's total points
      await Customer.findByIdAndUpdate(
        customerId,
        {
          $inc: { total_points: pointsToAward },
        },
        { new: true }
      );
  
      // Update the transaction status
      await Transaction.findByIdAndUpdate(transaction._id, {
        status: "success",
      });
  
      return response_handler(
        res,
        200,
        "Loyalty points processed successfully",
        {
          pointsAwarded: pointsToAward,
          calculationDetails: eligibilityCheck.details
        }
      );
    } catch (error) {
      console.error("Process loyalty event error:", error);
      return response_handler(res, 500, error.message);
    }
  };
  
exports.getPointCalculationDetails = async (req, res) => {
    try {
        const {
            unique_code,
            transaction_value,
            payment_method,
            app_type
        } = req.query;

        // Validate required fields
        if (!unique_code || !transaction_value || !payment_method || !app_type) {
            return response_handler(res, 400, "Missing required fields", null);
        }

        // Find matching point criteria
        const pointCriteria = await PointsCriteria.findOne({
            unique_code,
            isActive: true
        }).populate("eventType", "name")
            .populate("serviceType", "name")
            .populate("appType", "name");

        if (!pointCriteria) {
            return response_handler(res, 404, "No matching point criteria found", null);
        }

        // Check eligibility
        const eligibilityCheck = await pointCriteria.checkEligibilityOptimized(
            payment_method,
            transaction_value,
            req.user._id
        );

        // Calculate points
        const pointCalculation = pointCriteria.calculatePoints(payment_method, transaction_value);

        return response_handler(res, 200, "Point calculation details retrieved successfully", {
            point_criteria: {
                _id: pointCriteria._id,
                unique_code: pointCriteria.unique_code,
                description: pointCriteria.description,
                event_type: pointCriteria.eventType?.name,
                service_type: pointCriteria.serviceType?.name,
                app_type: pointCriteria.appType?.name
            },
            eligibility: eligibilityCheck,
            calculation: pointCalculation,
            transaction_limits: eligibilityCheck.details.transactionLimits
        });
    } catch (error) {
        logger.error(`Error getting point calculation details: ${error.message}`);
        return response_handler(res, 500, error.message, null);
    }
};

exports.getSupportedPaymentMethods = async (req, res) => {
    try {
        const paymentMethods = await PointsCriteria.getSupportedPaymentMethods();
        return response_handler(res, 200, "Supported payment methods retrieved successfully", {
            payment_methods: paymentMethods
        });
    } catch (error) {
        logger.error(`Error getting supported payment methods: ${error.message}`);
            return response_handler(res, 500, error.message, null);
    }
};

exports.checkCustomerEligibility = async (req, res) => {
    try {
        const {
            unique_code,
            payment_method,
            transaction_value,
            app_type
        } = req.query;

        // Validate required fields
        if (!unique_code || !payment_method || !transaction_value || !app_type) {
            return response_handler(res, 400, "Missing required fields", null);
        }

        // Find matching point criteria
        const pointCriteria = await PointsCriteria.findOne({
            unique_code,
            isActive: true
        }).populate("eventType", "name")
            .populate("serviceType", "name")
            .populate("appType", "name");

        if (!pointCriteria) {
            return response_handler(res, 404, "No matching point criteria found", null);
        }

        // Get customer's transaction history for this criteria
        const now = new Date();
        const startOfWeek = new Date(now);
        startOfWeek.setDate(now.getDate() - 7);
        // Start of the current Oman month — matches models/point_criteria_model.js,
        // which independently computes the same limit and must agree with it.
        const startOfMonth = omanMonthRange(now).start;

        const [weeklyTransactions, monthlyTransactions] = await Promise.all([
            Transaction.countDocuments({
                customer_id: req.user._id,
                point_criteria: pointCriteria._id,
                status: "success",
                transaction_type: "earn",
                createdAt: { $gte: startOfWeek }
            }),
            Transaction.countDocuments({
                customer_id: req.user._id,
                point_criteria: pointCriteria._id,
                status: "success",
                transaction_type: "earn",
                createdAt: { $gte: startOfMonth }
            })
        ]);

        // Get total points earned for this criteria
        const totalPoints = await Transaction.aggregate([
            {
                $match: {
                    customer_id: req.user._id,
                    point_criteria: pointCriteria._id,
                    status: "success",
                    transaction_type: "earn"
                }
            },
            {
                $group: {
                    _id: null,
                    total: { $sum: "$points" }
                }
            }
        ]);

        // Check eligibility
        const eligibilityCheck = await pointCriteria.checkEligibilityOptimized(
            payment_method,
            transaction_value,
            req.user._id
        );

        // Calculate potential points
        const pointCalculation = pointCriteria.calculatePoints(payment_method, transaction_value);

                return response_handler(res, 200, "Customer eligibility checked successfully", {
            point_criteria: {
                _id: pointCriteria._id,
                unique_code: pointCriteria.unique_code,
                description: pointCriteria.description,
                event_type: pointCriteria.eventType?.name,
                service_type: pointCriteria.serviceType?.name,
                app_type: pointCriteria.appType?.name
            },
            usage_history: {
                weekly_transactions: weeklyTransactions,
                monthly_transactions: monthlyTransactions,
                total_points_earned: totalPoints[0]?.total || 0,
                weekly_limit: pointCriteria.conditions.maxTransactions.weekly,
                monthly_limit: pointCriteria.conditions.maxTransactions.monthly
            },
            eligibility: eligibilityCheck,
            calculation: pointCalculation,
            transaction_limits: eligibilityCheck.details.transactionLimits
        });
    } catch (error) {
        logger.error(`Error checking customer eligibility: ${error.message}`);
        return response_handler(res, 500, error.message, null);
    }
}; 