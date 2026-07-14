const ExcelJS = require("exceljs");
const Customer = require("../../models/customer_model");
const Transaction = require("../../models/transaction_model");
const AppType = require("../../models/app_type_model");
const { logger } = require("../../middlewares/logger");
const response_handler = require("../../helpers/response_handler");
const mongoose = require("mongoose");

/**
 * Generate Points Activity Report
 * Creates an Excel report with user registration and points activity statistics
 * segmented by app type
 */
const generatePointsReport = async (req, res) => {
  try {
    const { startDate, endDate, appType, includeInactive } = req.query;

    // Set default date range if not provided (last 30 days)
    const defaultEndDate = new Date();
    const defaultStartDate = new Date();
    defaultStartDate.setDate(defaultStartDate.getDate() - 30);

    const dateStart = startDate ? new Date(startDate) : defaultStartDate;
    const dateEnd = endDate ? new Date(endDate) : defaultEndDate;

    // Set time to start and end of day
    dateStart.setHours(0, 0, 0, 0);
    dateEnd.setHours(23, 59, 59, 999);

    logger.info(
      `Generating points report from ${dateStart.toISOString()} to ${dateEnd.toISOString()}`
    );

    // Fetch all active app types
    const appTypes = await AppType.find({ isActive: true }).lean();

    if (!appTypes || appTypes.length === 0) {
      return response_handler(res, 404, "No active app types found", null);
    }

    // Build customer filter
    // const customerFilter = includeInactive === "true" ? {} : {};
    const customerFilter = {};
    // ===== 1. REGISTERED USERS BY APP TYPE =====
    const registeredUsers = {};
    for (const app of appTypes) {
      const count = await Customer.countDocuments({
        ...customerFilter,
        app_type: app._id,
      });
      registeredUsers[app._id.toString()] = count;
    }

    // Count users with multiple app types (Both)
    const bothUsersCount = await Customer.countDocuments({
      ...customerFilter,
      $expr: {
        $and: [{ $isArray: "$app_type" }, { $gt: [{ $size: "$app_type" }, 1] }],
      },
    });
    registeredUsers["both"] = bothUsersCount;

    // ===== 2. POINTS EARNING STATISTICS =====
    // For earn transactions, use metadata.requested_by since app_type might be null
    const earningStats = await Transaction.aggregate([
      {
        $match: {
          transaction_type: "earn",
          status: "completed",
          transaction_date: { $gte: dateStart, $lte: dateEnd },
          "metadata.requested_by": { $exists: true, $ne: null },
        },
      },
      {
        $group: {
          _id: "$metadata.requested_by", // Group by requested_by name
          uniqueUsers: { $addToSet: "$customer_id" },
          transactionCount: { $sum: 1 },
          totalPoints: { $sum: "$points" },
        },
      },
    ]);

    // Process earning stats by app type using name matching
    const earningByAppType = {};
    for (const app of appTypes) {
      const stat = earningStats.find(
        (s) => s._id && s._id.toLowerCase() === app.name.toLowerCase()
      );
      earningByAppType[app._id.toString()] = {
        uniqueUsers: stat ? stat.uniqueUsers.length : 0,
        transactionCount: stat ? stat.transactionCount : 0,
        totalPoints: stat ? stat.totalPoints : 0,
      };
    }

    // Get earning stats for "Both" customers (customers who have earned in BOTH apps)
    // Find customers who have transactions with different requested_by values
    const bothCustomersEarn = await Transaction.aggregate([
      {
        $match: {
          transaction_type: "earn",
          status: "completed",
          transaction_date: { $gte: dateStart, $lte: dateEnd },
          "metadata.requested_by": { $exists: true, $ne: null },
        },
      },
      {
        $group: {
          _id: "$customer_id",
          apps: {
            $addToSet: {
              $cond: {
                if: {
                  $and: [
                    { $ne: ["$metadata.requested_by", null] },
                    { $ne: ["$metadata.requested_by", ""] },
                  ],
                },
                then: "$metadata.requested_by",
                else: "$$REMOVE",
              },
            },
          },
          transactionCount: { $sum: 1 },
          totalPoints: { $sum: "$points" },
        },
      },
      {
        $match: {
          $expr: {
            $and: [{ $isArray: "$apps" }, { $gt: [{ $size: "$apps" }, 1] }],
          },
        },
      },
    ]);

    // Calculate "Both" stats for earning
    const bothEarnUniqueUsers = bothCustomersEarn.length;
    const bothEarnTransactions = bothCustomersEarn.reduce(
      (sum, c) => sum + c.transactionCount,
      0
    );
    const bothEarnPoints = bothCustomersEarn.reduce(
      (sum, c) => sum + c.totalPoints,
      0
    );

    earningByAppType["both"] = {
      uniqueUsers: bothEarnUniqueUsers,
      transactionCount: bothEarnTransactions,
      totalPoints: bothEarnPoints,
    };

    // ===== 3. POINTS REDEMPTION STATISTICS =====
    // Transactions have app_type directly, so we use it
    const redemptionStats = await Transaction.aggregate([
      {
        $match: {
          transaction_type: "redeem",
          status: "completed",
          transaction_date: { $gte: dateStart, $lte: dateEnd },
          app_type: { $ne: null },
        },
      },
      {
        $group: {
          _id: "$app_type",
          uniqueUsers: { $addToSet: "$customer_id" },
          transactionCount: { $sum: 1 },
          totalPoints: { $sum: { $abs: "$points" } }, // Points are negative for redemption
        },
      },
    ]);

    // Process redemption stats by app type
    const redemptionByAppType = {};
    for (const app of appTypes) {
      const stat = redemptionStats.find(
        (s) => s._id && s._id.toString() === app._id.toString()
      );
      redemptionByAppType[app._id.toString()] = {
        uniqueUsers: stat ? stat.uniqueUsers.length : 0,
        transactionCount: stat ? stat.transactionCount : 0,
        totalPoints: stat ? stat.totalPoints : 0,
      };
    }

    // Get redemption stats for "Both" customers (customers who have redeemed in BOTH apps)
    // Find customers who have redemption transactions with different app_types
    const bothCustomersRedeem = await Transaction.aggregate([
      {
        $match: {
          transaction_type: "redeem",
          status: "completed",
          transaction_date: { $gte: dateStart, $lte: dateEnd },
          app_type: { $ne: null },
        },
      },
      {
        $group: {
          _id: "$customer_id",
          apps: {
            $addToSet: {
              $cond: {
                if: { $ne: ["$app_type", null] },
                then: "$app_type",
                else: "$$REMOVE",
              },
            },
          },
          transactionCount: { $sum: 1 },
          totalPoints: { $sum: { $abs: "$points" } },
        },
      },
      {
        $match: {
          $expr: {
            $and: [{ $isArray: "$apps" }, { $gt: [{ $size: "$apps" }, 1] }],
          },
        },
      },
    ]);

    // Calculate "Both" stats for redemption
    const bothRedeemUniqueUsers = bothCustomersRedeem.length;
    const bothRedeemTransactions = bothCustomersRedeem.reduce(
      (sum, c) => sum + c.transactionCount,
      0
    );
    const bothRedeemPoints = bothCustomersRedeem.reduce(
      (sum, c) => sum + c.totalPoints,
      0
    );

    redemptionByAppType["both"] = {
      uniqueUsers: bothRedeemUniqueUsers,
      transactionCount: bothRedeemTransactions,
      totalPoints: bothRedeemPoints,
    };

    // ===== 4. OPENING BALANCE (before start date) =====
    // For opening balance, we need to handle both earn (metadata.requested_by) and redeem (app_type)

    // Get opening balance from redeem transactions (have app_type)
    const openingBalanceRedeem = await Transaction.aggregate([
      {
        $match: {
          transaction_type: "redeem",
          status: "completed",
          transaction_date: { $lt: dateStart },
          app_type: { $ne: null },
        },
      },
      {
        $group: {
          _id: "$app_type",
          totalPoints: { $sum: "$points" },
        },
      },
    ]);

    // Get opening balance from earn transactions (use metadata.requested_by)
    const openingBalanceEarn = await Transaction.aggregate([
      {
        $match: {
          transaction_type: "earn",
          status: "completed",
          transaction_date: { $lt: dateStart },
          "metadata.requested_by": { $exists: true, $ne: null },
        },
      },
      {
        $group: {
          _id: "$metadata.requested_by",
          totalPoints: { $sum: "$points" },
        },
      },
    ]);

    const openingBalance = {};
    for (const app of appTypes) {
      // Sum from both redeem and earn
      const redeemStat = openingBalanceRedeem.find(
        (s) => s._id && s._id.toString() === app._id.toString()
      );
      const earnStat = openingBalanceEarn.find(
        (s) => s._id && s._id.toLowerCase() === app.name.toLowerCase()
      );

      const redeemPoints = redeemStat ? redeemStat.totalPoints : 0;
      const earnPoints = earnStat ? earnStat.totalPoints : 0;

      openingBalance[app._id.toString()] = redeemPoints + earnPoints;
    }

    // Opening balance for "Both" customers
    // Get all customers who have used both apps (from all time, not just date range)
    // We need to find customers who have transactions in multiple apps
    // Step 1: Get customers who earned in multiple apps (using requested_by)
    const bothCustomersEarnAllTime = await Transaction.aggregate([
      {
        $match: {
          transaction_type: "earn",
          status: "completed",
          "metadata.requested_by": { $exists: true, $ne: null },
        },
      },
      {
        $group: {
          _id: "$customer_id",
          apps: {
            $addToSet: {
              $cond: {
                if: {
                  $and: [
                    { $ne: ["$metadata.requested_by", null] },
                    { $ne: ["$metadata.requested_by", ""] },
                  ],
                },
                then: "$metadata.requested_by",
                else: "$$REMOVE",
              },
            },
          },
        },
      },
      {
        $match: {
          $expr: {
            $and: [{ $isArray: "$apps" }, { $gt: [{ $size: "$apps" }, 1] }],
          },
        },
      },
      {
        $project: {
          customer_id: "$_id",
        },
      },
    ]);

    // Step 2: Get customers who redeemed in multiple apps (using app_type)
    const bothCustomersRedeemAllTime = await Transaction.aggregate([
      {
        $match: {
          transaction_type: "redeem",
          status: "completed",
          app_type: { $ne: null },
        },
      },
      {
        $group: {
          _id: "$customer_id",
          apps: {
            $addToSet: {
              $cond: {
                if: { $ne: ["$app_type", null] },
                then: "$app_type",
                else: "$$REMOVE",
              },
            },
          },
        },
      },
      {
        $match: {
          $expr: {
            $and: [{ $isArray: "$apps" }, { $gt: [{ $size: "$apps" }, 1] }],
          },
        },
      },
      {
        $project: {
          customer_id: "$_id",
        },
      },
    ]);

    // Combine all "both" customer IDs from both earn and redeem
    const earnBothIds = bothCustomersEarnAllTime.map((c) => c.customer_id);
    const redeemBothIds = bothCustomersRedeemAllTime.map((c) => c.customer_id);

    // Create a Set to remove duplicates (comparing ObjectIds)
    const bothCustomerIdsSet = new Set();
    earnBothIds.forEach((id) => bothCustomerIdsSet.add(id.toString()));
    redeemBothIds.forEach((id) => bothCustomerIdsSet.add(id.toString()));

    const bothCustomerIds = Array.from(bothCustomerIdsSet).map(
      (id) => new mongoose.Types.ObjectId(id)
    );

    // Only query if we have both customers
    let bothOpeningBalanceResult = [];
    if (bothCustomerIds.length > 0) {
      bothOpeningBalanceResult = await Transaction.aggregate([
        {
          $match: {
            customer_id: { $in: bothCustomerIds },
            status: "completed",
            transaction_date: { $lt: dateStart },
          },
        },
        {
          $group: {
            _id: null,
            totalPoints: { $sum: "$points" },
          },
        },
      ]);
    }

    openingBalance["both"] =
      bothOpeningBalanceResult.length > 0
        ? bothOpeningBalanceResult[0].totalPoints
        : 0;

    // ===== 5. CLOSING BALANCE (up to end date) =====
    // For closing balance, we need to handle both earn (metadata.requested_by) and redeem (app_type)

    // Get closing balance from redeem transactions (have app_type)
    const closingBalanceRedeem = await Transaction.aggregate([
      {
        $match: {
          transaction_type: "redeem",
          status: "completed",
          transaction_date: { $lte: dateEnd },
          app_type: { $ne: null },
        },
      },
      {
        $group: {
          _id: "$app_type",
          totalPoints: { $sum: "$points" },
        },
      },
    ]);

    // Get closing balance from earn transactions (use metadata.requested_by)
    const closingBalanceEarn = await Transaction.aggregate([
      {
        $match: {
          transaction_type: "earn",
          status: "completed",
          transaction_date: { $lte: dateEnd },
          "metadata.requested_by": { $exists: true, $ne: null },
        },
      },
      {
        $group: {
          _id: "$metadata.requested_by",
          totalPoints: { $sum: "$points" },
        },
      },
    ]);

    const closingBalance = {};
    for (const app of appTypes) {
      // Sum from both redeem and earn
      const redeemStat = closingBalanceRedeem.find(
        (s) => s._id && s._id.toString() === app._id.toString()
      );
      const earnStat = closingBalanceEarn.find(
        (s) => s._id && s._id.toLowerCase() === app.name.toLowerCase()
      );

      const redeemPoints = redeemStat ? redeemStat.totalPoints : 0;
      const earnPoints = earnStat ? earnStat.totalPoints : 0;

      closingBalance[app._id.toString()] = redeemPoints + earnPoints;
    }

    // Closing balance for "Both" customers
    let bothClosingBalanceResult = [];
    if (bothCustomerIds.length > 0) {
      bothClosingBalanceResult = await Transaction.aggregate([
        {
          $match: {
            customer_id: { $in: bothCustomerIds },
            status: "completed",
            transaction_date: { $lte: dateEnd },
          },
        },
        {
          $group: {
            _id: null,
            totalPoints: { $sum: "$points" },
          },
        },
      ]);
    }

    closingBalance["both"] =
      bothClosingBalanceResult.length > 0
        ? bothClosingBalanceResult[0].totalPoints
        : 0;

    // ===== 6. CREATE EXCEL WORKBOOK =====
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Points Activity Report");

    // Set column widths
    worksheet.columns = [
      { width: 30 },
      { width: 20 },
      { width: 20 },
      { width: 20 },
    ];

    // Add title
    worksheet.mergeCells("A1:D1");
    const titleCell = worksheet.getCell("A1");
    titleCell.value = "Points Activity Report";
    titleCell.font = { size: 16, bold: true };
    titleCell.alignment = { horizontal: "center", vertical: "middle" };
    titleCell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF2B5C3F" },
    };
    titleCell.font = { ...titleCell.font, color: { argb: "FFFFFFFF" } };

    // Add date range
    worksheet.mergeCells("A2:D2");
    const dateRangeCell = worksheet.getCell("A2");
    dateRangeCell.value = `Period: ${dateStart.toLocaleDateString()} to ${dateEnd.toLocaleDateString()}`;
    dateRangeCell.font = { italic: true };
    dateRangeCell.alignment = { horizontal: "center" };

    // Add empty row
    worksheet.addRow([]);

    // Add header row
    const headerRow = worksheet.addRow([
      "Metric",
      ...appTypes.map((app) => app.name),
      "Both",
    ]);
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
    headerRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF4C9067" },
    };
    headerRow.alignment = { horizontal: "center", vertical: "middle" };
    headerRow.height = 20;

    // Add Registered Users section
    const registeredRow = worksheet.addRow([
      "No of Registered Users",
      ...appTypes.map((app) => registeredUsers[app._id.toString()] || 0),
      registeredUsers["both"] || 0,
    ]);
    registeredRow.font = { bold: true };

    // Add empty row
    worksheet.addRow([]);

    // Add Points Earning section header
    const earningHeaderRow = worksheet.addRow(["Points Earning", "", "", ""]);
    earningHeaderRow.font = { bold: true, size: 12 };
    earningHeaderRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFE8F5E9" },
    };

    // Points Earning - No of Users
    worksheet.addRow([
      "  No of Users",
      ...appTypes.map(
        (app) => earningByAppType[app._id.toString()]?.uniqueUsers || 0
      ),
      earningByAppType["both"]?.uniqueUsers || 0,
    ]);

    // Points Earning - No of Transactions
    worksheet.addRow([
      "  No of Transactions",
      ...appTypes.map(
        (app) => earningByAppType[app._id.toString()]?.transactionCount || 0
      ),
      earningByAppType["both"]?.transactionCount || 0,
    ]);

    // Points Earning - Total Points Earned
    worksheet.addRow([
      "  Total Points Earned",
      ...appTypes.map(
        (app) => earningByAppType[app._id.toString()]?.totalPoints || 0
      ),
      earningByAppType["both"]?.totalPoints || 0,
    ]);

    // Add empty row
    worksheet.addRow([]);

    // Add Points Redeemed section header
    const redemptionHeaderRow = worksheet.addRow([
      "Points Redeemed",
      "",
      "",
      "",
    ]);
    redemptionHeaderRow.font = { bold: true, size: 12 };
    redemptionHeaderRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFFFEBEE" },
    };

    // Points Redeemed - No of Users
    worksheet.addRow([
      "  No of Users",
      ...appTypes.map(
        (app) => redemptionByAppType[app._id.toString()]?.uniqueUsers || 0
      ),
      redemptionByAppType["both"]?.uniqueUsers || 0,
    ]);

    // Points Redeemed - No of Transactions
    worksheet.addRow([
      "  No of Transactions",
      ...appTypes.map(
        (app) => redemptionByAppType[app._id.toString()]?.transactionCount || 0
      ),
      redemptionByAppType["both"]?.transactionCount || 0,
    ]);

    // Points Redeemed - Total Points Redeemed
    worksheet.addRow([
      "  Total Points Redeemed",
      ...appTypes.map(
        (app) => redemptionByAppType[app._id.toString()]?.totalPoints || 0
      ),
      redemptionByAppType["both"]?.totalPoints || 0,
    ]);

    // Add empty row
    worksheet.addRow([]);

    // Add Opening Balance
    const openingBalanceRow = worksheet.addRow([
      "Opening Balance",
      ...appTypes.map((app) => openingBalance[app._id.toString()] || 0),
      openingBalance["both"] || 0,
    ]);
    openingBalanceRow.font = { bold: true };
    openingBalanceRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFF3F4F6" },
    };

    // Add Closing Balance
    const closingBalanceRow = worksheet.addRow([
      "Closing Balance",
      ...appTypes.map((app) => closingBalance[app._id.toString()] || 0),
      closingBalance["both"] || 0,
    ]);
    closingBalanceRow.font = { bold: true };
    closingBalanceRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFF3F4F6" },
    };

    // Add borders to all cells
    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber > 2) {
        // Skip title and date rows
        row.eachCell({ includeEmpty: true }, (cell) => {
          cell.border = {
            top: { style: "thin" },
            left: { style: "thin" },
            bottom: { style: "thin" },
            right: { style: "thin" },
          };
        });
      }
    });

    // Generate Excel file
    const buffer = await workbook.xlsx.writeBuffer();

    // Set response headers for file download
    const filename = `Points_Activity_Report_${
      dateStart.toISOString().split("T")[0]
    }_to_${dateEnd.toISOString().split("T")[0]}.xlsx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", buffer.length);

    logger.info(`Points report generated successfully: ${filename}`);

    // Send the file
    return res.send(buffer);
  } catch (error) {
    logger.error(`Error generating points report: ${error.message}`);
    return response_handler(
      res,
      500,
      "Failed to generate points report",
      error.message
    );
  }
};

/**
 * Update transactions with null app_type by looking up from metadata.requested_by
 * This function updates all transactions that have null app_type but contain
 * metadata.requested_by field with a valid app name
 */
const updateTransactionAppTypes = async (req, res) => {
  try {
    logger.info("Starting transaction app_type update process via API");

    // Get all app types for mapping
    const appTypes = await AppType.find({});
    logger.info(`Found ${appTypes.length} app types in database`);

    // Create a map of app names to app IDs (case-insensitive)
    const appTypeMap = {};
    appTypes.forEach((app) => {
      appTypeMap[app.name.toLowerCase()] = app._id;
    });

    // Find all transactions with null app_type but with metadata.requested_by
    const transactionsToUpdate = await Transaction.find({
      app_type: null,
      "metadata.requested_by": { $exists: true, $ne: null },
    });

    logger.info(
      `Found ${transactionsToUpdate.length} transactions with null app_type but with metadata.requested_by`
    );

    if (transactionsToUpdate.length === 0) {
      return response_handler(
        res,
        200,
        "No transactions to update. All transactions already have app_type set.",
        {
          total: 0,
          success: 0,
          failed: 0,
        }
      );
    }

    let successCount = 0;
    let failCount = 0;
    const failedTransactions = [];
    const updates = [];

    // Update each transaction
    for (const transaction of transactionsToUpdate) {
      const requestedBy = transaction.metadata.requested_by;
      const requestedByLower = requestedBy.toLowerCase().trim();

      // Find matching app_type
      const appTypeId = appTypeMap[requestedByLower];

      if (appTypeId) {
        try {
          await Transaction.updateOne(
            { _id: transaction._id },
            { $set: { app_type: appTypeId } }
          );

          successCount++;
          updates.push({
            transaction_id: transaction.transaction_id,
            requested_by: requestedBy,
            app_type_id: appTypeId.toString(),
            status: "success",
          });

          logger.info(
            `Updated transaction ${transaction.transaction_id} - Set app_type to ${requestedBy}`
          );
        } catch (error) {
          failCount++;
          failedTransactions.push({
            transaction_id: transaction.transaction_id,
            requested_by: requestedBy,
            error: error.message,
          });
          logger.error(
            `Failed to update transaction ${transaction.transaction_id}: ${error.message}`
          );
        }
      } else {
        failCount++;
        failedTransactions.push({
          transaction_id: transaction.transaction_id,
          requested_by: requestedBy,
          error: "App type not found in database",
        });
        logger.warn(
          `No matching app_type found for "${requestedBy}" in transaction ${transaction.transaction_id}`
        );
      }
    }

    logger.info("Transaction app_type update process completed via API", {
      total: transactionsToUpdate.length,
      success: successCount,
      failed: failCount,
    });

    return response_handler(
      res,
      200,
      `Successfully updated ${successCount} out of ${transactionsToUpdate.length} transactions`,
      {
        total: transactionsToUpdate.length,
        success: successCount,
        failed: failCount,
        updates: updates.slice(0, 50), // Return first 50 updates to avoid large responses
        failed_transactions: failedTransactions,
      }
    );
  } catch (error) {
    logger.error(`Error updating transaction app_types: ${error.message}`, {
      stack: error.stack,
    });
    return response_handler(
      res,
      500,
      "Failed to update transaction app types",
      error.message
    );
  }
};

// CSV export configuration
const EXPORT_BATCH_SIZE = 500;
const MAX_EXPORT_ROWS = 100000;

const formatDate = (date) => {
  if (!date) return "";
  const d = new Date(date);
  if (isNaN(d.getTime())) return "";
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day} ${month} ${year}`;
};

const escapeCSVValue = (value) => {
  const stringValue = String(value);
  if (
    stringValue.includes(",") ||
    stringValue.includes('"') ||
    stringValue.includes("\n")
  ) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
};

const deriveTxType = (transaction) => {
  if (transaction.transaction_type === "adjust") {
    const id = transaction.transaction_id || "";
    if (/_cancelled$/.test(id)) return "redemption_cancellation";
    if (/^PROMO-/.test(id)) return "promotion";
    if (/^ADMIN-/.test(id)) return "admin_reduction";
    return "adjust";
  }
  return transaction.transaction_type || "";
};

const formatTransactionRow = (transaction, expiryDate) => {
  let criteriaCodes = "";
  if (transaction.metadata?.items && Array.isArray(transaction.metadata.items)) {
    criteriaCodes = transaction.metadata.items
      .map((item) => item.criteria_code)
      .filter((code) => code)
      .join(", ");
  }

  const row = [
    transaction.customer_data?.customer_id || "",
    transaction.tier_data?.name?.en || "",
    transaction._id.toString(),
    transaction.transaction_id || "",
    transaction.metadata?.original_transaction_id || "",
    deriveTxType(transaction),
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

const getTransactionExportCount = async (req, res) => {
  try {
    let { startDate, endDate } = req.query;

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

    const exceedsLimit = count > MAX_EXPORT_ROWS;
    let suggestedEndDate = null;

    if (exceedsLimit) {
      try {
        const hundredThousandthTransaction = await Transaction.findOne(
          {
            transaction_date: { $gte: startDate, $lte: endDate },
          },
          { createdAt: 1 },
          {
            sort: { createdAt: 1 },
            skip: MAX_EXPORT_ROWS - 1,
          }
        ).lean();

        if (hundredThousandthTransaction?.createdAt) {
          const safeEndDate = new Date(hundredThousandthTransaction.createdAt);
          safeEndDate.setDate(safeEndDate.getDate() - 1);
          safeEndDate.setHours(23, 59, 59, 999);

          if (safeEndDate >= startDate && safeEndDate < endDate) {
            suggestedEndDate = safeEndDate.toISOString();
          }
        }
      } catch (findError) {
        logger.error(`Error finding 100k transaction: ${findError.message}`, {
          stack: findError.stack,
        });
      }
    }

    return response_handler(res, 200, "Transaction count retrieved successfully", {
      count,
      maxExportRows: MAX_EXPORT_ROWS,
      exceedsLimit,
      suggestedEndDate,
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

const exportTransactionReport = async (req, res) => {
  try {
    let { startDate, endDate, limit } = req.query;

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

    const exportLimit = limit
      ? Math.min(parseInt(limit, 10), MAX_EXPORT_ROWS)
      : MAX_EXPORT_ROWS;

    const LoyaltyPoints = require("../../models/loyalty_points_model");

    const headers = [
      "kedmah_customer_id",
      "customer_tier",
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

    res.setHeader("Content-Type", "text/csv;charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=transaction_report_${startDate.toISOString().split("T")[0]}_${endDate.toISOString().split("T")[0]}.csv`
    );
    res.setHeader("Transfer-Encoding", "chunked");

    res.write(headers.join(",") + "\n");

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
        $lookup: {
          from: "tiers",
          localField: "customer_data.tier",
          foreignField: "_id",
          as: "tier_data",
        },
      },
      {
        $unwind: {
          path: "$tier_data",
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
          "tier_data.name": 1,
        },
      },
      {
        $sort: { transaction_date: 1 },
      },
      {
        $limit: exportLimit,
      },
    ];

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

    const processBatch = async (transactions) => {
      const batchIds = transactions
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

      for (const txn of transactions) {
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
    };

    for await (const transaction of cursor) {
      batch.push(transaction);

      if (batch.length >= EXPORT_BATCH_SIZE) {
        await processBatch(batch);
        batch = [];
        expiryMap = {};

        if (processedCount % 5000 === 0) {
          logger.info(`Export progress: ${processedCount} transactions processed`);
        }
      }
    }

    if (batch.length > 0) {
      await processBatch(batch);
    }

    logger.info(`Transaction export completed: ${processedCount} rows exported`, {
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
    });

    res.end();
  } catch (error) {
    logger.error(`Error exporting transaction report: ${error.message}`, {
      stack: error.stack,
      error: error,
    });

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
  generatePointsReport,
  updateTransactionAppTypes,
  getTransactionExportCount,
  exportTransactionReport,
};
