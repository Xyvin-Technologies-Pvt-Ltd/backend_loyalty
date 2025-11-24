const express = require("express");
const router = express.Router();
const { getReportData, exportReportCSV } = require("./reports.controller");
const { authorizePermission } = require("../../middlewares/auth/auth");
const {
  cacheMiddleware,
  cacheKeys,
} = require("../../middlewares/redis_cache/cache.middleware");

// Get report data
router.get(
  "/data",
  authorizePermission("VIEW_AUDIT_LOGS"),
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




