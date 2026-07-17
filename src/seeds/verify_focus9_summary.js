/**
 * Read-only Focus9 daily summary reconciliation.
 *
 * Recomputes App/Delivery buckets from raw transactions two ways:
 *   (a) current Focus9 job logic (metadata.requested_by only)
 *   (b) Reports-style effectiveRequestedBy (lookup original for expire/adjust)
 *
 * Usage:
 *   node src/seeds/verify_focus9_summary.js --date=2026-07-15
 */

const moment = require("moment-timezone");
const Transaction = require("../models/transaction_model");
const Focus9DailySummary = require("../models/focus9_daily_summary_model");
const { connectDatabase, disconnectDatabase } = require("../config/database");
const { logger } = require("../middlewares/logger");

const OMAN_TIMEZONE = "Asia/Muscat";
const POINTS_TO_OMR = 1000;

function parseDateArg() {
  const dateArg = process.argv.find((arg) => arg.startsWith("--date="));
  if (!dateArg) {
    throw new Error("Missing --date=YYYY-MM-DD argument");
  }
  const value = dateArg.split("=")[1];
  const parsed = moment.tz(value, "YYYY-MM-DD", OMAN_TIMEZONE);
  if (!parsed.isValid()) {
    throw new Error(`Invalid date: ${value}`);
  }
  return parsed;
}

function pointsToOMR(points) {
  return Math.abs(points) / POINTS_TO_OMR;
}

function normalizeRequestedBy(requestedBy) {
  if (!requestedBy) return null;

  const normalized = String(requestedBy).trim();

  if (
    normalized.toLowerCase().includes("khedmah app") ||
    normalized.toLowerCase() === "khedmah app" ||
    normalized.toLowerCase() === "app"
  ) {
    return "Khedmah App";
  }

  if (
    normalized.toLowerCase().includes("khedmah delivery") ||
    normalized.toLowerCase().includes("delivery") ||
    normalized.toLowerCase() === "khedmah delivery"
  ) {
    return "Khedmah Delivery";
  }

  if (normalized.toLowerCase().includes("khedmah")) {
    return "Khedmah App";
  }

  return null;
}

function isRedeemCancellation(transaction) {
  return Boolean(
    transaction.metadata?.cancellation_triggered_by ||
      (transaction.transaction_id &&
        String(transaction.transaction_id).endsWith("_cancelled"))
  );
}

function createEmptySummary() {
  return {
    khedmah_app_addition_amt: 0,
    khedmah_app_expired_amt: 0,
    khedmah_app_redeemed_amt: 0,
    khedmah_delivery_addition_amt: 0,
    khedmah_delivery_expired_amt: 0,
    khedmah_delivery_redeemed_amt: 0,
    khedmah_app_redeem_cancellation_amt: 0,
    khedmah_delivery_redeem_cancellation_amt: 0,
    khedmah_app_manual_addition_amt: 0,
    khedmah_delivery_manual_addition_amt: 0,
    khedmah_app_manual_reduction_amt: 0,
    khedmah_delivery_manual_reduction_amt: 0,
    khedmahAppCount: 0,
    khedmahDeliveryCount: 0,
    otherCount: 0,
  };
}

function applyAmountToBucket(summary, requestedBy, fieldPrefix, omrAmount) {
  if (requestedBy === "Khedmah App") {
    summary[`khedmah_app_${fieldPrefix}`] += omrAmount;
    summary.khedmahAppCount++;
  } else if (requestedBy === "Khedmah Delivery") {
    summary[`khedmah_delivery_${fieldPrefix}`] += omrAmount;
    summary.khedmahDeliveryCount++;
  } else {
    summary.otherCount++;
    summary[`khedmah_app_${fieldPrefix}`] += omrAmount;
  }
}

function applyStandardTransaction(summary, requestedBy, transactionType, omrAmount) {
  if (requestedBy === "Khedmah App") {
    summary.khedmahAppCount++;
    if (transactionType === "earn") summary.khedmah_app_addition_amt += omrAmount;
    else if (transactionType === "expire") summary.khedmah_app_expired_amt += omrAmount;
    else if (transactionType === "redeem") summary.khedmah_app_redeemed_amt += omrAmount;
  } else if (requestedBy === "Khedmah Delivery") {
    summary.khedmahDeliveryCount++;
    if (transactionType === "earn") summary.khedmah_delivery_addition_amt += omrAmount;
    else if (transactionType === "expire") summary.khedmah_delivery_expired_amt += omrAmount;
    else if (transactionType === "redeem") summary.khedmah_delivery_redeemed_amt += omrAmount;
  } else {
    summary.otherCount++;
    if (transactionType === "earn") summary.khedmah_app_addition_amt += omrAmount;
    else if (transactionType === "expire") summary.khedmah_app_expired_amt += omrAmount;
    else if (transactionType === "redeem") summary.khedmah_app_redeemed_amt += omrAmount;
  }
}

function processTransaction(summary, transaction, requestedBy, defaultedToApp = []) {
  const points = transaction.points;
  const transactionType = transaction.transaction_type;
  const omrAmount = pointsToOMR(points);
  const rawRequestedBy = transaction.metadata?.requested_by ?? null;
  const normalized = normalizeRequestedBy(requestedBy ?? rawRequestedBy);

  if (transactionType === "adjust") {
    if (isRedeemCancellation(transaction)) {
      applyAmountToBucket(summary, normalized, "redeem_cancellation_amt", omrAmount);
    } else if (points > 0) {
      applyAmountToBucket(summary, normalized, "manual_addition_amt", omrAmount);
    } else if (points < 0) {
      applyAmountToBucket(summary, normalized, "manual_reduction_amt", omrAmount);
    }
    if (!normalized) {
      defaultedToApp.push({
        transaction_id: transaction.transaction_id,
        transaction_type: transactionType,
        points,
        raw_requested_by: rawRequestedBy,
        reason: "unknown requested_by -> defaulted to App bucket",
      });
    }
    return;
  }

  if (!normalized) {
    defaultedToApp.push({
      transaction_id: transaction.transaction_id,
      transaction_type: transactionType,
      points,
      raw_requested_by: rawRequestedBy,
      reason: "unknown requested_by -> defaulted to App bucket",
    });
  }

  applyStandardTransaction(summary, normalized, transactionType, omrAmount);
}

function roundSummary(summary) {
  const round = (num) => Math.round(num * 1000) / 1000;
  const rounded = { ...summary };
  for (const key of Object.keys(rounded)) {
    if (key.endsWith("_amt")) {
      rounded[key] = round(rounded[key]);
    }
  }
  return rounded;
}

function computeJobLogicSummary(transactions) {
  const summary = createEmptySummary();
  const defaultedToApp = [];

  for (const transaction of transactions) {
    processTransaction(summary, transaction, transaction.metadata?.requested_by, defaultedToApp);
  }

  return { summary: roundSummary(summary), defaultedToApp };
}

async function resolveEffectiveRequestedBy(transaction, originalById, originalByTxId) {
  const transactionType = transaction.transaction_type;

  if (transactionType === "expire" && transaction.reference_id) {
    const original = originalById.get(String(transaction.reference_id));
    if (original?.metadata?.requested_by) {
      return original.metadata.requested_by;
    }
  }

  if (transactionType === "adjust" && transaction.metadata?.original_transaction_id) {
    const original = originalByTxId.get(transaction.metadata.original_transaction_id);
    if (original?.metadata?.requested_by) {
      return original.metadata.requested_by;
    }
  }

  return transaction.metadata?.requested_by ?? null;
}

async function buildOriginalLookups(transactions) {
  const referenceIds = [
    ...new Set(
      transactions
        .filter((tx) => tx.transaction_type === "expire" && tx.reference_id)
        .map((tx) => String(tx.reference_id))
    ),
  ];

  const originalTxIds = [
    ...new Set(
      transactions
        .filter(
          (tx) =>
            tx.transaction_type === "adjust" &&
            tx.metadata?.original_transaction_id
        )
        .map((tx) => tx.metadata.original_transaction_id)
    ),
  ];

  const originalById = new Map();
  const originalByTxId = new Map();

  if (referenceIds.length) {
    const originals = await Transaction.find({ _id: { $in: referenceIds } })
      .select("metadata.requested_by")
      .lean();
    for (const doc of originals) {
      originalById.set(String(doc._id), doc);
    }
  }

  if (originalTxIds.length) {
    const originals = await Transaction.find({
      transaction_id: { $in: originalTxIds },
    })
      .select("transaction_id metadata.requested_by")
      .lean();
    for (const doc of originals) {
      originalByTxId.set(doc.transaction_id, doc);
    }
  }

  return { originalById, originalByTxId };
}

async function computeEffectiveSummary(transactions) {
  const { originalById, originalByTxId } = await buildOriginalLookups(transactions);
  const summary = createEmptySummary();
  const defaultedToApp = [];
  const effectiveOverrides = [];

  for (const transaction of transactions) {
    const rawRequestedBy = transaction.metadata?.requested_by ?? null;
    const effectiveRequestedBy = await resolveEffectiveRequestedBy(
      transaction,
      originalById,
      originalByTxId
    );

    if (effectiveRequestedBy !== rawRequestedBy) {
      effectiveOverrides.push({
        transaction_id: transaction.transaction_id,
        transaction_type: transaction.transaction_type,
        points: transaction.points,
        raw_requested_by: rawRequestedBy,
        effective_requested_by: effectiveRequestedBy,
      });
    }

    processTransaction(summary, transaction, effectiveRequestedBy, defaultedToApp);
  }

  return { summary: roundSummary(summary), defaultedToApp, effectiveOverrides };
}

function buildSqlPreviewRows(stored) {
  return [
    {
      TransactionType: "Khedmah App",
      AdditionAmount: stored.khedmah_app_addition_amt || 0,
      ExpiryAmount: stored.khedmah_app_expired_amt || 0,
      RedemptionAmount: 0,
      RedemptionCancel: stored.khedmah_app_redeem_cancellation_amt || 0,
      ManualAddition: stored.khedmah_app_manual_addition_amt || 0,
      ManualDeduction: stored.khedmah_app_manual_reduction_amt || 0,
      PostedStatus: stored.posting_flag === 1 ? "Y" : "N",
    },
    {
      TransactionType: "Khedmah Delivery",
      AdditionAmount: stored.khedmah_delivery_addition_amt || 0,
      ExpiryAmount: stored.khedmah_delivery_expired_amt || 0,
      RedemptionAmount: stored.khedmah_delivery_redeemed_amt || 0,
      RedemptionCancel: stored.khedmah_delivery_redeem_cancellation_amt || 0,
      ManualAddition: stored.khedmah_delivery_manual_addition_amt || 0,
      ManualDeduction: stored.khedmah_delivery_manual_reduction_amt || 0,
      PostedStatus: stored.posting_flag === 1 ? "Y" : "N",
    },
  ];
}

function formatBucket(label, summary) {
  return {
    label,
    khedmahApp: {
      addition: summary.khedmah_app_addition_amt,
      expired: summary.khedmah_app_expired_amt,
      redeemed: summary.khedmah_app_redeemed_amt,
      redeemCancellation: summary.khedmah_app_redeem_cancellation_amt,
      manualAddition: summary.khedmah_app_manual_addition_amt,
      manualReduction: summary.khedmah_app_manual_reduction_amt,
    },
    khedmahDelivery: {
      addition: summary.khedmah_delivery_addition_amt,
      expired: summary.khedmah_delivery_expired_amt,
      redeemed: summary.khedmah_delivery_redeemed_amt,
      redeemCancellation: summary.khedmah_delivery_redeem_cancellation_amt,
      manualAddition: summary.khedmah_delivery_manual_addition_amt,
      manualReduction: summary.khedmah_delivery_manual_reduction_amt,
    },
    counts: {
      app: summary.khedmahAppCount,
      delivery: summary.khedmahDeliveryCount,
      otherDefaultedToApp: summary.otherCount,
    },
  };
}

function diffBuckets(a, b) {
  const fields = [
    ["khedmahApp", "addition"],
    ["khedmahApp", "expired"],
    ["khedmahApp", "redeemed"],
    ["khedmahApp", "redeemCancellation"],
    ["khedmahApp", "manualAddition"],
    ["khedmahApp", "manualReduction"],
    ["khedmahDelivery", "addition"],
    ["khedmahDelivery", "expired"],
    ["khedmahDelivery", "redeemed"],
    ["khedmahDelivery", "redeemCancellation"],
    ["khedmahDelivery", "manualAddition"],
    ["khedmahDelivery", "manualReduction"],
  ];

  const diffs = [];
  for (const [group, field] of fields) {
    const left = a[group][field];
    const right = b[group][field];
    if (Math.abs(left - right) > 0.0005) {
      diffs.push({ field: `${group}.${field}`, left, right, delta: right - left });
    }
  }
  return diffs;
}

async function verifyFocus9Summary() {
  const day = parseDateArg();
  const startOfDay = day.clone().startOf("day").toDate();
  const endOfDay = day.clone().endOf("day").toDate();

  await connectDatabase();

  logger.info("=".repeat(60));
  logger.info(`Focus9 summary verification for ${day.format("YYYY-MM-DD")} (Oman)`);
  logger.info(`Window: ${startOfDay.toISOString()} -> ${endOfDay.toISOString()}`);
  logger.info("=".repeat(60));

  const transactions = await Transaction.find({
    transaction_date: { $gte: startOfDay, $lte: endOfDay },
    status: "completed",
    transaction_type: { $in: ["earn", "expire", "redeem", "adjust"] },
  }).lean();

  logger.info(`Transactions found: ${transactions.length}`);

  const jobResult = computeJobLogicSummary(transactions);
  const effectiveResult = await computeEffectiveSummary(transactions);

  const stored = await Focus9DailySummary.findOne({ date: startOfDay }).lean();

  const storedFormatted = stored
    ? formatBucket("stored Mongo summary", {
        khedmah_app_addition_amt: stored.khedmah_app_addition_amt,
        khedmah_app_expired_amt: stored.khedmah_app_expired_amt,
        khedmah_app_redeemed_amt: stored.khedmah_app_redeemed_amt,
        khedmah_delivery_addition_amt: stored.khedmah_delivery_addition_amt,
        khedmah_delivery_expired_amt: stored.khedmah_delivery_expired_amt,
        khedmah_delivery_redeemed_amt: stored.khedmah_delivery_redeemed_amt,
        khedmah_app_redeem_cancellation_amt: stored.khedmah_app_redeem_cancellation_amt,
        khedmah_delivery_redeem_cancellation_amt:
          stored.khedmah_delivery_redeem_cancellation_amt,
        khedmah_app_manual_addition_amt: stored.khedmah_app_manual_addition_amt,
        khedmah_delivery_manual_addition_amt:
          stored.khedmah_delivery_manual_addition_amt,
        khedmah_app_manual_reduction_amt: stored.khedmah_app_manual_reduction_amt,
        khedmah_delivery_manual_reduction_amt:
          stored.khedmah_delivery_manual_reduction_amt,
        khedmahAppCount: 0,
        khedmahDeliveryCount: 0,
        otherCount: 0,
      })
    : null;

  const sqlRows = stored ? buildSqlPreviewRows(stored) : [];

  const jobBucket = formatBucket("(a) Focus9 job logic", jobResult.summary);
  const effectiveBucket = formatBucket(
    "(b) effectiveRequestedBy logic",
    effectiveResult.summary
  );

  console.log("\n--- (a) Focus9 job logic ---");
  console.log(JSON.stringify(jobBucket, null, 2));

  console.log("\n--- (b) effectiveRequestedBy logic ---");
  console.log(JSON.stringify(effectiveBucket, null, 2));

  if (storedFormatted) {
    console.log("\n--- stored Mongo summary ---");
    console.log(JSON.stringify(storedFormatted, null, 2));
  } else {
    console.log("\n--- stored Mongo summary: NOT FOUND ---");
  }

  if (sqlRows.length) {
    console.log("\n--- SQL rows that would be pushed ---");
    console.log(JSON.stringify(sqlRows, null, 2));
    console.log(
      "\nNote: App RedemptionAmount is hardcoded to 0 in SQL push (by design)."
    );
    console.log(
      `Stored Mongo khedmah_app_redeemed_amt: ${stored?.khedmah_app_redeemed_amt ?? "N/A"}`
    );
  }

  const jobVsEffective = diffBuckets(jobBucket, effectiveBucket);
  const jobVsStored = storedFormatted
    ? diffBuckets(jobBucket, storedFormatted)
    : [];
  const effectiveVsStored = storedFormatted
    ? diffBuckets(effectiveBucket, storedFormatted)
    : [];

  console.log("\n--- diffs: (a) job vs (b) effective ---");
  console.log(jobVsEffective.length ? JSON.stringify(jobVsEffective, null, 2) : "No differences");

  console.log("\n--- diffs: (a) job vs stored ---");
  console.log(jobVsStored.length ? JSON.stringify(jobVsStored, null, 2) : "No differences");

  console.log("\n--- diffs: (b) effective vs stored ---");
  console.log(
    effectiveVsStored.length ? JSON.stringify(effectiveVsStored, null, 2) : "No differences"
  );

  console.log(`\n--- defaulted to App (${jobResult.defaultedToApp.length}) ---`);
  if (jobResult.defaultedToApp.length) {
    console.log(JSON.stringify(jobResult.defaultedToApp.slice(0, 50), null, 2));
    if (jobResult.defaultedToApp.length > 50) {
      console.log(`... and ${jobResult.defaultedToApp.length - 50} more`);
    }
  }

  console.log(
    `\n--- effectiveRequestedBy overrides (${effectiveResult.effectiveOverrides.length}) ---`
  );
  if (effectiveResult.effectiveOverrides.length) {
    console.log(JSON.stringify(effectiveResult.effectiveOverrides.slice(0, 50), null, 2));
    if (effectiveResult.effectiveOverrides.length > 50) {
      console.log(`... and ${effectiveResult.effectiveOverrides.length - 50} more`);
    }
  }

  await disconnectDatabase();

  return {
    date: day.format("YYYY-MM-DD"),
    transactionCount: transactions.length,
    jobVsEffective,
    jobVsStored,
    effectiveVsStored,
    defaultedToAppCount: jobResult.defaultedToApp.length,
    effectiveOverrideCount: effectiveResult.effectiveOverrides.length,
  };
}

if (require.main === module) {
  verifyFocus9Summary()
    .then((result) => {
      logger.info("Verification finished", result);
      process.exit(0);
    })
    .catch((err) => {
      logger.error("Verification failed:", err);
      process.exit(1);
    });
}

module.exports = { verifyFocus9Summary };
