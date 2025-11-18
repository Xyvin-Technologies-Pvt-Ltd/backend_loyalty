/**
 * Cache middleware
 * Provides middleware functions for caching API responses
 */

const { getCache, setCache } = require("../../config/redis");
const { logger } = require("../logger");

/**
 * Cache middleware factory
 * @param {number} ttl - Time to live in seconds
 * @param {Function} keyGenerator - Function to generate cache key (defaults to using URL)
 * @returns {Function} Express middleware
 */
const cacheMiddleware = (ttl = 3600, keyGenerator = null) => {
  return async (req, res, next) => {
    // Skip caching for non-GET requests
    if (req.method !== "GET") {
      return next();
    }

    // Generate cache key
    const key = keyGenerator
      ? keyGenerator(req)
      : `cache:${req.originalUrl || req.url}`;

    try {
      // Try to get data from cache
      const cachedData = await getCache(key);

      if (cachedData) {
        logger.debug("Cache hit", { key });
        res.setHeader("X-Cache-Status", "HIT"); // Mark response as cached
        return res.status(200).json(cachedData);
      }

      // Cache miss, capture the response
      const originalSend = res.json;

      res.json = function (data) {
        // Only cache successful responses
        if (res.statusCode >= 200 && res.statusCode < 300) {
          setCache(key, data, ttl).catch((err) =>
            logger.error("Error setting cache", { error: err.message, key })
          );
        }
        res.setHeader("X-Cache-Status", "MISS"); // Mark as cache miss
        originalSend.call(this, data);
      };

      logger.debug("Cache miss", { key });
      next();
    } catch (error) {
      logger.error("Cache middleware error", { error: error.message });
      next();
    }
  };
};

/**
 * Cache key generators for common resources
 */
const cacheKeys = {
  // Customer by ID
  customerById: (req) => `cache:customer:${req.params.id}`,

  // All customers with query params
  allCustomers: (req) => {
    const queryString = new URLSearchParams(req.query).toString();
    return `cache:customers:${queryString}`;
  },
   // All customers with query params
   allDashboard: (req) => {
    const queryString = new URLSearchParams(req.query).toString();
    return `cache:dashboard:${queryString}`;
  },

  // All reports with query params
  allReports: (req) => {
    const queryString = new URLSearchParams(req.query).toString();
    return `cache:reports:${queryString}`;
  },


  // Transactions by customer ID
  customerTransactions: (req) => `cache:customer:${req.params.id}:transactions`,

  // Tier by ID
  tierById: (req) => `cache:tier:${req.params.id}`,

  // All tiers
  allTiers: () => "cache:tiers",

  // All app types
  allAppTypes: () => "cache:app_types",

  // App type by ID
  appTypeById: (req) => `cache:app_type:${req.params.id}`,

  // coin management
  allCoinConversionRules: () => "cache:coin_conversion_rules",

  //all coupon categories
  allCouponCategories: (req) => {
    const queryString = new URLSearchParams(req.query).toString();
    return `cache:coupon_categories:${queryString}`;
  },
  allPaymentMethods: (req) => {
    const queryString = new URLSearchParams(req.query).toString();
    return `cache:payment_methods:${queryString}`;
  },
  paymentMethodById: (req) => `cache:payment_method:${req.params.id}`,
  //coupon category by id
  couponCategoryById: (req) => `cache:coupon_category:${req.params.id}`,

  //all coupon brands
  allCouponBrands: (req) => {
    const queryString = new URLSearchParams(req.query).toString();
    return `cache:coupon_brands:${queryString}`;
  },

  //coupon brand by id
  couponBrandById: (req) => `cache:coupon_brand:${req.params.id}`,

  //all points expiration rules
  allPointsExpirationRules: () => "cache:points_expiration_rules",

  //points expiration rules by id
  pointsExpirationRulesById: (req) =>
    `cache:points_expiration_rules:${req.params.id}`,

  //points expiration rules by user id
  allPointsExpirationRulesByUser: (req) =>
    `cache:points_expiration_rules:${req.params.user_id}`,

  //all point criteria
  allPointCriteria: () => "cache:point_criteria",

  //point criteria by id
  pointCriteriaById: (req) => `cache:point_criteria:${req.params.id}`,

  //redeem rules
  allRedemptionRules: () => "cache:redemption_rules",

  //redemption rules by id
  redemptionRulesById: (req) => `cache:redemption_rules:${req.params.id}`,

  //redemption history by user id
  redemptionHistoryByUser: (req) =>
    `cache:redemption_history:${req.params.user_id}`,

  //all referral programs
  allReferralPrograms: () => "cache:referral_programs",

  //all theme settings
  allThemeSettings: () => "cache:theme_settings",

  //all trigger events
  allTriggerEvents: (req) => {
    const queryString = new URLSearchParams(req.query).toString();
    return `cache:trigger_events:${queryString}`;
  },

  //trigger event by id
  triggerEventById: (req) => `cache:trigger_event:${req.params.id}`,

  //all trigger services
  allTriggerServices: (req) => {
    const queryString = new URLSearchParams(req.query).toString();
    return `cache:trigger_services:${queryString}`;
  },

  //trigger service by id
  triggerServicesById: (req) => `cache:trigger_service:${req.params.id}`,

  //all trigger services by event id
  allTriggerServicesByEventId: (req) =>
    `cache:trigger_services:${req.params.event_id}`,

  //trigger service by event id
  triggerServiceByEventId: (req) =>
    `cache:trigger_service:${req.params.event_id}`,

  //all trigger services by event id
  allTriggerServicesByEventId: (req) =>
    `cache:trigger_services:${req.params.event_id}`,

  //trigger service by event id
  triggerServiceByEventId: (req) =>
    `cache:trigger_service:${req.params.event_id}`,

  // Custom key generator
  custom: (prefix) => (req) => {
    const id = req.params.id || "";
    const queryString = new URLSearchParams(req.query).toString();
    return `cache:${prefix}:${id}:${queryString}`;
  },
};

/**
 * Cache key patterns for invalidation using wildcards
 * These patterns are used with clearCacheByPattern to clear multiple cache entries
 */
const cachePatterns = {
  allCustomers: "cache:customers:*",
  allCouponCategories: "cache:coupon_categories:*",
  allCouponBrands: "cache:coupon_brands:*",
  allPaymentMethods: "cache:payment_methods:*",
  allTriggerEvents: "cache:trigger_events:*",
  allTriggerServices: "cache:trigger_services:*",
  allTriggerServicesByEventId: (eventId) => `cache:trigger_services:${eventId}`,
  customerTransactions: (customerId) => `cache:customer:${customerId}:*`,
  custom: (prefix) => `cache:${prefix}:*`,
};

module.exports = {
  cacheMiddleware,
  cacheKeys,
  cachePatterns,
};
