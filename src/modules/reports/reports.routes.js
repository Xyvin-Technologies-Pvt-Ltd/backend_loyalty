const express = require("express");
const router = express.Router();
const {
  generatePointsReport,
  updateTransactionAppTypes,
} = require("./reports.controller");
const { authorizePermission } = require("../../middlewares/auth/auth");
const { createAuditMiddleware } = require("../audit");
const { generatePointsReportValidator } = require("./reports.validator");

// Create audit middleware for the reports module
const reportsAudit = createAuditMiddleware("reports");

/**
 * @route GET /api/reports/points-activity
 * @desc Generate and download points activity report in Excel format
 * @access Protected - Requires VIEW_REPORTS or EXPORT_REPORTS permission
 */
router.get(
  "/points-activity",
  authorizePermission(["VIEW_REPORTS", "EXPORT_REPORTS"]),
  reportsAudit.adminAction("generate_report", {
    description: "Admin generated points activity report",
    targetModel: "Report",
    details: (req) => ({
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      appType: req.query.appType,
    }),
  }),
  generatePointsReport
);

/**
 * @route POST /api/reports/update-transaction-app-types
 * @desc Update transactions with null app_type by looking up from metadata.requested_by
 * @access Protected - Requires MANAGE_TRANSACTIONS or SUPER_ADMIN permission
 */
router.post(
  "/update-transaction-app-types",
  authorizePermission(["MANAGE_TRANSACTIONS", "SUPER_ADMIN"]),
  reportsAudit.adminAction("update_transaction_app_types", {
    description: "Admin updated transaction app_types from metadata",
    targetModel: "Transaction",
  }),
  updateTransactionAppTypes
);

module.exports = router;
