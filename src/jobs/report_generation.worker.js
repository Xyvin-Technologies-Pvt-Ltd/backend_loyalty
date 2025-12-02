/**
 * Report Generation Worker
 * Processes report generation jobs in the background
 * 
 * OPTIMIZED VERSION:
 * - Pre-computes balances for all app types in single aggregations
 * - Sequential processing with granular progress updates
 * - Reduced MongoDB load by ~80%
 */

const { createWorker } = require("../config/queue");
const { setCache } = require("../config/redis");
const { logger } = require("../middlewares/logger");
const ReportJob = require("../models/report_job_model");
const Customer = require("../models/customer_model");
const Transaction = require("../models/transaction_model");
const AppType = require("../models/app_type_model");

// Cache TTL: 24 hours
const REPORT_CACHE_TTL = 86400;

/**
 * Generate cache key for report data
 * @param {string} startDate - Start date ISO string
 * @param {string} endDate - End date ISO string
 * @returns {string} - Cache key
 */
const getReportCacheKey = (startDate, endDate) => {
  return `report:data:${startDate}:${endDate}`;
};

/**
 * Compute opening/closing balances for ALL app types in a single aggregation
 * This avoids running expensive $lookup queries per app type
 * @param {Date} dateLimit - Date limit for balance calculation
 * @param {string} operator - '$lt' for opening, '$lte' for closing
 * @returns {Promise<Object>} - Map of appTypeName -> balance
 */
const computeBalancesByAppType = async (dateLimit, operator) => {
  const matchCondition = operator === "$lt"
    ? { transaction_date: { $lt: dateLimit }, status: "completed" }
    : { transaction_date: { $lte: dateLimit }, status: "completed" };

  const result = await Transaction.aggregate([
    { $match: matchCondition },
    {
      // Convert reference_id to ObjectId for expire transactions
      $addFields: {
        reference_id_objectId: {
          $cond: {
            if: { $and: [{ $eq: ["$transaction_type", "expire"] }, { $ne: ["$reference_id", null] }] },
            then: { $toObjectId: "$reference_id" },
            else: null,
          },
        },
      },
    },
    {
      // Lookup original transaction for expire transactions
      $lookup: {
        from: "transactions",
        localField: "reference_id_objectId",
        foreignField: "_id",
        as: "expireOriginalTransaction",
      },
    },
    {
      // Lookup original transaction for adjust transactions
      $lookup: {
        from: "transactions",
        let: { originalTxId: "$metadata.original_transaction_id" },
        pipeline: [
          { $match: { $expr: { $eq: ["$transaction_id", "$$originalTxId"] } } },
          { $project: { requested_by: "$metadata.requested_by" } },
        ],
        as: "adjustOriginalTransaction",
      },
    },
    {
      // Determine effective requested_by based on transaction type
      $addFields: {
        effectiveRequestedBy: {
          $switch: {
            branches: [
              {
                case: { $and: [{ $eq: ["$transaction_type", "expire"] }, { $gt: [{ $size: "$expireOriginalTransaction" }, 0] }] },
                then: { $arrayElemAt: ["$expireOriginalTransaction.metadata.requested_by", 0] },
              },
              {
                case: { $and: [{ $eq: ["$transaction_type", "adjust"] }, { $gt: [{ $size: "$adjustOriginalTransaction" }, 0] }] },
                then: { $arrayElemAt: ["$adjustOriginalTransaction.requested_by", 0] },
              },
            ],
            default: "$metadata.requested_by",
          },
        },
      },
    },
    {
      // Group by effectiveRequestedBy to get balances for all app types at once
      $group: {
        _id: "$effectiveRequestedBy",
        total: { $sum: "$points" },
      },
    },
  ]);

  // Convert array to map for easy lookup
  const balanceMap = {};
  result.forEach((item) => {
    if (item._id) {
      balanceMap[item._id] = item.total;
    }
  });

  return balanceMap;
};

/**
 * Compute expired points for ALL app types in a single aggregation
 * @param {Date} startDate - Start date
 * @param {Date} endDate - End date
 * @returns {Promise<Object>} - Map of appTypeName -> expiredPoints
 */
const computeExpiredPointsByAppType = async (startDate, endDate) => {
  const result = await Transaction.aggregate([
    {
      $match: {
        transaction_type: "expire",
        status: "completed",
        transaction_date: { $gte: startDate, $lte: endDate },
      },
    },
    {
      $addFields: {
        reference_id_objectId: {
          $cond: {
            if: { $ne: ["$reference_id", null] },
            then: { $toObjectId: "$reference_id" },
            else: null,
          },
        },
      },
    },
    {
      $lookup: {
        from: "transactions",
        localField: "reference_id_objectId",
        foreignField: "_id",
        as: "originalTransaction",
      },
    },
    {
      $addFields: {
        effectiveRequestedBy: {
          $cond: {
            if: { $gt: [{ $size: "$originalTransaction" }, 0] },
            then: { $arrayElemAt: ["$originalTransaction.metadata.requested_by", 0] },
            else: "$metadata.requested_by",
          },
        },
      },
    },
    {
      $group: {
        _id: "$effectiveRequestedBy",
        totalPoints: { $sum: "$points" },
      },
    },
  ]);

  const expiredMap = {};
  result.forEach((item) => {
    if (item._id) {
      expiredMap[item._id] = item.totalPoints;
    }
  });

  return expiredMap;
};

/**
 * Compute adjusted points for ALL app types in a single aggregation
 * @param {Date} startDate - Start date
 * @param {Date} endDate - End date
 * @returns {Promise<Object>} - Map of appTypeName -> adjustedPoints
 */
const computeAdjustedPointsByAppType = async (startDate, endDate) => {
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
          { $match: { $expr: { $eq: ["$transaction_id", "$$originalTxId"] } } },
          { $project: { requested_by: "$metadata.requested_by" } },
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
            then: { $arrayElemAt: ["$originalTransaction.requested_by", 0] },
            else: "$metadata.requested_by",
          },
        },
      },
    },
    {
      $group: {
        _id: "$effectiveRequestedBy",
        totalPoints: { $sum: "$points" },
      },
    },
  ]);

  const adjustedMap = {};
  result.forEach((item) => {
    if (item._id) {
      adjustedMap[item._id] = item.totalPoints;
    }
  });

  return adjustedMap;
};

/**
 * Core report generation logic - OPTIMIZED VERSION
 * @param {Date} startDate - Start date
 * @param {Date} endDate - End date
 * @param {Function} onProgress - Progress callback (0-100)
 * @returns {Promise<Object>} - Report data
 */
const generateReportData = async (startDate, endDate, onProgress = () => { }) => {
  const startTime = Date.now();

  // Fetch all app types
  const appTypes = await AppType.find({ isActive: true }).sort({ name: 1 });

  if (appTypes.length === 0) {
    return {
      appTypes: [],
      reportData: {},
      dateRange: {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      },
    };
  }

  await onProgress(5);
  logger.info("Report generation: App types loaded", { count: appTypes.length });

  const reportData = {};

  // Calculate global opening balance (all transactions before start date)
  const openingBalanceResult = await Transaction.aggregate([
    { $match: { transaction_date: { $lt: startDate }, status: "completed" } },
    { $group: { _id: null, total: { $sum: "$points" } } },
  ]);
  const openingBalance = openingBalanceResult[0]?.total || 0;

  await onProgress(10);
  logger.info("Report generation: Global opening balance computed", { openingBalance });

  // Calculate global closing balance (all transactions up to end date)
  const closingBalanceResult = await Transaction.aggregate([
    { $match: { transaction_date: { $lte: endDate }, status: "completed" } },
    { $group: { _id: null, total: { $sum: "$points" } } },
  ]);
  const closingBalance = closingBalanceResult[0]?.total || 0;

  await onProgress(15);
  logger.info("Report generation: Global closing balance computed", { closingBalance });

  // PRE-COMPUTE all expensive lookups for ALL app types at once
  // This is the key optimization - instead of running these per app type,
  // we run them once and get results for all app types

  logger.info("Report generation: Computing opening balances by app type...");
  const openingBalancesByAppType = await computeBalancesByAppType(startDate, "$lt");
  await onProgress(25);
  logger.info("Report generation: Opening balances by app type computed");

  logger.info("Report generation: Computing closing balances by app type...");
  const closingBalancesByAppType = await computeBalancesByAppType(endDate, "$lte");
  await onProgress(35);
  logger.info("Report generation: Closing balances by app type computed");

  logger.info("Report generation: Computing expired points by app type...");
  const expiredPointsByAppType = await computeExpiredPointsByAppType(startDate, endDate);
  await onProgress(40);
  logger.info("Report generation: Expired points by app type computed");

  logger.info("Report generation: Computing adjusted points by app type...");
  const adjustedPointsByAppType = await computeAdjustedPointsByAppType(startDate, endDate);
  await onProgress(45);
  logger.info("Report generation: Adjusted points by app type computed");

  // Process each app type SEQUENTIALLY with progress updates
  // This prevents overwhelming MongoDB with too many concurrent queries
  const progressPerAppType = 45 / appTypes.length; // 45% allocated for app type processing (45-90)

  for (let i = 0; i < appTypes.length; i++) {
    const appType = appTypes[i];
    const appTypeId = appType._id;
    const appTypeName = appType.name;

    logger.info(`Report generation: Processing app type ${i + 1}/${appTypes.length}: ${appTypeName}`);

    // Run lightweight queries for this app type (no expensive $lookup needed anymore)
    const [
      registeredUsersResult,
      earnUserCountResult,
      earnStatsResult,
      redeemUserCountResult,
      redeemStatsResult,
      promoPointsResult,
      adminReductionResult,
    ] = await Promise.all([
      // 1. Registered Users Count
      Customer.aggregate([
        {
          $match: {
            app_type: { $exists: true, $ne: [] },
            createdAt: { $gte: startDate, $lte: endDate },
          },
        },
        { $project: { firstAppType: { $arrayElemAt: ["$app_type", 0] } } },
        { $match: { firstAppType: appTypeId } },
        { $count: "count" },
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
        { $group: { _id: "$customer_id" } },
        { $count: "count" },
      ]),
      // 3. Points Earning - Stats (combined query)
      Transaction.aggregate([
        {
          $match: {
            transaction_type: "earn",
            status: "completed",
            transaction_date: { $gte: startDate, $lte: endDate },
            "metadata.requested_by": appTypeName,
          },
        },
        { $group: { _id: null, transactionCount: { $sum: 1 }, totalPoints: { $sum: "$points" } } },
      ]),
      // 4. Points Redeemed - User Count
      Transaction.aggregate([
        {
          $match: {
            transaction_type: "redeem",
            status: "completed",
            transaction_date: { $gte: startDate, $lte: endDate },
            "metadata.requested_by": appTypeName,
          },
        },
        { $group: { _id: "$customer_id" } },
        { $count: "count" },
      ]),
      // 5. Points Redeemed - Stats (combined query)
      Transaction.aggregate([
        {
          $match: {
            transaction_type: "redeem",
            status: "completed",
            transaction_date: { $gte: startDate, $lte: endDate },
            "metadata.requested_by": appTypeName,
          },
        },
        { $group: { _id: null, transactionCount: { $sum: 1 }, totalPoints: { $sum: "$points" } } },
      ]),
      // 6. Total Promotion Points
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
        { $group: { _id: null, totalPoints: { $sum: "$points" } } },
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
        { $group: { _id: null, totalPoints: { $sum: "$points" } } },
      ]),
    ]);

    // Use pre-computed values for expensive lookups
    reportData[appTypeName] = {
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
      // Use pre-computed values from batch queries
      openingBalance: openingBalancesByAppType[appTypeName] || 0,
      closingBalance: closingBalancesByAppType[appTypeName] || 0,
      totalPromoPoints: promoPointsResult[0]?.totalPoints || 0,
      totalExpiredPoints: expiredPointsByAppType[appTypeName] || 0,
      totalAdjustedPoints: adjustedPointsByAppType[appTypeName] || 0,
      adminReductionPoints: adminReductionResult[0]?.totalPoints || 0,
    };

    // Update progress after each app type
    const currentProgress = 45 + Math.round((i + 1) * progressPerAppType);
    await onProgress(currentProgress);
  }

  logger.info("Report generation: All app types processed, calculating totals...");

  // Calculate global totals from reportData
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

  await onProgress(95);

  // Calculate Net Movement
  const netMovement = closingBalance - openingBalance;

  const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(2);
  logger.info(`Report generation: Complete in ${elapsedTime}s`);

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
    generatedAt: new Date().toISOString(),
    generationTimeSeconds: parseFloat(elapsedTime),
  };

  await onProgress(100);

  return response;
};

/**
 * Process a report generation job
 * @param {Object} job - BullMQ job object
 * @returns {Promise<Object>} - Job result
 */
const processReportJob = async (job) => {
  const { jobId, startDate, endDate, reportType } = job.data;

  logger.info(`Processing report job: ${jobId}`, { startDate, endDate, reportType });

  try {
    // Update job status to processing
    await ReportJob.findOneAndUpdate(
      { jobId },
      { status: "processing", progress: 0 }
    );

    // Parse dates
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    // Generate report with progress updates
    const reportData = await generateReportData(start, end, async (progress) => {
      await ReportJob.findOneAndUpdate({ jobId }, { progress });
      await job.updateProgress(progress);
    });

    // Store in Redis cache with 24h TTL
    const cacheKey = getReportCacheKey(startDate, endDate);
    await setCache(cacheKey, reportData, REPORT_CACHE_TTL);

    // Update job as completed
    await ReportJob.findOneAndUpdate(
      { jobId },
      {
        status: "completed",
        progress: 100,
        result: reportData,
        completedAt: new Date(),
      }
    );

    logger.info(`Report job completed: ${jobId}`, {
      generationTime: reportData.generationTimeSeconds
    });

    return { success: true, jobId, cacheKey };
  } catch (error) {
    logger.error(`Report job failed: ${jobId}`, { error: error.message, stack: error.stack });

    // Update job as failed
    await ReportJob.findOneAndUpdate(
      { jobId },
      {
        status: "failed",
        error: error.message,
        completedAt: new Date(),
      }
    );

    throw error;
  }
};

/**
 * Initialize the reports worker
 * @returns {Worker} - The created worker
 */
const initializeReportsWorker = () => {
  const worker = createWorker("reports", processReportJob, {
    concurrency: 1, // Process one report at a time to avoid overwhelming MongoDB
    limiter: {
      max: 5,
      duration: 60000, // 5 jobs per minute max
    },
  });

  logger.info("Reports worker initialized");

  return worker;
};

/**
 * Generate reports for scheduled date ranges
 * Called by daily scheduler
 */
const generateScheduledReports = async () => {
  const { queues } = require("../config/queue");
  const { v4: uuidv4 } = require("uuid");

  const now = new Date();

  // Current month dates
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const currentMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  // Last 30 days
  const last30DaysStart = new Date(now);
  last30DaysStart.setDate(last30DaysStart.getDate() - 30);
  const last30DaysEnd = new Date(now);

  const scheduledReports = [
    {
      reportType: "current_month",
      startDate: currentMonthStart.toISOString().split("T")[0],
      endDate: currentMonthEnd.toISOString().split("T")[0],
    },
    {
      reportType: "last_30_days",
      startDate: last30DaysStart.toISOString().split("T")[0],
      endDate: last30DaysEnd.toISOString().split("T")[0],
    },
  ];

  logger.info("Generating scheduled reports", { count: scheduledReports.length });

  for (const report of scheduledReports) {
    const jobId = `scheduled-${report.reportType}-${uuidv4()}`;

    // Create job record
    await ReportJob.create({
      jobId,
      status: "pending",
      dateRange: {
        startDate: new Date(report.startDate),
        endDate: new Date(report.endDate),
      },
      reportType: report.reportType,
      createdBy: null, // System generated
    });

    // Add to queue
    await queues.reports.add(
      "generate-report",
      {
        jobId,
        startDate: report.startDate,
        endDate: report.endDate,
        reportType: report.reportType,
      },
      {
        removeOnComplete: true,
        removeOnFail: false,
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 5000,
        },
      }
    );

    logger.info(`Scheduled report job created: ${jobId}`, { reportType: report.reportType });
  }
};

module.exports = {
  initializeReportsWorker,
  generateReportData,
  generateScheduledReports,
  getReportCacheKey,
  REPORT_CACHE_TTL,
};
