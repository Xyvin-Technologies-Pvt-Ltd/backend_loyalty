const Customer = require("../../models/customer_model");
const Transaction = require("../../models/transaction_model");
const AppType = require("../../models/app_type_model");
const { logger } = require("../../middlewares/logger");
const response_handler = require("../../helpers/response_handler");
const mongoose = require("mongoose");

/**
 * Get report data for app types
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getReportData = async (req, res) => {
    try {
        let { startDate, endDate } = req.query;

        // Set default to current month if not provided
        const now = new Date();
        if (!startDate) {
            startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        } else {
            startDate = new Date(startDate);
        }

        if (!endDate) {
            endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
        } else {
            endDate = new Date(endDate);
            endDate.setHours(23, 59, 59, 999);
        }

        // Set start date to 00:00:00
        startDate.setHours(0, 0, 0, 0);

        // Fetch all app types
        const appTypes = await AppType.find({ isActive: true }).sort({ name: 1 });

        if (appTypes.length === 0) {
            return response_handler(
                res,
                200,
                "No app types found",
                {
                    appTypes: [],
                    reportData: {},
                    dateRange: {
                        startDate: startDate.toISOString(),
                        endDate: endDate.toISOString(),
                    },
                }
            );
        }

        const reportData = {};

        // Process all app types in parallel for better performance
        const processAppType = async (appType) => {
            const appTypeId = appType._id;
            const appTypeName = appType.name;

            // Run all queries for this app type in parallel
            const [
                openingUserCountResult,
                closingUserCountResult,
                registeredUsersResult,
                earnUserCountResult,
                earnStatsResult,
                redeemUserCountResult,
                redeemStatsResult,
                appTypeOpeningBalanceResult,
                appTypeClosingBalanceResult,
                promoPointsResult,
                adminReductionResult,
                expiredPointsResult,
            ] = await Promise.all([
                // 0. Opening User Count
                Customer.aggregate([
                    {
                        $match: {
                            app_type: { $exists: true, $ne: [] },
                            createdAt: { $lt: startDate },
                        },
                    },
                    {
                        $project: {
                            firstAppType: { $arrayElemAt: ["$app_type", 0] },
                        },
                    },
                    {
                        $match: {
                            firstAppType: appTypeId,
                        },
                    },
                    {
                        $count: "count",
                    },
                ]),
                // 0. Closing User Count
                Customer.aggregate([
                    {
                        $match: {
                            app_type: { $exists: true, $ne: [] },
                            createdAt: { $lte: endDate },
                        },
                    },
                    {
                        $project: {
                            firstAppType: { $arrayElemAt: ["$app_type", 0] },
                        },
                    },
                    {
                        $match: {
                            firstAppType: appTypeId,
                        },
                    },
                    {
                        $count: "count",
                    },
                ]),
                // 1. Registered Users Count
                Customer.aggregate([
                    {
                        $match: {
                            app_type: { $exists: true, $ne: [] },
                            createdAt: { $gte: startDate, $lte: endDate },
                        },
                    },
                    {
                        $project: {
                            firstAppType: { $arrayElemAt: ["$app_type", 0] },
                        },
                    },
                    {
                        $match: {
                            firstAppType: appTypeId,
                        },
                    },
                    {
                        $count: "count",
                    },
                ]),
                // 2. Points Earning - User Count
                Transaction.aggregate([
                    {
                        $match: {
                            transaction_type: "earn",
                            status: "completed",
                            transaction_date: { $gte: startDate, $lte: endDate },
                            "metadata.requested_by": appTypeName,
                        },
                    },
                    {
                        $group: {
                            _id: "$customer_id",
                        },
                    },
                    {
                        $count: "count",
                    },
                ]),
                // 2. Points Earning - Stats (combined query)
                Transaction.aggregate([
                    {
                        $match: {
                            transaction_type: "earn",
                            status: "completed",
                            transaction_date: { $gte: startDate, $lte: endDate },
                            "metadata.requested_by": appTypeName,
                        },
                    },
                    {
                        $group: {
                            _id: null,
                            transactionCount: { $sum: 1 },
                            totalPoints: { $sum: "$points" },
                        },
                    },
                ]),
                // 3. Points Redeemed - User Count
                Transaction.aggregate([
                    {
                        $match: {
                            transaction_type: "redeem",
                            status: "completed",
                            transaction_date: { $gte: startDate, $lte: endDate },
                            "metadata.requested_by": appTypeName,
                        },
                    },
                    {
                        $group: {
                            _id: "$customer_id",
                        },
                    },
                    {
                        $count: "count",
                    },
                ]),
                // 3. Points Redeemed - Stats (combined query)
                Transaction.aggregate([
                    {
                        $match: {
                            transaction_type: "redeem",
                            status: "completed",
                            transaction_date: { $gte: startDate, $lte: endDate },
                            "metadata.requested_by": appTypeName,
                        },
                    },
                    {
                        $group: {
                            _id: null,
                            transactionCount: { $sum: 1 },
                            totalPoints: { $sum: "$points" },
                        },
                    },
                ]),
                // Opening Balance
                Transaction.aggregate([
                    {
                        $match: {
                            transaction_date: { $lt: startDate },
                            status: "completed",
                            "metadata.requested_by": appTypeName,
                        },
                    },
                    {
                        $group: {
                            _id: null,
                            total: { $sum: "$points" },
                        },
                    },
                ]),
                // Closing Balance
                Transaction.aggregate([
                    {
                        $match: {
                            transaction_date: { $lte: endDate },
                            status: "completed",
                            "metadata.requested_by": appTypeName,
                        },
                    },
                    {
                        $group: {
                            _id: null,
                            total: { $sum: "$points" },
                        },
                    },
                ]),
                // 4. Total Promotion Points
                Transaction.aggregate([
                    {
                        $match: {
                            transaction_type: "earn",
                            status: "completed",
                            transaction_date: { $gte: startDate, $lte: endDate },
                            transaction_id: { $regex: /^PROMO-/ },
                            "metadata.requested_by": appTypeName,
                        },
                    },
                    {
                        $group: {
                            _id: null,
                            totalPoints: { $sum: "$points" },
                        },
                    },
                ]),
                // 7. Admin Manual Point Reduction
                Transaction.aggregate([
                    {
                        $match: {
                            transaction_type: "redeem",
                            status: "completed",
                            transaction_date: { $gte: startDate, $lte: endDate },
                            transaction_id: { $regex: /^ADMIN-/ },
                            "metadata.requested_by": appTypeName,
                        },
                    },
                    {
                        $group: {
                            _id: null,
                            totalPoints: { $sum: "$points" },
                        },
                    },
                ]),
                // 8. Total Points Expired (per app type)
                Transaction.aggregate([
                    {
                        $match: {
                            transaction_type: "expire",
                            status: "completed",
                            transaction_date: { $gte: startDate, $lte: endDate },
                            "metadata.requested_by": appTypeName,
                        },
                    },
                    {
                        $group: {
                            _id: null,
                            totalPoints: { $sum: "$points" },
                        },
                    },
                ]),
            ]);

            return {
                appTypeName,
                data: {
                    openingUserCount: openingUserCountResult[0]?.count || 0,
                    closingUserCount: closingUserCountResult[0]?.count || 0,
                    registeredUsers: registeredUsersResult[0]?.count || 0,
                    pointsEarning: {
                        userCount: earnUserCountResult[0]?.count || 0,
                        transactionCount: earnStatsResult[0]?.transactionCount || 0,
                        totalPoints: earnStatsResult[0]?.totalPoints || 0,
                    },
                    pointsRedeemed: {
                        userCount: redeemUserCountResult[0]?.count || 0,
                        transactionCount: redeemStatsResult[0]?.transactionCount || 0,
                        totalPoints: redeemStatsResult[0]?.totalPoints || 0,
                    },
                    openingBalance: appTypeOpeningBalanceResult[0]?.total || 0,
                    closingBalance: appTypeClosingBalanceResult[0]?.total || 0,
                    totalPromoPoints: promoPointsResult[0]?.totalPoints || 0,
                    adminReductionPoints: adminReductionResult[0]?.totalPoints || 0,
                    totalExpiredPoints: expiredPointsResult[0]?.totalPoints || 0,
                },
            };
        };

        // Process all app types in parallel
        const appTypeResults = await Promise.all(appTypes.map(processAppType));

        // Build reportData object from results
        appTypeResults.forEach((result) => {
            reportData[result.appTypeName] = result.data;
        });

        // Calculate global totals
        let totalOpeningUserCount = 0;
        let totalClosingUserCount = 0;
        let totalRegisteredUsers = 0;
        let totalEarnUserCount = 0;
        let totalEarnTransactionCount = 0;
        let totalEarnTotalPoints = 0;
        let totalRedeemUserCount = 0;
        let totalRedeemTransactionCount = 0;
        let totalRedeemTotalPoints = 0;
        let totalPromoPoints = 0;
        let totalAdminReductionPoints = 0;
        let totalExpiredPoints = 0;
        let totalOpeningBalance = 0;
        let totalClosingBalance = 0;

        for (const appType of appTypes) {
            const appTypeData = reportData[appType.name];
            totalOpeningUserCount += appTypeData.openingUserCount;
            totalClosingUserCount += appTypeData.closingUserCount;
            totalRegisteredUsers += appTypeData.registeredUsers;
            totalEarnUserCount += appTypeData.pointsEarning.userCount;
            totalEarnTransactionCount += appTypeData.pointsEarning.transactionCount;
            totalEarnTotalPoints += appTypeData.pointsEarning.totalPoints;
            totalRedeemUserCount += appTypeData.pointsRedeemed.userCount;
            totalRedeemTransactionCount += appTypeData.pointsRedeemed.transactionCount;
            totalRedeemTotalPoints += appTypeData.pointsRedeemed.totalPoints;
            totalPromoPoints += appTypeData.totalPromoPoints;
            totalAdminReductionPoints += appTypeData.adminReductionPoints;
            totalExpiredPoints += appTypeData.totalExpiredPoints;
            totalOpeningBalance += appTypeData.openingBalance;
            totalClosingBalance += appTypeData.closingBalance;
        }

        // Calculate net movement from summed balances
        const netMovementTotal = totalClosingBalance - totalOpeningBalance;

        const response = {
            appTypes: appTypes.map((at) => ({
                _id: at._id,
                name: at.name,
            })),
            reportData,
            openingBalance: totalOpeningBalance,
            closingBalance: totalClosingBalance,
            netMovement: netMovementTotal,
            totals: {
                openingUserCount: totalOpeningUserCount,
                closingUserCount: totalClosingUserCount,
                registeredUsers: totalRegisteredUsers,
                pointsEarning: {
                    userCount: totalEarnUserCount,
                    transactionCount: totalEarnTransactionCount,
                    totalPoints: totalEarnTotalPoints,
                },
                pointsRedeemed: {
                    userCount: totalRedeemUserCount,
                    transactionCount: totalRedeemTransactionCount,
                    totalPoints: totalRedeemTotalPoints,
                },
                totalPromoPoints,
                totalExpiredPoints,
                adminReductionPoints: totalAdminReductionPoints,
                openingBalance: totalOpeningBalance,
                closingBalance: totalClosingBalance,
                netMovement: netMovementTotal,
            },
            dateRange: {
                startDate: startDate.toISOString(),
                endDate: endDate.toISOString(),
            },
        };

        return response_handler(
            res,
            200,
            "Report data retrieved successfully",
            response
        );
    } catch (error) {
        logger.error(`Error retrieving report data: ${error.message}`, {
            stack: error.stack,
        });
        return response_handler(
            res,
            500,
            "Failed to retrieve report data",
            error.message
        );
    }
};

const exportReportCSV = async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        return response_handler(res, 200, "Report data exported successfully", null);
    } catch (error) {
        logger.error(`Error exporting report CSV: ${error.message}`, {
            stack: error.stack,
        });
        return response_handler(res, 500, "Failed to export report CSV", null);
    }
};



module.exports = {
    getReportData,
    exportReportCSV,
};

