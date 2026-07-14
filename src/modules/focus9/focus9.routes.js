const express = require("express");
const router = express.Router();
const { authorizePermission } = require("../../middlewares/auth/auth");
const {
  triggerFocus9Summary,
  triggerFocus9SqlSync,
  triggerFocus9SummaryAndSync,
} = require("./focus9.controller");

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

module.exports = router;
