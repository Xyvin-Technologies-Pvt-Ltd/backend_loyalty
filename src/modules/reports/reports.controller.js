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

// CSV export configuration
const EXPORT_BATCH_SIZE = 500; // Process transactions in batches
const MAX_EXPORT_ROWS = 100000; // Maximum rows for single export (safety limit)

/**
 * Helper function to format date as dd mm yyyy
 */
const formatDate = (date) => {
    if (!date) return "";
    const d = new Date(date);
    if (isNaN(d.getTime())) return "";
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = d.getFullYear();
    return `${day} ${month} ${year}`;
};

/**
 * Helper function to escape CSV values
 */
const escapeCSVValue = (value) => {
    const stringValue = String(value);
    if (stringValue.includes(",") || stringValue.includes('"') || stringValue.includes("\n")) {
        return `"${stringValue.replace(/"/g, '""')}"`;
    }
    return stringValue;
};

/**
 * Helper function to format a transaction row for CSV
 */
const formatTransactionRow = (transaction, expiryDate) => {
    // Extract criteria codes from metadata.items array
    let criteriaCodes = "";
    if (transaction.metadata?.items && Array.isArray(transaction.metadata.items)) {
        criteriaCodes = transaction.metadata.items
            .map(item => item.criteria_code)
            .filter(code => code)
            .join(", ");
    }

    const row = [
        transaction.customer_data?.customer_id || "",
        transaction._id.toString(),
        transaction.transaction_id || "",
        transaction.metadata?.original_transaction_id || "",
        transaction.transaction_type || "",
        transaction.points || 0,
        criteriaCodes,
        transaction.metadata?.requested_by || "",
        formatDate(transaction.transaction_date),
        formatDate(transaction.createdAt),
        formatDate(expiryDate),
        transaction.status || "",
    ];

    return row.map(escapeCSVValue).join(",");
};

/**
 * Get transaction count for export estimation
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getTransactionExportCount = async (req, res) => {
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

        startDate.setHours(0, 0, 0, 0);

        const count = await Transaction.countDocuments({
            transaction_date: { $gte: startDate, $lte: endDate },
        });

        return response_handler(res, 200, "Transaction count retrieved successfully", {
            count,
            maxExportRows: MAX_EXPORT_ROWS,
            exceedsLimit: count > MAX_EXPORT_ROWS,
            dateRange: {
                startDate: startDate.toISOString(),
                endDate: endDate.toISOString(),
            },
        });
    } catch (error) {
        logger.error(`Error getting transaction count: ${error.message}`, {
            stack: error.stack,
        });
        return response_handler(res, 500, "Failed to get transaction count", error.message);
    }
};

/**
 * Export transaction report as CSV using streaming for large datasets
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const exportTransactionReport = async (req, res) => {
    try {
        let { startDate, endDate, limit } = req.query;

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

        // Parse and validate limit
        const exportLimit = limit ? Math.min(parseInt(limit, 10), MAX_EXPORT_ROWS) : MAX_EXPORT_ROWS;

        const LoyaltyPoints = require("../../models/loyalty_points_model");

        // CSV headers
        const headers = [
            "kedmah_customer_id",
            "loyalty_transaction_id",
            "khedmah_transaction_id",
            "cancel_transaction_id",
            "transaction_type",
            "point",
            "criteria_code",
            "requested_by",
            "transaction_date",
            "created_date",
            "expirydate",
            "status",
        ];

        // Set response headers for CSV download (streaming)
        res.setHeader("Content-Type", "text/csv;charset=utf-8");
        res.setHeader(
            "Content-Disposition",
            `attachment; filename=transaction_report_${startDate.toISOString().split("T")[0]}_${endDate.toISOString().split("T")[0]}.csv`
        );
        res.setHeader("Transfer-Encoding", "chunked");

        // Write CSV headers
        res.write(headers.join(",") + "\n");

        // Build aggregation pipeline
        const pipeline = [
            {
                $match: {
                    transaction_date: { $gte: startDate, $lte: endDate },
                },
            },
            {
                $lookup: {
                    from: "customers",
                    localField: "customer_id",
                    foreignField: "_id",
                    as: "customer_data",
                },
            },
            {
                $unwind: {
                    path: "$customer_data",
                    preserveNullAndEmptyArrays: true,
                },
            },
            {
                $project: {
                    _id: 1,
                    transaction_id: 1,
                    transaction_type: 1,
                    points: 1,
                    status: 1,
                    transaction_date: 1,
                    createdAt: 1,
                    metadata: 1,
                    "customer_data.customer_id": 1,
                },
            },
            {
                $sort: { transaction_date: 1 },
            },
            {
                $limit: exportLimit,
            },
        ];

        // Use cursor for streaming with batched processing
        const cursor = Transaction.aggregate(pipeline)
            .allowDiskUse(true)
            .cursor({ batchSize: EXPORT_BATCH_SIZE });

        let processedCount = 0;
        let batch = [];
        let expiryMap = {};

        logger.info(`Starting transaction export stream`, {
            startDate: startDate.toISOString(),
            endDate: endDate.toISOString(),
            limit: exportLimit,
        });

        // Process transactions using cursor streaming
        for await (const transaction of cursor) {
            batch.push(transaction);

            // Process batch when it reaches EXPORT_BATCH_SIZE
            if (batch.length >= EXPORT_BATCH_SIZE) {
                // Fetch expiry dates for this batch
                const batchIds = batch
                    .map((t) => {
                        if (!t._id) return null;
                        if (t._id instanceof mongoose.Types.ObjectId) {
                            return t._id;
                        }
                        if (mongoose.Types.ObjectId.isValid(t._id)) {
                            return new mongoose.Types.ObjectId(t._id);
                        }
                        return null;
                    })
                    .filter((id) => id !== null);

                if (batchIds.length > 0) {
                    const loyaltyPoints = await LoyaltyPoints.find(
                        { transaction_id: { $in: batchIds } },
                        { transaction_id: 1, expiryDate: 1 }
                    ).lean();

                    loyaltyPoints.forEach((lp) => {
                        expiryMap[lp.transaction_id.toString()] = lp.expiryDate;
                    });
                }

                // Write batch to response
                for (const txn of batch) {
                    try {
                        const expiryDate = expiryMap[txn._id.toString()];
                        const row = formatTransactionRow(txn, expiryDate);
                        res.write(row + "\n");
                        processedCount++;
                    } catch (rowError) {
                        logger.error(`Error processing transaction row: ${rowError.message}`, {
                            transactionId: txn._id,
                        });
                    }
                }

                // Clear batch and expiry map for next batch
                batch = [];
                expiryMap = {};

                // Log progress every 5000 rows
                if (processedCount % 5000 === 0) {
                    logger.info(`Export progress: ${processedCount} transactions processed`);
                }
            }
        }

        // Process remaining transactions in the last batch
        if (batch.length > 0) {
            const batchIds = batch
                .map((t) => {
                    if (!t._id) return null;
                    if (t._id instanceof mongoose.Types.ObjectId) {
                        return t._id;
                    }
                    if (mongoose.Types.ObjectId.isValid(t._id)) {
                        return new mongoose.Types.ObjectId(t._id);
                    }
                    return null;
                })
                .filter((id) => id !== null);

            if (batchIds.length > 0) {
                const loyaltyPoints = await LoyaltyPoints.find(
                    { transaction_id: { $in: batchIds } },
                    { transaction_id: 1, expiryDate: 1 }
                ).lean();

                loyaltyPoints.forEach((lp) => {
                    expiryMap[lp.transaction_id.toString()] = lp.expiryDate;
                });
            }

            for (const txn of batch) {
                try {
                    const expiryDate = expiryMap[txn._id.toString()];
                    const row = formatTransactionRow(txn, expiryDate);
                    res.write(row + "\n");
                    processedCount++;
                } catch (rowError) {
                    logger.error(`Error processing transaction row: ${rowError.message}`, {
                        transactionId: txn._id,
                    });
                }
            }
        }

        logger.info(`Transaction export completed: ${processedCount} rows exported`, {
            startDate: startDate.toISOString(),
            endDate: endDate.toISOString(),
        });

        // End the response
        res.end();
    } catch (error) {
        logger.error(`Error exporting transaction report: ${error.message}`, {
            stack: error.stack,
            error: error,
        });

        // If response headers already sent, try to end gracefully
        if (res.headersSent) {
            res.write(`\n# ERROR: Export failed - ${error.message}\n`);
            return res.end();
        }

        return response_handler(
            res,
            500,
            "Failed to export transaction report",
            error.message
        );
    }
};

module.exports = {
    getReportData,
    exportReportCSV,
    exportTransactionReport,
    getTransactionExportCount,
};

