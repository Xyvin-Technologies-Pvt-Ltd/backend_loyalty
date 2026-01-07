const express = require("express");
const router = express.Router();
const { getDashboardStats } = require("./dashboard.controllers");
const { isAuthenticated } = require("../../middlewares/auth/auth");
const {
    cacheMiddleware,
    cacheKeys,
    cachePatterns,
  } = require("../../middlewares/redis_cache/cache.middleware");


// Dashboard accessible to all authenticated users (no permission check)
router.get("/stats", isAuthenticated, cacheMiddleware(60, cacheKeys.allDashboard),  getDashboardStats);

module.exports = router;
