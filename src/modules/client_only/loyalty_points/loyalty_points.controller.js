const LoyaltyPoints = require("../../../models/loyalty_points_model");
const Transaction = require("../../../models/transaction_model");
const response_handler = require("../../../helpers/response_handler");
const { logger } = require("../../../middlewares/logger");
const { OMAN_TIMEZONE, resolveOmanDateRange } = require("../../../utils/date");

exports.getMyPointsHistory = async (req, res) => {
    try {
        const {
            page = 1,
            limit = 10,
            status,
            start_date,
            end_date
        } = req.query;

        // Build query with authenticated user's ID
        const query = { customer_id: req.user._id };

        // Add filters if provided
        if (status) {
            query.status = status;
        }
        if (start_date || end_date) {
            // Resolved as Oman day boundaries — a bare `new Date(...)` reads
            // the boundary as UTC and, for end_date, silently excludes the
            // entire final day (midnight UTC, not end of day).
            const { startDate: gte, endDate: lte } = resolveOmanDateRange(
                start_date,
                end_date,
                { fallback: "none" }
            );
            query.earnedAt = {};
            if (gte) query.earnedAt.$gte = gte;
            if (lte) query.earnedAt.$lte = lte;
        }

        // Calculate pagination
        const skip = (page - 1) * limit;

        // Get points history with pagination and populate transaction details
        const pointsHistory = await LoyaltyPoints.find(query)
            .populate("transaction_id", "transaction_type transaction_date points")
            .sort({ earnedAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        // Get total count for pagination
        const total = await LoyaltyPoints.countDocuments(query);

        return response_handler(res, 200, "Points history retrieved successfully", {
            points_history: pointsHistory,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                total_pages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        logger.error(`Error fetching points history: ${error.message}`);
        return response_handler(res, 500, error.message, null);
    }
};

exports.getPointsSummary = async (req, res) => {
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
            dateQuery.earnedAt = {};
            if (gte) dateQuery.earnedAt.$gte = gte;
            if (lte) dateQuery.earnedAt.$lte = lte;
        }

        // Get points summary by status
        const summaryByStatus = await LoyaltyPoints.aggregate([
            {
                $match: dateQuery
            },
            {
                $group: {
                    _id: "$status",
                    total_points: { $sum: "$points" },
                    count: { $sum: 1 }
                }
            }
        ]);

        // Get points summary by transaction type
        const summaryByTransactionType = await LoyaltyPoints.aggregate([
            {
                $match: dateQuery
            },
            {
                $lookup: {
                    from: "transactions",
                    localField: "transaction_id",
                    foreignField: "_id",
                    as: "transaction"
                }
            },
            {
                $unwind: "$transaction"
            },
            {
                $group: {
                    _id: "$transaction.transaction_type",
                    total_points: { $sum: "$points" },
                    count: { $sum: 1 }
                }
            }
        ]);

        // Get points expiry summary
        const expirySummary = await LoyaltyPoints.aggregate([
            {
                $match: {
                    ...dateQuery,
                    status: "active"
                }
            },
            {
                $group: {
                    _id: {
                        // Grouped in Oman time — an expiry stamped just after
                        // UTC midnight on the 1st can still be the previous
                        // Oman month.
                        $dateToString: {
                            format: "%Y-%m",
                            date: "$expiryDate",
                            timezone: OMAN_TIMEZONE
                        }
                    },
                    total_points: { $sum: "$points" },
                    count: { $sum: 1 }
                }
            },
            {
                $sort: { _id: 1 }
            }
        ]);

        // Calculate total points
        const totalPoints = await LoyaltyPoints.aggregate([
            {
                $match: dateQuery
            },
            {
                $group: {
                    _id: null,
                    total_active: { $sum: { $cond: [{ $eq: ["$status", "active"] }, "$points", 0] } },
                    total_expired: { $sum: { $cond: [{ $eq: ["$status", "expired"] }, "$points", 0] } }
                }
            }
        ]);

        return response_handler(res, 200, "Points summary retrieved successfully", {
            summary_by_status: summaryByStatus.reduce((acc, curr) => {
                acc[curr._id] = {
                    total_points: curr.total_points,
                    count: curr.count
                };
                return acc;
            }, {}),
            summary_by_transaction_type: summaryByTransactionType.reduce((acc, curr) => {
                acc[curr._id] = {
                    total_points: curr.total_points,
                    count: curr.count
                };
                return acc;
            }, {}),
            expiry_summary: expirySummary,
            total_points: totalPoints[0] || {
                total_active: 0,
                total_expired: 0
            }
        });
    } catch (error) {
        logger.error(`Error fetching points summary: ${error.message}`);
        return response_handler(res, 500, error.message, null);
    }
};

exports.getPointsDetails = async (req, res) => {
    try {
        const { points_id } = req.params;

        const pointsDetails = await LoyaltyPoints.findOne({
            _id: points_id,
            customer_id: req.user._id
        }).populate("transaction_id", "transaction_type transaction_date points");

        if (!pointsDetails) {
            return response_handler(res, 404, "Points details not found", null);
        }

            return response_handler(res, 200, "Points details retrieved successfully", pointsDetails);
    } catch (error) {
        logger.error(`Error fetching points details: ${error.message}`);
        return response_handler(res, 500, error.message, null);
    }
}; 