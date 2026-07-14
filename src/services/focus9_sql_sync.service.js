const sql = require("mssql");
const Focus9DailySummary = require("../models/focus9_daily_summary_model");
const { logger } = require("../middlewares/logger");
const {
  FOCUS_SQL_ENABLED,
  FOCUS_SQL_HOST,
  FOCUS_SQL_PORT,
  FOCUS_SQL_DATABASE,
  FOCUS_SQL_USER,
  FOCUS_SQL_PASSWORD,
  FOCUS_SQL_TABLE,
  FOCUS_SQL_ENCRYPT,
  FOCUS_SQL_TRUST_SERVER_CERT,
} = require("../config/env");

let poolPromise = null;

function isFocusSqlConfigured() {
  return Boolean(
    FOCUS_SQL_HOST &&
      FOCUS_SQL_DATABASE &&
      FOCUS_SQL_USER &&
      FOCUS_SQL_PASSWORD
  );
}

function getPool() {
  if (!poolPromise) {
    const config = {
      server: FOCUS_SQL_HOST,
      port: FOCUS_SQL_PORT,
      database: FOCUS_SQL_DATABASE,
      user: FOCUS_SQL_USER,
      password: FOCUS_SQL_PASSWORD,
      options: {
        encrypt: FOCUS_SQL_ENCRYPT,
        trustServerCertificate: FOCUS_SQL_TRUST_SERVER_CERT,
      },
      pool: {
        max: 5,
        min: 0,
        idleTimeoutMillis: 30000,
      },
    };

    poolPromise = new sql.ConnectionPool(config)
      .connect()
      .then((pool) => {
        logger.info("Connected to FOCUS SQL Server", {
          host: FOCUS_SQL_HOST,
          database: FOCUS_SQL_DATABASE,
        });
        return pool;
      })
      .catch((error) => {
        poolPromise = null;
        throw error;
      });
  }

  return poolPromise;
}

function buildRows(summary) {
  const transactionDate = summary.date;

  return [
    {
      TransactionDate: transactionDate,
      TransactionType: "Khedmah App",
      AdditionAmount: summary.khedmah_app_addition_amt || 0,
      ExpiryAmount: summary.khedmah_app_expired_amt || 0,
      RedemptionAmount: 0,
      RedemptionCancel: summary.khedmah_app_redeem_cancellation_amt || 0,
      ManualAddition: summary.khedmah_app_manual_addition_amt || 0,
      ManualDeduction: summary.khedmah_app_manual_reduction_amt || 0,
      PostedStatus: 0,
    },
    {
      TransactionDate: transactionDate,
      TransactionType: "Khedmah Delivery",
      AdditionAmount: summary.khedmah_delivery_addition_amt || 0,
      ExpiryAmount: summary.khedmah_delivery_expired_amt || 0,
      RedemptionAmount: summary.khedmah_delivery_redeemed_amt || 0,
      RedemptionCancel: summary.khedmah_delivery_redeem_cancellation_amt || 0,
      ManualAddition: summary.khedmah_delivery_manual_addition_amt || 0,
      ManualDeduction: summary.khedmah_delivery_manual_reduction_amt || 0,
      PostedStatus: 0,
    },
  ];
}

async function insertRows(transaction, rows) {
  const insertQuery = `
    INSERT INTO ${FOCUS_SQL_TABLE} (
      TransactionDate,
      TransactionType,
      AdditionAmount,
      ExpiryAmount,
      RedemptionAmount,
      RedemptionCancel,
      ManualAddition,
      ManualDeduction,
      PostedStatus
    ) VALUES (
      @TransactionDate,
      @TransactionType,
      @AdditionAmount,
      @ExpiryAmount,
      @RedemptionAmount,
      @RedemptionCancel,
      @ManualAddition,
      @ManualDeduction,
      @PostedStatus
    )
  `;

  for (const row of rows) {
    const request = new sql.Request(transaction);
    request.input("TransactionDate", sql.DateTime, row.TransactionDate);
    request.input("TransactionType", sql.VarChar(50), row.TransactionType);
    request.input("AdditionAmount", sql.Decimal(18, 3), row.AdditionAmount);
    request.input("ExpiryAmount", sql.Decimal(18, 3), row.ExpiryAmount);
    request.input("RedemptionAmount", sql.Decimal(18, 3), row.RedemptionAmount);
    request.input("RedemptionCancel", sql.Decimal(18, 3), row.RedemptionCancel);
    request.input("ManualAddition", sql.Decimal(18, 3), row.ManualAddition);
    request.input("ManualDeduction", sql.Decimal(18, 3), row.ManualDeduction);
    request.input("PostedStatus", sql.Int, row.PostedStatus);

    await request.query(insertQuery);
  }
}

async function pushSummary(summary) {
  const pool = await getPool();
  const rows = buildRows(summary);
  const transaction = new sql.Transaction(pool);

  try {
    await transaction.begin();
    await insertRows(transaction, rows);
    await transaction.commit();

    await Focus9DailySummary.findByIdAndUpdate(summary._id, {
      sql_synced: true,
      sql_synced_at: new Date(),
      sql_sync_error: null,
    });

    logger.info("Successfully pushed Focus9 summary to FOCUS SQL", {
      summaryId: summary._id,
      date: summary.date,
      rowsInserted: rows.length,
    });

    return { success: true, rowsInserted: rows.length };
  } catch (error) {
    try {
      await transaction.rollback();
    } catch (rollbackError) {
      logger.error("Failed to rollback FOCUS SQL transaction", {
        error: rollbackError.message,
      });
    }

    await Focus9DailySummary.findByIdAndUpdate(summary._id, {
      sql_sync_error: error.message,
    });

    logger.error("Failed to push Focus9 summary to FOCUS SQL", {
      summaryId: summary._id,
      date: summary.date,
      error: error.message,
      stack: error.stack,
    });

    throw error;
  }
}

async function pushUnsyncedFocus9Summaries() {
  if (!FOCUS_SQL_ENABLED) {
    logger.info("FOCUS SQL sync skipped — FOCUS_SQL_ENABLED is false");
    return { skipped: true, reason: "disabled", pushed: 0, failed: 0 };
  }

  if (!isFocusSqlConfigured()) {
    logger.warn("FOCUS SQL sync skipped — connection details are incomplete");
    return { skipped: true, reason: "not_configured", pushed: 0, failed: 0 };
  }

  const unsyncedSummaries = await Focus9DailySummary.find({
    sql_synced: false,
  })
    .sort({ date: 1 })
    .lean();

  if (!unsyncedSummaries.length) {
    logger.info("No unsynced Focus9 summaries found for SQL push");
    return { skipped: false, pushed: 0, failed: 0, total: 0 };
  }

  logger.info(`Found ${unsyncedSummaries.length} unsynced Focus9 summaries`);

  let pushed = 0;
  let failed = 0;
  const errors = [];

  for (const summary of unsyncedSummaries) {
    try {
      await pushSummary(summary);
      pushed++;
    } catch (error) {
      failed++;
      errors.push({
        summaryId: summary._id,
        date: summary.date,
        error: error.message,
      });
    }
  }

  logger.info("FOCUS SQL sync batch completed", {
    total: unsyncedSummaries.length,
    pushed,
    failed,
  });

  return {
    skipped: false,
    total: unsyncedSummaries.length,
    pushed,
    failed,
    errors,
  };
}

async function closePool() {
  if (poolPromise) {
    const pool = await poolPromise;
    await pool.close();
    poolPromise = null;
  }
}

module.exports = {
  buildRows,
  pushSummary,
  pushUnsyncedFocus9Summaries,
  closePool,
};
