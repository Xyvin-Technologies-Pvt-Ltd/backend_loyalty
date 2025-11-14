const Transaction = require("../../models/transaction_model");
const { v4: uuidv4 } = require("uuid");
const { logger } = require("../../middlewares/logger");
const response_handler  = require("../../helpers/response_handler");
const mongoose = require("mongoose");

const createTransaction = async (req, res) => {
  try {
    const {
      customer_id,
      transaction_type,
      source,
      points,
      trigger_event,
      trigger_service,
      point_criteria,
      app_type,
      note,
      reference_id,
      metadata,
    } = req.body;

    // Generate a unique transaction ID
    const transaction_id = uuidv4();

    // Create the transaction
    const transaction = new Transaction({
      customer_id,
      transaction_type,
      source,
      points,
      transaction_id,
      trigger_event,
      trigger_service,
      point_criteria,
      app_type,
      status: "completed", // Default to completed
      note,
      reference_id,
      transaction_date: new Date(),
      metadata,
    });

    await transaction.save();

    return response_handler(
      res,
      201,
      "Transaction created successfully",
      transaction
    );
  } catch (error) {
    logger.error(`Error creating transaction: ${error.message}`);
    return response_handler(
      res,
      500,
      "Failed to create transaction",
      error.message
    );
  }
};

const getAllTransactions = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      customer_id,
      transaction_type,
      status,
      points_criteria,
      payment_method,
      start_date,
      app_type,
      end_date,
      sort_by = "transaction_date",
      sort_order = "desc",
    } = req.query;

    // Build filter object
    const filter = {};

    if (customer_id) filter.customer_id = customer_id;
    if (transaction_type) filter.transaction_type = transaction_type;
    if (points_criteria) filter.points_criteria = points_criteria;
    if (status) filter.status = status;
    if (payment_method) filter.payment_method = payment_method;
    if (app_type) filter.app_type = app_type;

    // Date range filter
    if (start_date || end_date) {
      filter.transaction_date = {};
      if (start_date) filter.transaction_date.$gte = new Date(start_date);
      if (end_date) filter.transaction_date.$lte = new Date(end_date);
    }

    // Build sort object
    const sort = {};
    sort[sort_by] = sort_order === "asc" ? 1 : -1;

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Execute query with pagination
    const transactions = await Transaction.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit))
      .populate("customer_id", "name email phone customer_id")
      .populate("point_criteria")
      .populate("app_type", "name description");

    // Get total count for pagination
    const totalTransactions = await Transaction.countDocuments(filter);

    return response_handler(res, 200, "Transactions retrieved successfully", {
      transactions,
      pagination: {
        total: totalTransactions,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(totalTransactions / parseInt(limit)),
      },
    });
  } catch (error) {
    logger.error(`Error retrieving transactions: ${error.message}`);
    return response_handler(
      res,
      500,
      "Failed to retrieve transactions",
      error.message
    );
  }
};

const getTransactionById = async (req, res) => {
  try {
    const { id } = req.params;

    const transaction = await Transaction.findById(id)
      .populate("customer_id", "name email phone")
      .populate("point_criteria")
      .populate("app_type", "name description");

    if (!transaction) {
      return response_handler(res, 404, "Transaction not found");
    }

    return response_handler(
      res,
      200,
      "Transaction retrieved successfully",
      transaction
    );
  } catch (error) {
    logger.error(`Error retrieving transaction: ${error.message}`);
    return response_handler(
      res,
      500,
      "Failed to retrieve transaction",
      error.message
    );
  }
};


const getTransactionsByCustomer = async (req, res) => {
  try {
    const { customerId } = req.params;
    const {
      page = 1,
      limit = 10,
      transaction_type,
      source,
      status,
      start_date,
      end_date,
      sort_by = "transaction_date",
      sort_order = "desc",
    } = req.query;

    // Build filter object
    const filter = { customer_id: customerId };

    if (transaction_type) filter.transaction_type = transaction_type;
    if (source) filter.source = source;
    if (status) filter.status = status;

    // Date range filter
    if (start_date || end_date) {
      filter.transaction_date = {};
      if (start_date) filter.transaction_date.$gte = new Date(start_date);
      if (end_date) filter.transaction_date.$lte = new Date(end_date);
    }

    // Build sort object
    const sort = {};
    sort[sort_by] = sort_order === "asc" ? 1 : -1;

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Execute query with pagination
    const transactions = await Transaction.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit))
      .populate("trigger_event", "name description")
      .populate("trigger_service", "title description")
      .populate("point_criteria")
      .populate("app_type", "name description");

    // Get total count for pagination
    const totalTransactions = await Transaction.countDocuments(filter);

    // Calculate points earned (all positive point transactions that are completed)
    const pointsEarned = await Transaction.aggregate([
      {
        $match: {
          customer_id: customerId,
          points: { $gt: 0 },
          status: "completed",
        },
      },
      { $group: { _id: null, total: { $sum: "$points" } } },
    ]);

    // Calculate points spent (negative point transactions from redemptions that are completed)
    const pointsSpent = await Transaction.aggregate([
      {
        $match: {
          customer_id: customerId,
          points: { $lt: 0 },
          transaction_type: "redeem",
          status: "completed",
        },
      },
      { $group: { _id: null, total: { $sum: "$points" } } },
    ]);

    // Calculate points expired (negative point transactions from expirations that are completed)
    const pointsExpired = await Transaction.aggregate([
      {
        $match: {
          customer_id: customerId,
          points: { $lt: 0 },
          transaction_type: "expire",
          status: "completed",
        },
      },
      { $group: { _id: null, total: { $sum: "$points" } } },
    ]);

    // Calculate points adjusted (could be positive or negative)
    const pointsAdjusted = await Transaction.aggregate([
      {
        $match: {
          customer_id: customerId,
          transaction_type: "adjust",
          status: "completed",
        },
      },
      { $group: { _id: null, total: { $sum: "$points" } } },
    ]);

    const totalEarned = pointsEarned.length > 0 ? pointsEarned[0].total : 0;
    const totalSpent =
      pointsSpent.length > 0 ? Math.abs(pointsSpent[0].total) : 0; // Convert to positive for display
    const totalExpired =
      pointsExpired.length > 0 ? Math.abs(pointsExpired[0].total) : 0; // Convert to positive for display
    const totalAdjusted =
      pointsAdjusted.length > 0 ? pointsAdjusted[0].total : 0;

    // Current balance calculation
    const currentBalance =
      totalEarned - totalSpent - totalExpired + totalAdjusted;

    // Get upcoming expirations from LoyaltyPoints model
    const LoyaltyPoints = mongoose.model("LoyaltyPoints");
    const currentDate = new Date();

    // Points expiring in the next 30 days
    const expiringPoints = await LoyaltyPoints.aggregate([
      {
        $match: {
          customer_id: customerId,
          expiryDate: {
            $gt: currentDate,
            $lt: new Date(currentDate.getTime() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
          },
        },
      },
      { $group: { _id: null, total: { $sum: "$points" } } },
    ]);

    const pointsExpiringIn30Days =
      expiringPoints.length > 0 ? expiringPoints[0].total : 0;

    return res.status(200).json({
      status: 200,
      message: "Customer transactions retrieved successfully",
      data: {
        transactions,
        points_summary: {
          total_earned: totalEarned,
          total_spent: totalSpent,
          total_expired: totalExpired,
          total_adjusted: totalAdjusted,
          current_balance: currentBalance,
          expiring_in_30_days: pointsExpiringIn30Days,
        },
        pagination: {
          total: totalTransactions,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(totalTransactions / parseInt(limit)),
        },
      },
    });
  } catch (error) {
    logger.error(`Error retrieving customer transactions: ${error.message}`);
    return res.status(500).json({
      status: 500,
      message: "Failed to retrieve customer transactions",
      error: error.message,
    });
  }
};

const updateTransactionStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, note } = req.body;

    const transaction = await Transaction.findById(id);

    if (!transaction) {
      return response_handler(res, 404, "Transaction not found");
    }

    // Update status and note if provided
    transaction.status = status;
    if (note) transaction.note = note;

    await transaction.save();

    return response_handler(
      res,
      200,
      "Transaction status updated successfully",
      transaction
    );
  } catch (error) {
    logger.error(`Error updating transaction status: ${error.message}`);
    return response_handler(
      res,
      500,
      "Failed to update transaction status",
      error.message
    );
  }
};


const getCustomerPointBalance = async (req, res) => {
  try {
    const { customerId } = req.params;

    // Calculate points earned (all positive point transactions that are completed)
    const pointsEarned = await Transaction.aggregate([
      {
        $match: {
          customer_id: customerId,
          points: { $gt: 0 },
          status: "completed",
        },
      },
      { $group: { _id: null, total: { $sum: "$points" } } },
    ]);

    // Calculate points spent (negative point transactions from redemptions that are completed)
    const pointsSpent = await Transaction.aggregate([
      { $match: { customer_id: customerId, points: { $lt: 0 } } },
      { $group: { _id: null, total: { $sum: "$points" } } },
    ]);

    // Calculate points expired (negative point transactions from expirations that are completed)
    const pointsExpired = await Transaction.aggregate([
      {
        $match: {
          customer_id: customerId,
          points: { $lt: 0 },
          transaction_type: "expire",
          status: "completed",
        },
      },
      { $group: { _id: null, total: { $sum: "$points" } } },
    ]);

    // Calculate points adjusted (could be positive or negative)
    const pointsAdjusted = await Transaction.aggregate([
      {
        $match: {
          customer_id: customerId,
          transaction_type: "adjust",
          status: "completed",
        },
      },
      { $group: { _id: null, total: { $sum: "$points" } } },
    ]);

    const totalEarned = pointsEarned.length > 0 ? pointsEarned[0].total : 0;
    const totalSpent =
      pointsSpent.length > 0 ? Math.abs(pointsSpent[0].total) : 0; // Convert to positive for display
    const totalExpired =
      pointsExpired.length > 0 ? Math.abs(pointsExpired[0].total) : 0; // Convert to positive for display
    const totalAdjusted =
      pointsAdjusted.length > 0 ? pointsAdjusted[0].total : 0;

    // Current balance calculation
    const currentBalance =
      totalEarned - totalSpent - totalExpired + totalAdjusted;

    // Get upcoming expirations from LoyaltyPoints model
    const LoyaltyPoints = mongoose.model("LoyaltyPoints");
    const currentDate = new Date();

    // Points expiring in the next 30 days
    const expiringPoints = await LoyaltyPoints.aggregate([
      {
        $match: {
          customer_id: customerId,
          expiryDate: {
            $gt: currentDate,
            $lt: new Date(currentDate.getTime() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
          },
        },
      },
      { $group: { _id: null, total: { $sum: "$points" } } },
    ]);

    const pointsExpiringIn30Days =
      expiringPoints.length > 0 ? expiringPoints[0].total : 0;

    // Get recent transactions
    const recentTransactions = await Transaction.find({
      customer_id: customerId,
    })
      .sort({ transaction_date: -1 })
      .limit(5)
      .populate("trigger_event", "name")
      .populate("app_type", "name");

    return res.status(200).json({
      status: 200,
      message: "Customer point balance retrieved successfully",
      data: {
        points_summary: {
          total_earned: totalEarned,
          total_spent: totalSpent,
          total_expired: totalExpired,
          total_adjusted: totalAdjusted,
          current_balance: currentBalance,
          expiring_in_30_days: pointsExpiringIn30Days,
        },
        recent_transactions: recentTransactions,
      },
    });
  } catch (error) {
    logger.error(`Error retrieving customer point balance: ${error.message}`);
    return res.status(500).json({
      status: 500,
      message: "Failed to retrieve customer point balance",
      error: error.message,
    });
  }
};

module.exports = {
  createTransaction,
  getAllTransactions,
  getTransactionById,
  getTransactionsByCustomer,
  updateTransactionStatus,
  getCustomerPointBalance,
};
