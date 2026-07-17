const express = require("express");
const router = express.Router();
const { authorizePermission } = require("../../middlewares/auth/auth");
const {
  triggerFocus9Summary,
  triggerFocus9SqlSync,
  triggerFocus9SummaryAndSync,
  getFocus9SqlStatus,
  getFocus9SqlData,
  getFocus9MongoData,
  triggerFocus9Backfill,
  deleteFocus9SqlRow,
} = require("./focus9.controller");

router.get(
  "/sql-status",
  authorizePermission("MANAGE_SETTINGS"),
  getFocus9SqlStatus
);

router.get(
  "/sql-data",
  authorizePermission("MANAGE_SETTINGS"),
  getFocus9SqlData
);

router.get(
  "/mongo-data",
  authorizePermission("MANAGE_SETTINGS"),
  getFocus9MongoData
);

router.delete(
  "/sql-data/:id",
  authorizePermission("MANAGE_SETTINGS"),
  deleteFocus9SqlRow
);

router.post(
  "/generate-summary",
  authorizePermission("MANAGE_SETTINGS"),
  triggerFocus9Summary
);

router.post(
  "/sync-sql",
  authorizePermission("MANAGE_SETTINGS"),
  triggerFocus9SqlSync
);

router.post(
  "/generate-and-sync",
  authorizePermission("MANAGE_SETTINGS"),
  triggerFocus9SummaryAndSync
);

router.post(
  "/backfill",
  authorizePermission("MANAGE_SETTINGS"),
  triggerFocus9Backfill
);

module.exports = router;
