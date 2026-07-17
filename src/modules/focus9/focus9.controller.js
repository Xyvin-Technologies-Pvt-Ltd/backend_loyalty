const response_handler = require("../../helpers/response_handler");
const { logger } = require("../../middlewares/logger");
const { NODE_ENV } = require("../../config/env");
const { generateFocus9DailySummary } = require("../../jobs/focus9_daily_summary.job");
const {
  pushUnsyncedFocus9Summaries,
  testSqlConnection,
  fetchSqlTableData,
  getMongoSyncStatus,
  deleteSqlRow,
} = require("../../services/focus9_sql_sync.service");

async function triggerFocus9Summary(req, res) {
  try {
    const summary = await generateFocus9DailySummary("manual");
    return response_handler(res, 200, "Focus9 daily summary generated", {
      summaryId: summary._id,
      date: summary.date,
      sql_synced: summary.sql_synced,
    });
  } catch (error) {
    logger.error(`Manual Focus9 summary generation failed: ${error.message}`, {
      stack: error.stack,
    });
    return response_handler(res, 500, "Failed to generate Focus9 summary", error.message);
  }
}

async function triggerFocus9SqlSync(req, res) {
  try {
    const result = await pushUnsyncedFocus9Summaries();
    return response_handler(res, 200, "Focus9 SQL sync completed", result);
  } catch (error) {
    logger.error(`Manual Focus9 SQL sync failed: ${error.message}`, {
      stack: error.stack,
    });
    return response_handler(res, 500, "Failed to sync Focus9 summaries to SQL", error.message);
  }
}

async function triggerFocus9SummaryAndSync(req, res) {
  try {
    const summary = await generateFocus9DailySummary("manual");
    const syncResult = await pushUnsyncedFocus9Summaries();
    const sqlStatus = await testSqlConnection();

    let sqlData = null;
    if (sqlStatus.connected) {
      try {
        sqlData = await fetchSqlTableData(20);
      } catch (error) {
        sqlData = { error: error.message };
      }
    }

    return response_handler(res, 200, "Focus9 summary generated and SQL sync attempted", {
      summaryId: summary._id,
      date: summary.date,
      syncResult,
      sqlStatus,
      sqlData,
    });
  } catch (error) {
    logger.error(`Manual Focus9 summary + sync failed: ${error.message}`, {
      stack: error.stack,
    });
    return response_handler(
      res,
      500,
      "Failed to generate Focus9 summary and sync to SQL",
      error.message
    );
  }
}

async function getFocus9SqlStatus(req, res) {
  try {
    const sqlStatus = await testSqlConnection();
    const mongoStatus = await getMongoSyncStatus();

    return response_handler(res, 200, "Focus9 SQL status fetched", {
      sql: sqlStatus,
      mongo: mongoStatus,
    });
  } catch (error) {
    logger.error(`Focus9 SQL status check failed: ${error.message}`, {
      stack: error.stack,
    });
    return response_handler(res, 500, "Failed to fetch Focus9 SQL status", error.message);
  }
}

async function getFocus9SqlData(req, res) {
  try {
    const limit = req.query.limit || 50;
    const sqlStatus = await testSqlConnection();

    if (!sqlStatus.connected) {
      return response_handler(res, 400, "FOCUS SQL is not connected", {
        sql: sqlStatus,
        rows: [],
        count: 0,
      });
    }

    const sqlData = await fetchSqlTableData(limit);

    return response_handler(res, 200, "Focus9 SQL table data fetched", {
      sql: sqlStatus,
      ...sqlData,
    });
  } catch (error) {
    logger.error(`Focus9 SQL data fetch failed: ${error.message}`, {
      stack: error.stack,
    });
    return response_handler(res, 500, "Failed to fetch Focus9 SQL table data", error.message);
  }
}

async function deleteFocus9SqlRow(req, res) {
  if (NODE_ENV === "production") {
    return response_handler(
      res,
      403,
      "Deleting FOCUS SQL rows is disabled in production"
    );
  }

  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      return response_handler(res, 400, "Invalid transaction id");
    }

    const sqlStatus = await testSqlConnection();
    if (!sqlStatus.connected) {
      return response_handler(res, 400, "FOCUS SQL is not connected", {
        sql: sqlStatus,
      });
    }

    const result = await deleteSqlRow(id);

    if (!result.deleted) {
      return response_handler(res, 404, "FOCUS SQL row not found", result);
    }

    return response_handler(res, 200, "FOCUS SQL row deleted", result);
  } catch (error) {
    logger.error(`Focus9 SQL row delete failed: ${error.message}`, {
      stack: error.stack,
      id: req.params.id,
    });
    return response_handler(res, 500, "Failed to delete FOCUS SQL row", error.message);
  }
}

module.exports = {
  triggerFocus9Summary,
  triggerFocus9SqlSync,
  triggerFocus9SummaryAndSync,
  getFocus9SqlStatus,
  getFocus9SqlData,
  deleteFocus9SqlRow,
};
