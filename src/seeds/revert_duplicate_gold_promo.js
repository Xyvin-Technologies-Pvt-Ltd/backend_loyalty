/**
 * Revert duplicate gold promotion manual point adjustments.
 *
 * The bulk upload of "manual-points-template - gold.xlsx" was accidentally
 * executed multiple times. Because the bulk upload is not truly atomic on
 * standalone MongoDB, some customers received 3000 points more than once.
 *
 * This script:
 *  1. Reads customer IDs from the Excel file
 *  2. For each customer, counts how many matching adjust transactions exist
 *  3. Keeps the oldest (first) transaction, flags extras for removal
 *  4. Checks if the extra points were already spent before reverting
 *
 * Usage:
 *   node src/seeds/revert_duplicate_gold_promo.js --preview          # dry run
 *   node src/seeds/revert_duplicate_gold_promo.js                    # execute
 *   node src/seeds/revert_duplicate_gold_promo.js --file ./path.xlsx # custom file
 */

const path = require("path");
const fs = require("fs");
const XLSX = require("xlsx");
const Transaction = require("../models/transaction_model");
const Customer = require("../models/customer_model");
const LoyaltyPoints = require("../models/loyalty_points_model");
const { connectDatabase, disconnectDatabase } = require("../config/database");
const { logger } = require("../middlewares/logger");

const POINT_CRITERIA_CODE = "PRO-PRO-216";
const EXPECTED_POINTS = 3000;

const DEFAULT_EXCEL_PATH = path.resolve(
  __dirname,
  "../../../../manual-points-template - gold.xlsx"
);

function parseArgs() {
  const args = process.argv.slice(2);
  const isPreview = args.includes("--preview") || args.includes("-p");
  const fileIdx = args.indexOf("--file");
  const excelPath =
    fileIdx !== -1 && args[fileIdx + 1]
      ? path.resolve(args[fileIdx + 1])
      : DEFAULT_EXCEL_PATH;
  return { isPreview, excelPath };
}

function readCustomerIdsFromExcel(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Excel file not found: ${filePath}`);
  }
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  return rows.map((r) => (r.customer_id || "").toString().trim()).filter(Boolean);
}

async function findMatchingTransactions(customerObjectId) {
  return Transaction.find({
    customer_id: customerObjectId,
    transaction_type: "adjust",
    points: EXPECTED_POINTS,
    status: "completed",
    "metadata.point_criteria_code": POINT_CRITERIA_CODE,
    "metadata.admin_entered": true,
  })
    .sort({ createdAt: 1 })
    .lean();
}

async function findLinkedLoyaltyPoints(transactionObjectId) {
  return LoyaltyPoints.findOne({ transaction_id: transactionObjectId }).lean();
}

function isLoyaltyPointsIntact(lp) {
  if (!lp) return false;
  return lp.status === "active" && lp.points === EXPECTED_POINTS;
}

async function processCustomer(customerId, isPreview, index, total) {
  const tag = `[${index + 1}/${total}]`;
  logger.info(`${tag} Processing ${customerId}...`);

  const customer = await Customer.findOne({ customer_id: customerId }).lean();
  if (!customer) {
    logger.info(`${tag} Customer not found`);
    return { customerId, status: "not_found" };
  }

  const transactions = await findMatchingTransactions(customer._id);
  logger.info(`${tag} Found ${transactions.length} matching transactions`);

  if (transactions.length === 0) {
    return { customerId, status: "no_transactions", totalPoints: customer.total_points };
  }

  if (transactions.length === 1) {
    return { customerId, status: "single_ok", totalPoints: customer.total_points };
  }

  const keep = transactions[0];
  const extras = transactions.slice(1);
  const extraDetails = [];
  let safeToRevertCount = 0;
  let spentCount = 0;

  for (const tx of extras) {
    const lp = await findLinkedLoyaltyPoints(tx._id);
    const intact = isLoyaltyPointsIntact(lp);

    if (!intact) {
      spentCount++;
      extraDetails.push({
        transactionId: tx._id.toString(),
        txStringId: tx.transaction_id,
        createdAt: tx.createdAt,
        loyaltyPointsId: lp?._id?.toString() || null,
        lpStatus: lp?.status || "missing",
        lpPoints: lp?.points ?? "missing",
        intact: false,
      });
    } else {
      safeToRevertCount++;
      extraDetails.push({
        transactionId: tx._id.toString(),
        txStringId: tx.transaction_id,
        createdAt: tx.createdAt,
        loyaltyPointsId: lp._id.toString(),
        lpStatus: lp.status,
        lpPoints: lp.points,
        intact: true,
      });
    }
  }

  const totalDeduction = safeToRevertCount * EXPECTED_POINTS;
  const balanceAfter = customer.total_points - totalDeduction;
  const balanceWouldGoNegative = balanceAfter < 0;

  if (isPreview) {
    return {
      customerId,
      status: "has_duplicates",
      totalTransactions: transactions.length,
      extrasCount: extras.length,
      safeToRevertCount,
      spentCount,
      currentTotalPoints: customer.total_points,
      currentCoins: customer.coins,
      totalDeduction,
      balanceAfterRevert: balanceAfter,
      balanceWouldGoNegative,
      keptTransaction: keep.transaction_id,
      extras: extraDetails,
    };
  }

  let revertedCount = 0;
  let skippedSpent = 0;
  const revertedTxIds = [];

  for (const detail of extraDetails) {
    if (!detail.intact) {
      skippedSpent++;
      continue;
    }

    logger.info(`${tag} Deleting transaction ${detail.txStringId}`);
    await Transaction.findByIdAndDelete(detail.transactionId);
    if (detail.loyaltyPointsId) {
      logger.info(`${tag} Deleting loyalty points ${detail.loyaltyPointsId}`);
      await LoyaltyPoints.findByIdAndDelete(detail.loyaltyPointsId);
    }
    revertedCount++;
    revertedTxIds.push(detail.txStringId);
  }

  if (revertedCount > 0) {
    const pointsToDeduct = revertedCount * EXPECTED_POINTS;
    logger.info(`${tag} Deducting ${pointsToDeduct} points from customer`);
    await Customer.findByIdAndUpdate(customer._id, {
      $inc: {
        total_points: -pointsToDeduct,
        coins: -pointsToDeduct,
      },
    });
  }

  return {
    customerId,
    status: "reverted",
    revertedCount,
    skippedSpent,
    pointsDeducted: revertedCount * EXPECTED_POINTS,
    revertedTxIds,
  };
}

async function run() {
  const { isPreview, excelPath } = parseArgs();
  const startedAt = Date.now();

  logger.info("=".repeat(70));
  logger.info(
    isPreview
      ? "PREVIEW MODE -- No changes will be made"
      : "EXECUTE MODE -- Changes WILL be written to the database"
  );
  logger.info(`Excel file: ${excelPath}`);
  logger.info("=".repeat(70));

  const customerIds = readCustomerIdsFromExcel(excelPath);
  logger.info(`Loaded ${customerIds.length} customer IDs from Excel`);

  await connectDatabase();

  const summary = {
    total: customerIds.length,
    notFound: 0,
    noTransactions: 0,
    singleOk: 0,
    hasDuplicates: 0,
    totalExtras: 0,
    safeToRevert: 0,
    spent: 0,
    reverted: 0,
    balanceWouldGoNegative: 0,
  };

  const results = [];
  const riskyCustomers = [];

  for (let i = 0; i < customerIds.length; i++) {
    const result = await processCustomer(customerIds[i], isPreview, i, customerIds.length);
    results.push(result);

    switch (result.status) {
      case "not_found":
        summary.notFound++;
        break;
      case "no_transactions":
        summary.noTransactions++;
        break;
      case "single_ok":
        summary.singleOk++;
        break;
      case "has_duplicates":
        summary.hasDuplicates++;
        summary.totalExtras += result.extrasCount;
        summary.safeToRevert += result.safeToRevertCount;
        summary.spent += result.spentCount;
        if (result.balanceWouldGoNegative) {
          summary.balanceWouldGoNegative++;
          riskyCustomers.push(result);
        }
        break;
      case "reverted":
        summary.reverted++;
        summary.totalExtras += result.revertedCount + result.skippedSpent;
        summary.safeToRevert += result.revertedCount;
        summary.spent += result.skippedSpent;
        break;
    }

    if ((i + 1) % 500 === 0) {
      logger.info(`Progress: ${i + 1}/${customerIds.length}`);
    }
  }

  const duration = Date.now() - startedAt;

  logger.info("=".repeat(70));
  logger.info("SUMMARY");
  logger.info("=".repeat(70));
  logger.info(`Total customers in Excel:        ${summary.total}`);
  logger.info(`Not found in DB:                 ${summary.notFound}`);
  logger.info(`No matching transactions:        ${summary.noTransactions}`);
  logger.info(`Single transaction (correct):    ${summary.singleOk}`);
  logger.info(`Has duplicates:                  ${summary.hasDuplicates + summary.reverted}`);
  logger.info(`  Total extra transactions:      ${summary.totalExtras}`);
  logger.info(`  Safe to revert:                ${summary.safeToRevert}`);
  logger.info(`  Already spent (skip):          ${summary.spent}`);
  if (isPreview) {
    logger.info(`  Balance would go negative:     ${summary.balanceWouldGoNegative}`);
  }
  if (!isPreview) {
    logger.info(`  Successfully reverted:         ${summary.reverted}`);
  }
  logger.info(`Duration: ${duration}ms`);
  logger.info("=".repeat(70));

  if (riskyCustomers.length > 0 && isPreview) {
    logger.warn("RISKY CUSTOMERS (balance would go negative after revert):");
    for (const c of riskyCustomers) {
      logger.warn(
        `  ${c.customerId}: current=${c.currentTotalPoints}, deduction=${c.totalDeduction}, after=${c.balanceAfterRevert}`
      );
    }
  }

  const reportsDir = path.join(__dirname, "reports");
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const mode = isPreview ? "preview" : "execute";
  const reportPath = path.join(
    reportsDir,
    `gold-promo-revert-${mode}-${timestamp}.json`
  );

  fs.writeFileSync(
    reportPath,
    JSON.stringify({ summary, results, riskyCustomers }, null, 2)
  );
  logger.info(`Report written to: ${reportPath}`);

  await disconnectDatabase();
  return summary;
}

if (require.main === module) {
  run()
    .then(() => {
      logger.info("Script finished");
      process.exit(0);
    })
    .catch((err) => {
      logger.error(`Script failed: ${err.message}`, { stack: err.stack });
      process.exit(1);
    });
}

module.exports = { run };
