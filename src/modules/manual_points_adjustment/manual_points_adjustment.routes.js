const express = require("express");
const multer = require("multer");
const {
  addPointsIndividual,
  addPointsBulk,
  reducePoints,
  downloadSampleTemplate,
} = require("./manual_points_adjustment.controller");
const {
  validateAddIndividualPayload,
  validateBulkPayload,
  validateReducePayload,
} = require("./manual_points_adjustment.validator");
const { authorizePermission } = require("../../middlewares/auth/auth");
const { createAuditMiddleware } = require("../audit");
const {
  enhancedCacheInvalidationMiddleware,
} = require("../../middlewares/redis_cache/cache_invalidation.middleware");
const { cachePatterns } = require("../../middlewares/redis_cache/cache.middleware");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

const manualPointsAudit = createAuditMiddleware("manual_points_adjustment");

const invalidateCustomerCaches = enhancedCacheInvalidationMiddleware(
  { pattern: cachePatterns.allCustomers },
  {
    pattern: (req) =>
      (() => {
        const customerId = req.body?.customer_id || req.params?.customerId;
        return customerId ? cachePatterns.customerTransactions(customerId) : null;
      })(),
  },
  { pattern: cachePatterns.custom("transactions") },
  { pattern: cachePatterns.custom("dashboard") }
);

router.post(
  "/add-individual",
  authorizePermission("ADJUST_POINTS"),
  manualPointsAudit.captureResponse(),
  manualPointsAudit.adminAction("manual_points_add_individual", {
    description: "Admin manually added points to a customer",
    targetModel: "Transaction",
  }),
  validateAddIndividualPayload,
  invalidateCustomerCaches,
  addPointsIndividual
);

router.post(
  "/add-bulk",
  authorizePermission("ADJUST_POINTS"),
  manualPointsAudit.captureResponse(),
  manualPointsAudit.adminAction("manual_points_add_bulk", {
    description: "Admin uploaded manual points adjustments in bulk",
    targetModel: "Transaction",
  }),
  upload.single("file"),
  validateBulkPayload,
  enhancedCacheInvalidationMiddleware(
    { pattern: cachePatterns.allCustomers },
    { pattern: cachePatterns.custom("transactions") },
    { pattern: cachePatterns.custom("dashboard") }
  ),
  addPointsBulk
);

router.post(
  "/reduce",
  authorizePermission("ADJUST_POINTS"),
  manualPointsAudit.captureResponse(),
  manualPointsAudit.adminAction("manual_points_reduce", {
    description: "Admin manually reduced points for a customer",
    targetModel: "Transaction",
  }),
  validateReducePayload,
  invalidateCustomerCaches,
  reducePoints
);

router.get(
  "/sample-template",
  authorizePermission("ADJUST_POINTS"),
  manualPointsAudit.captureResponse(),
  manualPointsAudit.adminAction("manual_points_sample_template", {
    description: "Admin downloaded the manual points sample template",
    targetModel: "Transaction",
  }),
  downloadSampleTemplate
);

module.exports = router;

