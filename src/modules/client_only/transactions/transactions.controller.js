const Transaction = require("../../../models/transaction_model");
const response_handler = require("../../../helpers/response_handler");
const { logger } = require("../../../middlewares/logger");
const { resolveOmanDateRange } = require("../../../utils/date");

exports.getMyTransactions = async (req, res) => {
    try {
        const {
            page = 1,
            limit = 10,
            transaction_type,
            start_date,
            end_date,
            status
        } = req.query;

        // Build query with authenticated user's ID
        const query = { customer_id: req.user._id };

        // Add filters if provided
        if (transaction_type) {
            query.transaction_type = transaction_type;
        }
        if (status) {
            query.status = status;
        }
        if (start_date || end_date) {
            const { startDate: gte, endDate: lte } = resolveOmanDateRange(
                start_date,
                end_date,
                { fallback: "none" }
            );
            query.transaction_date = {};
            if (gte) query.transaction_date.$gte = gte;
            if (lte) query.transaction_date.$lte = lte;
        }

        // Calculate pagination
        const skip = (page - 1) * limit;

        // Get transactions with pagination and populate references
        const transactions = await Transaction.find(query)
            .populate("point_criteria", "name description points")
            .populate("app_type", "name")
            .sort({ transaction_date: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        // Get total count for pagination
        const total = await Transaction.countDocuments(query);

        // Calculate summary
        const summary = await Transaction.aggregate([
            { $match: query },
            {
                $group: {
                    _id: "$transaction_type",
                    total_points: { $sum: "$points" },
                    count: { $sum: 1 }
                }
            }
        ]);

        return response_handler(res, 200, "Transactions retrieved successfully", {
            transactions,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                total_pages: Math.ceil(total / limit)
            },
            summary: summary.reduce((acc, curr) => {
                acc[curr._id] = {
                    total_points: curr.total_points,
                    count: curr.count
                };
                return acc;
            }, {})
        });
    } catch (error) {
        logger.error(`Error fetching transactions: ${error.message}`);
        return response_handler(res, 500, error.message, null);
    }
};

exports.getTransactionById = async (req, res) => {
    try {
        const { transaction_id } = req.params;

        const transaction = await Transaction.findOne({
            transaction_id,
            customer_id: req.user._id
        })
            .populate("point_criteria", "name description points")
            .populate("app_type", "name");

        if (!transaction) {
            return response_handler(res, 404, "Transaction not found", null);
        }

        return response_handler(res, 200, "Transaction retrieved successfully", transaction);
    } catch (error) {
        logger.error(`Error fetching transaction: ${error.message}`);
        return response_handler(res, 500, error.message, null);
    }
};

exports.getTransactionSummary = async (req, res) => {
    try {
        const { start_date, end_date } = req.query;

        // Build date query if provided
        const dateQuery = {
            customer_id: req.user._id
        };
        if (start_date || end_date) {
            const { startDate: gte, endDate: lte } = resolveOmanDateRange(
                start_date,
                end_date,
                { fallback: "none" }
            );
            dateQuery.transaction_date = {};
            if (gte) dateQuery.transaction_date.$gte = gte;
            if (lte) dateQuery.transaction_date.$lte = lte;
        }

        // Get summary by transaction type
        const summaryByType = await Transaction.aggregate([
            {
                $match: {
                    customer_id: req.user._id,
                    ...dateQuery
                }
            },
            {
                $group: {
                    _id: "$transaction_type",
                    total_points: { $sum: "$points" },
                    count: { $sum: 1 },
                    avg_points: { $avg: "$points" }
                }
            }
        ]);

        // Get summary by status
        const summaryByStatus = await Transaction.aggregate([
            {
                $match: {
                    customer_id: req.user._id,
                    ...dateQuery
                }
            },
            {
                $group: {
                    _id: "$status",
                    count: { $sum: 1 }
                }
            }
        ]);

        // Get total points
        const totalPoints = await Transaction.aggregate([
            {
                $match: {
                    customer_id: req.user._id,
                    ...dateQuery
                }
            },
            {
                $group: {
                    _id: null,
                    total_earned: { $sum: { $cond: [{ $eq: ["$transaction_type", "earn"] }, "$points", 0] } },
                    total_redeemed: { $sum: { $cond: [{ $eq: ["$transaction_type", "redeem"] }, "$points", 0] } },
                    total_expired: { $sum: { $cond: [{ $eq: ["$transaction_type", "expire"] }, "$points", 0] } },
                    total_adjusted: { $sum: { $cond: [{ $eq: ["$transaction_type", "adjust"] }, "$points", 0] } }
                }
            }
        ]);

        return response_handler(res, 200, "Transaction summary retrieved successfully", {
            summary_by_type: summaryByType.reduce((acc, curr) => {
                acc[curr._id] = {
                    total_points: curr.total_points,
                    count: curr.count,
                    avg_points: curr.avg_points
                };
                return acc;
            }, {}),
            summary_by_status: summaryByStatus.reduce((acc, curr) => {
                acc[curr._id] = curr.count;
                return acc;
            }, {}),
            total_points: totalPoints[0] || {
                total_earned: 0,
                total_redeemed: 0,
                total_expired: 0,
                total_adjusted: 0
            }
        });
    } catch (error) {
        logger.error(`Error fetching transaction summary: ${error.message}`);
            return response_handler(res, 500, error.message, null);
    }
}; 