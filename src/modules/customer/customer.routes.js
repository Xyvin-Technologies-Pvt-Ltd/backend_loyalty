const express = require("express");
const router = express.Router();
const {
  createCustomer,
  getAllCustomers,
  getCustomerById,
  updateCustomer,
  deleteCustomer,
  getCustomerDashboard,
  importCustomersFromExcel,
} = require("./customer.controllers");
const { authorizePermission } = require("../../middlewares/auth/auth");
const { createAuditMiddleware } = require("../audit");
const {
  cacheMiddleware,
  cacheKeys,
  cachePatterns,
} = require("../../middlewares/redis_cache/cache.middleware");
const {
  cacheInvalidationMiddleware,
  enhancedCacheInvalidationMiddleware,
} = require("../../middlewares/redis_cache/cache_invalidation.middleware");
// Create audit middleware for customers
const customerAudit = createAuditMiddleware("customer");

// Routes that require VIEW_CUSTOMERS permission
router.get(
  "/",
  authorizePermission("VIEW_CUSTOMERS"),
  customerAudit.captureResponse(),
  customerAudit.adminAction("view_customers", {
    description: "Admin viewed all customers",
    targetModel: "Customer",
  }),
  cacheMiddleware(60, cacheKeys.allCustomers),
  getAllCustomers
);

router.get(
  "/:id",
  authorizePermission("VIEW_CUSTOMERS"),
  customerAudit.captureResponse(),
  customerAudit.adminAction("view_customer", {
    description: "Admin viewed a customer",
    targetModel: "Customer",
  }),
  cacheMiddleware(60, cacheKeys.customerById),
  getCustomerById
);

router.get(
  "/:id/dashboard",
  authorizePermission("VIEW_CUSTOMERS"),
  customerAudit.captureResponse(),
  customerAudit.adminAction("view_customer_dashboard", {
    description: "Admin viewed customer dashboard",
    targetModel: "Customer",
  }),
  getCustomerDashboard
);

// Routes that require EDIT_CUSTOMERS permission
router.post(
  "/",
  authorizePermission("EDIT_CUSTOMERS"),
  customerAudit.captureResponse(),
  customerAudit.adminAction("create_customer", {
    description: "Admin created a new customer",
    targetModel: "Customer",
  }),
  enhancedCacheInvalidationMiddleware(
    { pattern: cachePatterns.allCustomers }, // Clear all customers cache (all query variations)
    cacheKeys.allCustomers,
    cacheKeys.customerById
  ),
  createCustomer
);

router.put(
  "/:id",
  authorizePermission("EDIT_CUSTOMERS"),
  customerAudit.captureResponse(),
  customerAudit.adminAction("update_customer", {
    description: "Admin updated a customer",
    targetModel: "Customer",
  }),
  enhancedCacheInvalidationMiddleware(
    { pattern: cachePatterns.allCustomers }, // Clear all customers cache (all query variations)
    cacheKeys.allCustomers,
    cacheKeys.customerById
  ),
  updateCustomer
);

// Routes that require DELETE_CUSTOMERS permission
router.delete(
  "/:id",
  authorizePermission("DELETE_CUSTOMERS"),
  customerAudit.captureResponse(),
  customerAudit.adminAction("delete_customer", {
    description: "Admin deleted a customer",
    targetModel: "Customer",
  }),
  enhancedCacheInvalidationMiddleware(
    { pattern: cachePatterns.allCustomers }, // Clear all customers cache (all query variations)
    cacheKeys.allCustomers,
    cacheKeys.customerById
  ),
  deleteCustomer
);

// Import customers from Excel endpoint
router.post("/import-excel", importCustomersFromExcel);

module.exports = router;
