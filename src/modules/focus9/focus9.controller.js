const response_handler = require("../../helpers/response_handler");
const { logger } = require("../../middlewares/logger");
const { generateFocus9DailySummary } = require("../../jobs/focus9_daily_summary.job");
const {
  pushUnsyncedFocus9Summaries,
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

    return response_handler(res, 200, "Focus9 summary generated and SQL sync attempted", {
      summaryId: summary._id,
      date: summary.date,
      syncResult,
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

module.exports = {
  triggerFocus9Summary,
  triggerFocus9SqlSync,
  triggerFocus9SummaryAndSync,
};
