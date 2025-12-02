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
                adjustedPointsResult,
                adminReductionResult,
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
                // 6. Total Points Adjusted
                Transaction.aggregate([
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
                    totalAdjustedPoints: adjustedPointsResult[0]?.totalPoints || 0,
                    adminReductionPoints: adminReductionResult[0]?.totalPoints || 0,
                },
            };
        };

        // Calculate global expiration (central activity, not app-specific)
        const expiredPointsResult = await Transaction.aggregate([
            {
                $match: {
                    transaction_type: "expire",
                    status: "completed",
                    transaction_date: { $gte: startDate, $lte: endDate },
                },
            },
            {
                $group: {
                    _id: null,
                    totalPoints: { $sum: "$points" },
                },
            },
        ]);

        const totalExpiredPoints = expiredPointsResult[0]?.totalPoints || 0;

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
        let totalAdjustedPoints = 0;
        let totalAdminReductionPoints = 0;
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
            totalAdjustedPoints += appTypeData.totalAdjustedPoints;
            totalAdminReductionPoints += appTypeData.adminReductionPoints;
            totalOpeningBalance += appTypeData.openingBalance;
            totalClosingBalance += appTypeData.closingBalance;
        }

        // Calculate Net Movement
        // Since all points already have correct signs, simply sum all values
        const netMovement = totalEarnTotalPoints + totalRedeemTotalPoints + totalExpiredPoints + totalAdjustedPoints + totalAdminReductionPoints;

        const response = {
            appTypes: appTypes.map((at) => ({
                _id: at._id,
                name: at.name,
            })),
            reportData,
            openingBalance,
            closingBalance,
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

        // Add date range header
        csvRows.push("Report Period:");
        csvRows.push(`Start Date: ${startDate.toISOString().split("T")[0]}`);
        csvRows.push(`End Date: ${endDate.toISOString().split("T")[0]}`);
        csvRows.push(""); // Blank row before data headers

        // Header row
        const headerRow = [""];
        appTypes.forEach((appType) => {
            headerRow.push(appType.name);
        });
        headerRow.push("Total");
        csvRows.push(headerRow.join(","));

        // Opening User Count row - per app type and total
        const openingUserCountRow = ["Opening User Count"];
        let totalOpeningUserCount = 0;
        for (const appType of appTypes) {
            const result = await Customer.aggregate([
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
                        firstAppType: appType._id,
                    },
                },
                {
                    $count: "count",
                },
            ]);
            const count = result[0]?.count || 0;
            openingUserCountRow.push(count);
            totalOpeningUserCount += count;
        }
        openingUserCountRow.push(totalOpeningUserCount);
        csvRows.push(openingUserCountRow.join(","));

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

        // Closing User Count row - per app type and total
        const closingUserCountRow = ["Closing User Count"];
        let totalClosingUserCount = 0;
        for (const appType of appTypes) {
            const result = await Customer.aggregate([
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
                        firstAppType: appType._id,
                    },
                },
                {
                    $count: "count",
                },
            ]);
            const count = result[0]?.count || 0;
            closingUserCountRow.push(count);
            totalClosingUserCount += count;
        }
        closingUserCountRow.push(totalClosingUserCount);
        csvRows.push(closingUserCountRow.join(","));

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
                        total: { $sum: "$points" },
                    },
                },
            ]);
            const total = result[0]?.total || 0;
            redeemTotalPoints.push(total);
            totalRedeemTotalPoints += total;
        }
        redeemTotalPoints.push(totalRedeemTotalPoints);
        csvRows.push("Total Points Redeemed," + redeemTotalPoints.join(","));

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

        // Total Points Expired row (Global - central activity, not app-specific)
        const expiredPointsResult = await Transaction.aggregate([
            {
                $match: {
                    transaction_type: "expire",
                    status: "completed",
                    transaction_date: { $gte: startDate, $lte: endDate },
                },
            },
            {
                $group: {
                    _id: null,
                    total: { $sum: "$points" },
                },
            },
        ]);
        const totalExpiredPoints = expiredPointsResult[0]?.total || 0;
        const expiredPointsRow = ["Total Points Expired (Global)"];
        // Add empty cells for each app type column
        for (let i = 0; i < appTypes.length; i++) {
            expiredPointsRow.push("");
        }
        expiredPointsRow.push(totalExpiredPoints);
        csvRows.push(expiredPointsRow.join(","));

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
                        total: { $sum: "$points" },
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
        // Since all points already have correct signs, simply sum all values
        // For per-app-type: earned + redeemed + adjusted + adminReduction (no expiration since it's global)
        const netMovementRow = ["Net Movement"];
        for (let i = 0; i < appTypes.length; i++) {
            const appTypeEarned = earnTotalPoints[i] || 0;
            const appTypeRedeemed = redeemTotalPoints[i] || 0;
            const appTypeAdjusted = adjustedPointsRow[i + 1] || 0;
            const appTypeAdminReduction = adminReductionRow[i + 1] || 0;
            const appTypeNetMovement = appTypeEarned + appTypeRedeemed + appTypeAdjusted + appTypeAdminReduction;
            netMovementRow.push(appTypeNetMovement);
        }
        // For total: include global expiration
        const netMovement = totalEarnTotalPoints + totalRedeemTotalPoints + totalExpiredPoints + totalAdjustedPoints + totalAdminReductionPoints;
        netMovementRow.push(netMovement);
        csvRows.push(netMovementRow.join(","));

        // Add blank row for separation
        csvRows.push("");

        // Opening Balance Points row (at the end for emphasis)
        const openingBalancePointsRow = ["Opening Balance Points"];
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
            openingBalancePointsRow.push(balance);
        }
        openingBalancePointsRow.push(totalOpeningBalance);
        csvRows.push(openingBalancePointsRow.join(","));

        // Closing Balance Points row (at the end for emphasis)
        const closingBalancePointsRow = ["Closing Balance Points"];
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
            closingBalancePointsRow.push(balance);
        }
        closingBalancePointsRow.push(totalClosingBalance);
        csvRows.push(closingBalancePointsRow.join(","));

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

