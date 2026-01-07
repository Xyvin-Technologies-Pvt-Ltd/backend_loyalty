const express = require("express");
const router = express.Router();
const { 
  getReportData, 
  exportReportCSV, 
  exportTransactionReport,
  getTransactionExportCount 
} = require("./reports.controller");
const { authorizePermission } = require("../../middlewares/auth/auth");
const {
  cacheMiddleware,
  cacheKeys,
} = require("../../middlewares/redis_cache/cache.middleware");

// Middleware to increase timeout for reports endpoint (no timeout - infinite)
const reportsTimeout = (req, res, next) => {
  req.setTimeout(0); // 0 means no timeout - infinite
  res.setTimeout(0);
  next();
};

// Get report data
router.get(
  "/data",
  authorizePermission("VIEW_REPORTS"),
  reportsTimeout,
  cacheMiddleware(60, cacheKeys.allReports),
  getReportData
);

// Export report as CSV
router.get(
  "/export-csv",
  authorizePermission("VIEW_REPORTS"),
  exportReportCSV
);

// Get transaction count before export (for UI estimation)
router.get(
  "/transaction-export/count",
  authorizePermission("VIEW_REPORTS"),
  getTransactionExportCount
);

// Export transaction report as CSV (streaming)
router.get(
  "/transaction-export",
  authorizePermission("VIEW_REPORTS"),
  reportsTimeout,
  exportTransactionReport
);

module.exports = router;




