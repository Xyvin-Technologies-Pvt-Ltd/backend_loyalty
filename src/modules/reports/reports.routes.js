const express = require("express");
const router = express.Router();
const { getReportData, exportReportCSV } = require("./reports.controller");
const { authorizePermission } = require("../../middlewares/auth/auth");
const {
  cacheMiddleware,
  cacheKeys,
} = require("../../middlewares/redis_cache/cache.middleware");

// Middleware to increase timeout for reports endpoint (120 seconds)
const reportsTimeout = (req, res, next) => {
  req.setTimeout(120000); // 120 seconds
  res.setTimeout(120000);
  next();
};

// Get report data
router.get(
  "/data",
  authorizePermission("VIEW_AUDIT_LOGS"),
  reportsTimeout,
  cacheMiddleware(60, cacheKeys.allReports),
  getReportData
);

// Export report as CSV
router.get(
  "/export-csv",
  authorizePermission("VIEW_AUDIT_LOGS"),
  exportReportCSV
);

module.exports = router;




