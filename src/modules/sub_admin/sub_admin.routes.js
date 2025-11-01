const express = require("express");
const router = express.Router();
const { authorizePermission } = require("../../middlewares/auth/auth");
const { protect } = require("../../middlewares/auth/protect");
const { createAuditMiddleware } = require("../audit");
const validators = require("./sub_admin.validators");
const {
  createSubAdmin,
  getAllSubAdmins,
  getSubAdminById,
  updateSubAdmin,
  deleteSubAdmin,
  resetPassword,
  createPasswordChangeRequest,
  getAllPasswordChangeRequests,
  getMyPasswordChangeRequests,
  approvePasswordChangeRequest,
  rejectPasswordChangeRequest,
} = require("./sub_admin.controller");

// Create audit middleware for the sub_admin module
const subAdminAudit = createAuditMiddleware("sub_admin");

// Create new sub-admin
router.post("/", authorizePermission("MANAGE_SUB_ADMINS"), createSubAdmin);

// Get all sub-admins
router.get("/", authorizePermission("VIEW_SUB_ADMINS"), getAllSubAdmins);

// Password Change Request Routes (MUST come before /:id routes to avoid conflicts)

// Create password change request (Any authenticated user can request)
router.post("/password-change-request", protect, createPasswordChangeRequest);

// Get all password change requests (Super Admin only)
router.get(
  "/password-change-requests",
  authorizePermission("MANAGE_SUB_ADMINS"),
  getAllPasswordChangeRequests
);

// Get user's own password change requests
router.get(
  "/my-password-change-requests",
  protect,
  getMyPasswordChangeRequests
);

// Approve password change request (Super Admin only)
router.post(
  "/password-change-request/:requestId/approve",
  authorizePermission("MANAGE_SUB_ADMINS"),
  approvePasswordChangeRequest
);

// Reject password change request (Super Admin only)
router.post(
  "/password-change-request/:requestId/reject",
  authorizePermission("MANAGE_SUB_ADMINS"),
  rejectPasswordChangeRequest
);

// Reset password
router.post(
  "/reset-password",
  authorizePermission("MANAGE_SUB_ADMINS"),
  resetPassword
);

// Get sub-admin by ID (MUST come after specific routes)
router.get("/:id", authorizePermission("VIEW_SUB_ADMINS"), getSubAdminById);

// Update sub-admin
router.put("/:id", authorizePermission("MANAGE_SUB_ADMINS"), updateSubAdmin);

// Delete sub-admin
router.delete("/:id", authorizePermission("MANAGE_SUB_ADMINS"), deleteSubAdmin);

module.exports = router;
