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

        // Calculate opening balance (all transactions before start date)
        const openingBalanceResult = await Transaction.aggregate([
            {
                $match: {
                    transaction_date: { $lt: startDate },
                    status: "completed",
                },
            },
            {
                $group: {
                    _id: null,
                    total: { $sum: "$points" },
                },
            },
        ]);

        const openingBalance = openingBalanceResult[0]?.total || 0;

        // Calculate closing balance (all transactions up to end date)
        const closingBalanceResult = await Transaction.aggregate([
            {
                $match: {
                    transaction_date: { $lte: endDate },
                    status: "completed",
                },
            },
            {
                $group: {
                    _id: null,
                    total: { $sum: "$points" },
                },
            },
        ]);

        const closingBalance = closingBalanceResult[0]?.total || 0;

        // Process each app type
        for (const appType of appTypes) {
            const appTypeId = appType._id;
            const appTypeName = appType.name;

            // 1. Registered Users Count - customers where app_type[0] matches and created within date range
            // Using aggregation to check first element of array and createdAt date
            const registeredUsersResult = await Customer.aggregate([
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
            ]);
            const registeredUsers = registeredUsersResult[0]?.count || 0;

            // 2. Points Earning
            // Get distinct customers who earned points in date range
            const earnUserCountResult = await Transaction.aggregate([
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
            ]);

            const earnUserCount = earnUserCountResult[0]?.count || 0;

            // Get transaction count and total points for earning
            const earnStatsResult = await Transaction.aggregate([
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
            ]);

            const earnTransactionCount = earnStatsResult[0]?.transactionCount || 0;
            const earnTotalPoints = earnStatsResult[0]?.totalPoints || 0;

            // 3. Points Redeemed
            // Get distinct customers who redeemed points in date range
            const redeemUserCountResult = await Transaction.aggregate([
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
            ]);

            const redeemUserCount = redeemUserCountResult[0]?.count || 0;

            // Get transaction count and total points for redemption
            const redeemStatsResult = await Transaction.aggregate([
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
                        totalPoints: { $sum: { $abs: "$points" } },
                    },
                },
            ]);

            const redeemTransactionCount = redeemStatsResult[0]?.transactionCount || 0;
            const redeemTotalPoints = redeemStatsResult[0]?.totalPoints || 0;

            reportData[appTypeName] = {
                registeredUsers,
                pointsEarning: {
                    userCount: earnUserCount,
                    transactionCount: earnTransactionCount,
                    totalPoints: earnTotalPoints,
                },
                pointsRedeemed: {
                    userCount: redeemUserCount,
                    transactionCount: redeemTransactionCount,
                    totalPoints: redeemTotalPoints,
                },
            };
        }

        const response = {
            appTypes: appTypes.map((at) => ({
                _id: at._id,
                name: at.name,
            })),
            reportData,
            openingBalance,
            closingBalance,
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

/**
 * Export report data as CSV
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const exportReportCSV = async (req, res) => {
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
                400,
                "No app types found to generate report"
            );
        }

        // Calculate opening and closing balances
        const openingBalanceResult = await Transaction.aggregate([
            {
                $match: {
                    transaction_date: { $lt: startDate },
                    status: "completed",
                },
            },
            {
                $group: {
                    _id: null,
                    total: { $sum: "$points" },
                },
            },
        ]);

        const openingBalance = openingBalanceResult[0]?.total || 0;

        const closingBalanceResult = await Transaction.aggregate([
            {
                $match: {
                    transaction_date: { $lte: endDate },
                    status: "completed",
                },
            },
            {
                $group: {
                    _id: null,
                    total: { $sum: "$points" },
                },
            },
        ]);

        const closingBalance = closingBalanceResult[0]?.total || 0;

        // Build CSV data
        const csvRows = [];

        // Header row
        const headerRow = [""];
        appTypes.forEach((appType) => {
            headerRow.push(appType.name);
        });
        csvRows.push(headerRow.join(","));

        // Registered Users row
        const registeredUsersRow = ["No of registered Users"];
        for (const appType of appTypes) {
            const result = await Customer.aggregate([
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
                        firstAppType: appType._id,
                    },
                },
                {
                    $count: "count",
                },
            ]);
            registeredUsersRow.push(result[0]?.count || 0);
        }
        csvRows.push(registeredUsersRow.join(","));

        // Points Earning section
        csvRows.push("Points Earning,,,");

        // Get earning user counts
        const earnUserCounts = [];
        for (const appType of appTypes) {
            const result = await Transaction.aggregate([
                {
                    $match: {
                        transaction_type: "earn",
                        status: "completed",
                        transaction_date: { $gte: startDate, $lte: endDate },
                        "metadata.requested_by": appType.name,
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
            ]);
            earnUserCounts.push(result[0]?.count || 0);
        }
        csvRows.push("No of Users," + earnUserCounts.join(","));

        // Get earning transaction counts
        const earnTransactionCounts = [];
        for (const appType of appTypes) {
            const result = await Transaction.aggregate([
                {
                    $match: {
                        transaction_type: "earn",
                        status: "completed",
                        transaction_date: { $gte: startDate, $lte: endDate },
                        "metadata.requested_by": appType.name,
                    },
                },
                {
                    $group: {
                        _id: null,
                        count: { $sum: 1 },
                    },
                },
            ]);
            earnTransactionCounts.push(result[0]?.count || 0);
        }
        csvRows.push("No of transaction," + earnTransactionCounts.join(","));

        // Get earning total points
        const earnTotalPoints = [];
        for (const appType of appTypes) {
            const result = await Transaction.aggregate([
                {
                    $match: {
                        transaction_type: "earn",
                        status: "completed",
                        transaction_date: { $gte: startDate, $lte: endDate },
                        "metadata.requested_by": appType.name,
                    },
                },
                {
                    $group: {
                        _id: null,
                        total: { $sum: "$points" },
                    },
                },
            ]);
            earnTotalPoints.push(result[0]?.total || 0);
        }
        csvRows.push("Total Points Earned," + earnTotalPoints.join(","));

        // Points Redeemed section
        csvRows.push("Points Redeemed,,,");
        csvRows.push("No of Users," + appTypes.map(() => "").join(","));

        // Get redeemed user counts
        const redeemUserCounts = [];
        for (const appType of appTypes) {
            const result = await Transaction.aggregate([
                {
                    $match: {
                        transaction_type: "redeem",
                        status: "completed",
                        transaction_date: { $gte: startDate, $lte: endDate },
                        "metadata.requested_by": appType.name,
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
            ]);
            redeemUserCounts.push(result[0]?.count || 0);
        }
        csvRows.push("No of Users," + redeemUserCounts.join(","));

        // Get redeemed transaction counts
        const redeemTransactionCounts = [];
        for (const appType of appTypes) {
            const result = await Transaction.aggregate([
                {
                    $match: {
                        transaction_type: "redeem",
                        status: "completed",
                        transaction_date: { $gte: startDate, $lte: endDate },
                        "metadata.requested_by": appType.name,
                    },
                },
                {
                    $group: {
                        _id: null,
                        count: { $sum: 1 },
                    },
                },
            ]);
            redeemTransactionCounts.push(result[0]?.count || 0);
        }
        csvRows.push("No of transaction," + redeemTransactionCounts.join(","));

        // Get redeemed total points
        const redeemTotalPoints = [];
        for (const appType of appTypes) {
            const result = await Transaction.aggregate([
                {
                    $match: {
                        transaction_type: "redeem",
                        status: "completed",
                        transaction_date: { $gte: startDate, $lte: endDate },
                        "metadata.requested_by": appType.name,
                    },
                },
                {
                    $group: {
                        _id: null,
                        total: { $sum: { $abs: "$points" } },
                    },
                },
            ]);
            redeemTotalPoints.push(result[0]?.total || 0);
        }
        csvRows.push("Total Points Redeemed," + redeemTotalPoints.join(","));

        // Opening Balance row
        const openingBalanceRow = ["Opening Balance"];
        appTypes.forEach(() => {
            openingBalanceRow.push(openingBalance);
        });
        csvRows.push(openingBalanceRow.join(","));

        // Closing Balance row
        const closingBalanceRow = ["Closing Balance"];
        appTypes.forEach(() => {
            closingBalanceRow.push(closingBalance);
        });
        csvRows.push(closingBalanceRow.join(","));

        // Generate CSV content
        const csvContent = csvRows.join("\n");

        // Set response headers for file download
        const filename = `reports_${startDate.toISOString().split("T")[0]}_${endDate.toISOString().split("T")[0]}.csv`;
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

        return res.send(csvContent);
    } catch (error) {
        logger.error(`Error exporting report CSV: ${error.message}`, {
            stack: error.stack,
        });
        return response_handler(
            res,
            500,
            "Failed to export report CSV",
            error.message
        );
    }
};

module.exports = {
    getReportData,
    exportReportCSV,
};

