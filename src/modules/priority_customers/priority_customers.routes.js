const express = require("express");
const router = express.Router();
const {
  createPriorityCustomer,
  getAllPriorityCustomers,
  getPriorityCustomerById,
  updatePriorityCustomer,
  deletePriorityCustomer,
  checkPriorityCustomer,
} = require("./priority_customers.controller");
const { authorizePermission } = require("../../middlewares/auth/auth");
const { createAuditMiddleware } = require("../audit");
const {
  enhancedCacheInvalidationMiddleware,
} = require("../../middlewares/redis_cache/cache_invalidation.middleware");
const { cachePatterns } = require("../../middlewares/redis_cache/cache.middleware");

const priorityCustomerAudit = createAuditMiddleware("priority_customers");

const invalidateCustomerCaches = enhancedCacheInvalidationMiddleware(
  { pattern: cachePatterns.allCustomers },
  {
    pattern: (req) => {
      const customerId =
        req.priorityCustomerCustomerId ||
        req.body?.customer_id ||
        req.params?.customerId ||
        null;

      if (!customerId) return null;
      return cachePatterns.custom(`customer:${customerId}`);
    },
  },
  { pattern: cachePatterns.custom("transactions") },
  { pattern: cachePatterns.custom("dashboard") }
);

router.get(
  "/check/:customerId",
  authorizePermission("VIEW_CUSTOMERS"),
  priorityCustomerAudit.captureResponse(),
  priorityCustomerAudit.adminAction("check_priority_customer", {
    description: "Admin checked a customer's priority status",
    targetModel: "Customer",
    targetId: (req) => req.params.customerId,
  }),
  checkPriorityCustomer
);

router.use(authorizePermission("MANAGE_PRIORITY_CUSTOMERS"));

router.post(
  "/",
  priorityCustomerAudit.captureResponse(),
  priorityCustomerAudit.adminAction("create_priority_customer", {
    description: "Admin marked customer as priority",
    targetModel: "PriorityCustomer",
    details: (req) => req.body,
  }),
  invalidateCustomerCaches,
  createPriorityCustomer
);

router.get(
  "/",
  priorityCustomerAudit.captureResponse(),
  priorityCustomerAudit.adminAction("list_priority_customers", {
    description: "Admin viewed priority customers list",
    targetModel: "PriorityCustomer",
  }),
  getAllPriorityCustomers
);

router.get(
  "/:id",
  priorityCustomerAudit.captureResponse(),
  priorityCustomerAudit.adminAction("view_priority_customer", {
    description: "Admin viewed priority customer details",
    targetModel: "PriorityCustomer",
    targetId: (req) => req.params.id,
  }),
  getPriorityCustomerById
);

router.put(
  "/:id",
  priorityCustomerAudit.captureResponse(),
  priorityCustomerAudit.adminAction("update_priority_customer", {
    description: "Admin updated priority customer",
    targetModel: "PriorityCustomer",
    targetId: (req) => req.params.id,
    details: (req) => req.body,
  }),
  invalidateCustomerCaches,
  updatePriorityCustomer
);

router.delete(
  "/:id",
  priorityCustomerAudit.captureResponse(),
  priorityCustomerAudit.adminAction("delete_priority_customer", {
    description: "Admin removed priority customer",
    targetModel: "PriorityCustomer",
    targetId: (req) => req.params.id,
  }),
  invalidateCustomerCaches,
  deletePriorityCustomer
);

module.exports = router;

