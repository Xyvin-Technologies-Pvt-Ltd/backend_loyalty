/**
 * Backfill Focus9 daily summaries for a date range and optionally re-push to FOCUS SQL.
 *
 * Usage:
 *   node src/seeds/backfill_focus9_summaries.js --from=2026-07-10
 *   node src/seeds/backfill_focus9_summaries.js --from=2026-07-10 --to=2026-07-17
 *   node src/seeds/backfill_focus9_summaries.js --from=2026-07-10 --no-sql
 */

const moment = require("moment-timezone");
const { connectDatabase, disconnectDatabase } = require("../config/database");
const { logger } = require("../middlewares/logger");
const { FOCUS_SQL_ENABLED } = require("../config/env");
const { generateFocus9DailySummary } = require("../jobs/focus9_daily_summary.job");
const {
  deleteSqlRowsByDateRange,
  pushUnsyncedFocus9Summaries,
  closePool,
} = require("../services/focus9_sql_sync.service");

const OMAN_TIMEZONE = "Asia/Muscat";
const MAX_BACKFILL_DAYS = 120;

function parseArg(name) {
  const arg = process.argv.find((item) => item.startsWith(`--${name}=`));
  return arg ? arg.split("=")[1] : null;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function parseDate(value, label) {
  const parsed = moment.tz(value, "YYYY-MM-DD", OMAN_TIMEZONE);
  if (!parsed.isValid()) {
    throw new Error(`Invalid ${label} date: ${value}`);
  }
  return parsed.startOf("day");
}

function buildDateList(fromDate, toDate) {
  const dates = [];
  const cursor = fromDate.clone();

  while (cursor.isSameOrBefore(toDate, "day")) {
    dates.push(cursor.format("YYYY-MM-DD"));
    cursor.add(1, "day");
  }

  return dates;
}

/**
 * Core backfill routine. Assumes the DB connection is already established
 * (server context) — does NOT connect/disconnect. Safe to call from a controller.
 *
 * @param {Object} options
 * @param {String} options.from - Start date YYYY-MM-DD (required)
 * @param {String} [options.to] - End date YYYY-MM-DD (defaults to today Oman)
 * @param {Boolean} [options.skipSql] - Skip SQL delete/push when true
 */
async function runFocus9Backfill({ from, to, skipSql = false } = {}) {
  if (!from) {
    throw new Error("from date is required (YYYY-MM-DD)");
  }

  const toValue = to || moment().tz(OMAN_TIMEZONE).format("YYYY-MM-DD");

  const fromDate = parseDate(from, "from");
  const toDate = parseDate(toValue, "to");

  if (fromDate.isAfter(toDate)) {
    throw new Error("from must be on or before to");
  }

  const dates = buildDateList(fromDate, toDate);

  if (dates.length > MAX_BACKFILL_DAYS) {
    throw new Error(
      `Date range too large (${dates.length} days). Max ${MAX_BACKFILL_DAYS} days per run.`
    );
  }

  logger.info("=".repeat(60));
  logger.info("Focus9 summary backfill");
  logger.info(`Range: ${from} -> ${toValue} (${dates.length} day(s))`);
  logger.info(`SQL push: ${skipSql ? "skipped" : "enabled"}`);
  logger.info("=".repeat(60));

  const generated = [];

  for (let i = 0; i < dates.length; i++) {
    const date = dates[i];
    logger.info(`[${i + 1}/${dates.length}] Generating summary for ${date}`);

    const summary = await generateFocus9DailySummary("backfill", date);
    generated.push({
      date,
      summaryId: summary._id.toString(),
      total_transactions_processed: summary.total_transactions_processed,
      khedmah_app_addition_amt: summary.khedmah_app_addition_amt,
      khedmah_app_redeemed_amt: summary.khedmah_app_redeemed_amt,
      khedmah_delivery_addition_amt: summary.khedmah_delivery_addition_amt,
      khedmah_delivery_redeemed_amt: summary.khedmah_delivery_redeemed_amt,
      sql_synced: summary.sql_synced,
    });
  }

  let sqlDeleteResult = null;
  let sqlPushResult = null;

  if (!skipSql) {
    if (!FOCUS_SQL_ENABLED) {
      logger.warn("FOCUS_SQL_ENABLED is false — skipping SQL delete/push");
    } else {
      const rangeStart = fromDate.clone().startOf("day").toDate();
      const rangeEnd = toDate.clone().endOf("day").toDate();

      logger.info(
        `Deleting existing SQL rows from ${rangeStart.toISOString()} to ${rangeEnd.toISOString()}`
      );
      sqlDeleteResult = await deleteSqlRowsByDateRange(rangeStart, rangeEnd);
      logger.info(`Deleted ${sqlDeleteResult.deleted} SQL row(s) in range`);

      logger.info("Pushing unsynced summaries to FOCUS SQL...");
      sqlPushResult = await pushUnsyncedFocus9Summaries();
      logger.info("SQL push result", sqlPushResult);
    }
  }

  logger.info("=".repeat(60));
  logger.info("Backfill complete");
  logger.info(`Generated summaries: ${generated.length}`);
  if (sqlDeleteResult) {
    logger.info(`SQL rows deleted in range: ${sqlDeleteResult.deleted}`);
  }
  if (sqlPushResult) {
    logger.info(
      `SQL push: pushed=${sqlPushResult.pushed}, failed=${sqlPushResult.failed}, total=${sqlPushResult.total}`
    );
  }
  logger.info("=".repeat(60));

  return {
    from,
    to: toValue,
    daysProcessed: generated.length,
    generated,
    sqlDeleteResult,
    sqlPushResult,
  };
}

async function backfillFocus9SummariesCli() {
  const fromValue = parseArg("from");
  if (!fromValue) {
    throw new Error("Missing required --from=YYYY-MM-DD argument");
  }

  const toValue = parseArg("to");
  const skipSql = hasFlag("no-sql");

  await connectDatabase();
  try {
    return await runFocus9Backfill({ from: fromValue, to: toValue, skipSql });
  } finally {
    await closePool();
    await disconnectDatabase();
  }
}

if (require.main === module) {
  backfillFocus9SummariesCli()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      process.exit(0);
    })
    .catch((error) => {
      logger.error("Backfill failed:", error);
      process.exit(1);
    });
}

module.exports = { runFocus9Backfill, backfillFocus9SummariesCli };
