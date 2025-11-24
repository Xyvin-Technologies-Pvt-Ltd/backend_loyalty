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

            // Calculate opening balance for this app type (all transactions before start date)
            const appTypeOpeningBalanceResult = await Transaction.aggregate([
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
            ]);

            const appTypeOpeningBalance = appTypeOpeningBalanceResult[0]?.total || 0;

            // Calculate closing balance for this app type (all transactions up to end date)
            const appTypeClosingBalanceResult = await Transaction.aggregate([
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
            ]);

            const appTypeClosingBalance = appTypeClosingBalanceResult[0]?.total || 0;

            // 4. Total Promotion Points - transactions with PROMO in transaction_id
            const promoPointsResult = await Transaction.aggregate([
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
            ]);
            const totalPromoPoints = promoPointsResult[0]?.totalPoints || 0;

            // 5. Total Points Expired
            const expiredPointsResult = await Transaction.aggregate([
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
                        totalPoints: { $sum: { $abs: "$points" } },
                    },
                },
            ]);
            const totalExpiredPoints = expiredPointsResult[0]?.totalPoints || 0;

            // 6. Total Points Adjusted
            // For adjust transactions, check original transaction's requested_by if original_transaction_id exists
            const adjustedPointsResult = await Transaction.aggregate([
                {
                    $match: {
                        transaction_type: "adjust",
                        status: "completed",
                        transaction_date: { $gte: startDate, $lte: endDate },
                    },
                },
                {
                    $lookup: {
                        from: "transactions",
                        let: { originalTxId: "$metadata.original_transaction_id" },
                        pipeline: [
                            {
                                $match: {
                                    $expr: {
                                        $eq: ["$transaction_id", "$$originalTxId"],
                                    },
                                },
                            },
                            {
                                $project: {
                                    requested_by: "$metadata.requested_by",
                                },
                            },
                        ],
                        as: "originalTransaction",
                    },
                },
                {
                    $addFields: {
                        effectiveRequestedBy: {
                            $cond: {
                                if: {
                                    $and: [
                                        { $ne: ["$metadata.original_transaction_id", null] },
                                        { $gt: [{ $size: "$originalTransaction" }, 0] },
                                    ],
                                },
                                then: {
                                    $arrayElemAt: ["$originalTransaction.requested_by", 0],
                                },
                                else: "$metadata.requested_by",
                            },
                        },
                    },
                },
                {
                    $match: {
                        effectiveRequestedBy: appTypeName,
                    },
                },
                {
                    $group: {
                        _id: null,
                        totalPoints: { $sum: "$points" },
                    },
                },
            ]);
            const totalAdjustedPoints = adjustedPointsResult[0]?.totalPoints || 0;

            // 7. Admin Manual Point Reduction - redeem transactions with ADMIN in transaction_id
            const adminReductionResult = await Transaction.aggregate([
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
                        totalPoints: { $sum: { $abs: "$points" } },
                    },
                },
            ]);
            const adminReductionPoints = adminReductionResult[0]?.totalPoints || 0;

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
                openingBalance: appTypeOpeningBalance,
                closingBalance: appTypeClosingBalance,
                totalPromoPoints,
                totalExpiredPoints,
                totalAdjustedPoints,
                adminReductionPoints,
            };
        }

        // Calculate global totals
        let totalRegisteredUsers = 0;
        let totalEarnUserCount = 0;
        let totalEarnTransactionCount = 0;
        let totalEarnTotalPoints = 0;
        let totalRedeemUserCount = 0;
        let totalRedeemTransactionCount = 0;
        let totalRedeemTotalPoints = 0;
        let totalPromoPoints = 0;
        let totalExpiredPoints = 0;
        let totalAdjustedPoints = 0;
        let totalAdminReductionPoints = 0;
        let totalOpeningBalance = 0;
        let totalClosingBalance = 0;

        for (const appType of appTypes) {
            const appTypeData = reportData[appType.name];
            totalRegisteredUsers += appTypeData.registeredUsers;
            totalEarnUserCount += appTypeData.pointsEarning.userCount;
            totalEarnTransactionCount += appTypeData.pointsEarning.transactionCount;
            totalEarnTotalPoints += appTypeData.pointsEarning.totalPoints;
            totalRedeemUserCount += appTypeData.pointsRedeemed.userCount;
            totalRedeemTransactionCount += appTypeData.pointsRedeemed.transactionCount;
            totalRedeemTotalPoints += appTypeData.pointsRedeemed.totalPoints;
            totalPromoPoints += appTypeData.totalPromoPoints;
            totalExpiredPoints += appTypeData.totalExpiredPoints;
            totalAdjustedPoints += appTypeData.totalAdjustedPoints;
            totalAdminReductionPoints += appTypeData.adminReductionPoints;
            totalOpeningBalance += appTypeData.openingBalance;
            totalClosingBalance += appTypeData.closingBalance;
        }

        // Calculate Net Movement
        // Net Movement = Total Points Earned - Total Points Redeemed - Total Points Expired - Admin Manual Reduction + Total Promotion Points + Total Points Adjusted
        // Note: Promotion points are already included in Total Points Earned, so we need to adjust
        // Actually, looking at the CSV format, Net Movement seems to be: Earned - Redeemed - Expired - Admin Reduction + Adjusted
        // Promotion points might be separate. Let me recalculate: Earned includes promo, so Net = Earned - Redeemed - Expired - Admin + Adjusted
        const netMovement = totalEarnTotalPoints - totalRedeemTotalPoints - totalExpiredPoints - totalAdminReductionPoints + totalAdjustedPoints;

        const response = {
            appTypes: appTypes.map((at) => ({
                _id: at._id,
                name: at.name,
            })),
            reportData,
            openingBalance,
            closingBalance,
            totals: {
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
                totalAdjustedPoints,
                adminReductionPoints: totalAdminReductionPoints,
                openingBalance: totalOpeningBalance,
                closingBalance: totalClosingBalance,
                netMovement,
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
        headerRow.push("Total");
        csvRows.push(headerRow.join(","));

        // Opening Balance row - per app type and total
        const openingBalanceRow = ["Opening Balance"];
        let totalOpeningBalance = 0;
        for (const appType of appTypes) {
            const result = await Transaction.aggregate([
                {
                    $match: {
                        transaction_date: { $lt: startDate },
                        status: "completed",
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
            const balance = result[0]?.total || 0;
            openingBalanceRow.push(balance);
            totalOpeningBalance += balance;
        }
        openingBalanceRow.push(totalOpeningBalance);
        csvRows.push(openingBalanceRow.join(","));

        // Registered Users row
        const registeredUsersRow = ["No of registered Users"];
        let totalRegisteredUsers = 0;
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
            const count = result[0]?.count || 0;
            registeredUsersRow.push(count);
            totalRegisteredUsers += count;
        }
        registeredUsersRow.push(totalRegisteredUsers);
        csvRows.push(registeredUsersRow.join(","));

        // New Registration during the period row (same as registered users)
        const newRegistrationRow = ["New Registration during the period"];
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
            newRegistrationRow.push(result[0]?.count || 0);
        }
        newRegistrationRow.push(totalRegisteredUsers);
        csvRows.push(newRegistrationRow.join(","));

        // Closing Balance row - per app type and total
        const closingBalanceRow = ["Closing Balance"];
        let totalClosingBalance = 0;
        for (const appType of appTypes) {
            const result = await Transaction.aggregate([
                {
                    $match: {
                        transaction_date: { $lte: endDate },
                        status: "completed",
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
            const balance = result[0]?.total || 0;
            closingBalanceRow.push(balance);
            totalClosingBalance += balance;
        }
        closingBalanceRow.push(totalClosingBalance);
        csvRows.push(closingBalanceRow.join(","));

        // Points Earning section
        csvRows.push("Points Earning,,,");

        // Get earning user counts
        const earnUserCounts = [];
        let totalEarnUserCount = 0;
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
            const count = result[0]?.count || 0;
            earnUserCounts.push(count);
            totalEarnUserCount += count;
        }
        earnUserCounts.push(totalEarnUserCount);
        csvRows.push("No of Users," + earnUserCounts.join(","));

        // Get earning transaction counts
        const earnTransactionCounts = [];
        let totalEarnTransactionCount = 0;
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
            const count = result[0]?.count || 0;
            earnTransactionCounts.push(count);
            totalEarnTransactionCount += count;
        }
        earnTransactionCounts.push(totalEarnTransactionCount);
        csvRows.push("No of transaction," + earnTransactionCounts.join(","));

        // Get earning total points
        const earnTotalPoints = [];
        let totalEarnTotalPoints = 0;
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
            const total = result[0]?.total || 0;
            earnTotalPoints.push(total);
            totalEarnTotalPoints += total;
        }
        earnTotalPoints.push(totalEarnTotalPoints);
        csvRows.push("Total Points Earned," + earnTotalPoints.join(","));

        // Total Promotion Points row
        const promoPointsRow = ["Total Promotion Points"];
        let totalPromoPoints = 0;
        for (const appType of appTypes) {
            const result = await Transaction.aggregate([
                {
                    $match: {
                        transaction_type: "earn",
                        status: "completed",
                        transaction_date: { $gte: startDate, $lte: endDate },
                        transaction_id: { $regex: /^PROMO-/ },
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
            const total = result[0]?.total || 0;
            promoPointsRow.push(total);
            totalPromoPoints += total;
        }
        promoPointsRow.push(totalPromoPoints);
        csvRows.push(promoPointsRow.join(","));

        // Points Redeemed section
        csvRows.push("Points Redeemed,,,");

        // Get redeemed user counts
        const redeemUserCounts = [];
        let totalRedeemUserCount = 0;
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
            const count = result[0]?.count || 0;
            redeemUserCounts.push(count);
            totalRedeemUserCount += count;
        }
        redeemUserCounts.push(totalRedeemUserCount);
        csvRows.push("No of Users," + redeemUserCounts.join(","));

        // Get redeemed transaction counts
        const redeemTransactionCounts = [];
        let totalRedeemTransactionCount = 0;
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
            const count = result[0]?.count || 0;
            redeemTransactionCounts.push(count);
            totalRedeemTransactionCount += count;
        }
        redeemTransactionCounts.push(totalRedeemTransactionCount);
        csvRows.push("No of transaction," + redeemTransactionCounts.join(","));

        // Get redeemed total points
        const redeemTotalPoints = [];
        let totalRedeemTotalPoints = 0;
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
            const total = result[0]?.total || 0;
            redeemTotalPoints.push(total);
            totalRedeemTotalPoints += total;
        }
        redeemTotalPoints.push(totalRedeemTotalPoints);
        csvRows.push("Total Points Redeemed," + redeemTotalPoints.join(","));

        // Total Points Expired row
        const expiredPointsRow = ["Total Points Expired"];
        let totalExpiredPoints = 0;
        for (const appType of appTypes) {
            const result = await Transaction.aggregate([
                {
                    $match: {
                        transaction_type: "expire",
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
            const total = result[0]?.total || 0;
            expiredPointsRow.push(total);
            totalExpiredPoints += total;
        }
        expiredPointsRow.push(totalExpiredPoints);
        csvRows.push(expiredPointsRow.join(","));

        // Total Points Adjusted row
        const adjustedPointsRow = ["Total Points Adjusted/Withdrawal"];
        let totalAdjustedPoints = 0;
        for (const appType of appTypes) {
            const result = await Transaction.aggregate([
                {
                    $match: {
                        transaction_type: "adjust",
                        status: "completed",
                        transaction_date: { $gte: startDate, $lte: endDate },
                    },
                },
                {
                    $lookup: {
                        from: "transactions",
                        let: { originalTxId: "$metadata.original_transaction_id" },
                        pipeline: [
                            {
                                $match: {
                                    $expr: {
                                        $eq: ["$transaction_id", "$$originalTxId"],
                                    },
                                },
                            },
                            {
                                $project: {
                                    requested_by: "$metadata.requested_by",
                                },
                            },
                        ],
                        as: "originalTransaction",
                    },
                },
                {
                    $addFields: {
                        effectiveRequestedBy: {
                            $cond: {
                                if: {
                                    $and: [
                                        { $ne: ["$metadata.original_transaction_id", null] },
                                        { $gt: [{ $size: "$originalTransaction" }, 0] },
                                    ],
                                },
                                then: {
                                    $arrayElemAt: ["$originalTransaction.requested_by", 0],
                                },
                                else: "$metadata.requested_by",
                            },
                        },
                    },
                },
                {
                    $match: {
                        effectiveRequestedBy: appType.name,
                    },
                },
                {
                    $group: {
                        _id: null,
                        total: { $sum: "$points" },
                    },
                },
            ]);
            const total = result[0]?.total || 0;
            adjustedPointsRow.push(total);
            totalAdjustedPoints += total;
        }
        adjustedPointsRow.push(totalAdjustedPoints);
        csvRows.push(adjustedPointsRow.join(","));

        // Admin Manual Point Reduction row
        const adminReductionRow = ["Admin Manual Point Reduction"];
        let totalAdminReductionPoints = 0;
        for (const appType of appTypes) {
            const result = await Transaction.aggregate([
                {
                    $match: {
                        transaction_type: "redeem",
                        status: "completed",
                        transaction_date: { $gte: startDate, $lte: endDate },
                        transaction_id: { $regex: /^ADMIN-/ },
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
            const total = result[0]?.total || 0;
            adminReductionRow.push(total);
            totalAdminReductionPoints += total;
        }
        adminReductionRow.push(totalAdminReductionPoints);
        csvRows.push(adminReductionRow.join(","));

        // Net Movement row
        const netMovement = totalEarnTotalPoints - totalRedeemTotalPoints - totalExpiredPoints - totalAdminReductionPoints + totalAdjustedPoints;
        const netMovementRow = ["Net Movement"];
        // Calculate per app type net movement
        for (let i = 0; i < appTypes.length; i++) {
            const appTypeEarned = earnTotalPoints[i] || 0;
            const appTypeRedeemed = redeemTotalPoints[i] || 0;
            const appTypeExpired = expiredPointsRow[i + 1] || 0;
            const appTypeAdjusted = adjustedPointsRow[i + 1] || 0;
            const appTypeAdminReduction = adminReductionRow[i + 1] || 0;
            const appTypeNetMovement = appTypeEarned - appTypeRedeemed - appTypeExpired - appTypeAdminReduction + appTypeAdjusted;
            netMovementRow.push(appTypeNetMovement);
        }
        netMovementRow.push(netMovement);
        csvRows.push(netMovementRow.join(","));

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

