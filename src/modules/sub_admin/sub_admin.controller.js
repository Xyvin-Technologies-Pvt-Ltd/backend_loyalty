const SubAdmin = require("../../models/admin_model");
const Role = require("../../models/role_model");
const PasswordChangeRequest = require("../../models/password_change_request_model");
const response_handler = require("../../helpers/response_handler");
const jwt = require("jsonwebtoken");
const { hash_password } = require("../../utils/bcrypt");

// Create new sub-admin
const createSubAdmin = async (req, res) => {
  try {
    const { name, email, phoneNumber, password, roleId } = req.body;

    // Check if role exists
    const role = await Role.findById(roleId);
    if (!role) {
      return response_handler(res, 404, "Role not found");
    }

    // Check if email already exists
    const existingAdmin = await SubAdmin.findOne({ email });
    if (existingAdmin) {
      return response_handler(res, 400, "Email already registered");
    }

    const subAdmin = new SubAdmin({
      name,
      email,
      phoneNumber,
      password,
      role: roleId,
    });

    await subAdmin.save();
    await subAdmin.logActivity("CREATE", "Sub-admin account created");

    return response_handler(res, 201, "Sub-admin created successfully", {
      id: subAdmin._id,
      email: subAdmin.email,
    });
  } catch (error) {
    console.error("Error creating sub-admin:", error);
    return response_handler(res, 500, "Error creating sub-admin");
  }
};

// Get all sub-admins
const getAllSubAdmins = async (req, res) => {
  try {
    const search = req.query.search || "";

    const subAdmins = await SubAdmin.find({
      isSuperAdmin: false,
      name: { $regex: search, $options: "i" },
    })
      .select("-password -passwordResetToken -passwordResetExpires")
      .populate("role", "name description permissions");

    return response_handler(
      res,
      200,
      "Sub-admins retrieved successfully",
      subAdmins
    );
  } catch (error) {
    console.error("Error fetching sub-admins:", error);
    return response_handler(res, 500, "Error fetching sub-admins");
  }
};

// Get sub-admin by ID
const getSubAdminById = async (req, res) => {
  try {
    const { id } = req.params;
    const subAdmin = await SubAdmin.findById(id)
      .select("-password -passwordResetToken -passwordResetExpires")
      .populate("role", "name description permissions");

    if (!subAdmin) {
      return response_handler(res, 404, "Sub-admin not found");
    }

    return response_handler(
      res,
      200,
      "Sub-admin retrieved successfully",
      subAdmin
    );
  } catch (error) {
    console.error("Error fetching sub-admin:", error);
    return response_handler(res, 500, "Error fetching sub-admin");
  }
};

// Update sub-admin
const updateSubAdmin = async (req, res) => {
  try {
    const { name, email, phoneNumber, roleId, isActive, password } = req.body;
    const subAdmin = await SubAdmin.findById(req.params.id);

    if (!subAdmin) {
      return response_handler(res, 404, "Sub-admin not found");
    }

    // Update fields
    if (name) subAdmin.name = name;
    if (email) subAdmin.email = email;
    if (phoneNumber) subAdmin.phoneNumber = phoneNumber;
    if (roleId) subAdmin.role = roleId;
    if (typeof isActive === "boolean") subAdmin.isActive = isActive;

    // If password is provided, hash and update it
    if (password) {
      const hashedPassword = await hash_password(password);
      subAdmin.password = hashedPassword;
      subAdmin.isFirstLogin = true; // Force user to change password on next login
      subAdmin.passwordChangedAt = new Date();
    }

    await subAdmin.save();
    await subAdmin.logActivity("UPDATE", "Sub-admin details updated");

    return response_handler(res, 200, "Sub-admin updated successfully");
  } catch (error) {
    console.error("Error updating sub-admin:", error);
    return response_handler(res, 500, "Error updating sub-admin");
  }
};

// Delete sub-admin
const deleteSubAdmin = async (req, res) => {
  try {
    const subAdmin = await SubAdmin.findById(req.params.id);

    if (!subAdmin) {
      return response_handler(res, 404, "Sub-admin not found");
    }

    await subAdmin.logActivity("DELETE", "Sub-admin account deleted");
    await SubAdmin.findByIdAndDelete(req.params.id);

    return response_handler(res, 200, "Sub-admin deleted successfully");
  } catch (error) {
    console.error("Error deleting sub-admin:", error);
    return response_handler(res, 500, "Error deleting sub-admin");
  }
};

// Reset password
const resetPassword = async (req, res) => {
  try {
    const { email } = req.body;
    const subAdmin = await SubAdmin.findOne({ email });

    if (!subAdmin) {
      return response_handler(res, 404, "Sub-admin not found");
    }

    // Generate reset token
    const resetToken = jwt.sign({ id: subAdmin._id }, process.env.JWT_SECRET, {
      expiresIn: "1h",
    });
    subAdmin.passwordResetToken = resetToken;
    subAdmin.passwordResetExpires = Date.now() + 3600000; // 1 hour

    await subAdmin.save();
    await subAdmin.logActivity("PASSWORD_RESET", "Password reset requested");

    // TODO: Send reset email

    return response_handler(
      res,
      200,
      "Password reset instructions sent to email"
    );
  } catch (error) {
    console.error("Error resetting password:", error);
    return response_handler(res, 500, "Error resetting password");
  }
};

// Create password change request (User requests to super admin)
const createPasswordChangeRequest = async (req, res) => {
  try {
    const userId = req.user._id;

    // Check if user already has a pending request
    const existingRequest = await PasswordChangeRequest.findOne({
      user: userId,
      status: "pending",
    });

    if (existingRequest) {
      return response_handler(
        res,
        400,
        "You already have a pending password reset request"
      );
    }

    const request = new PasswordChangeRequest({
      user: userId,
    });

    await request.save();

    return response_handler(
      res,
      201,
      "Password reset request submitted successfully. Please wait for admin approval.",
      {
        requestId: request._id,
      }
    );
  } catch (error) {
    console.error("Error creating password change request:", error);
    return response_handler(
      res,
      500,
      "Error submitting password reset request"
    );
  }
};

// Get all password change requests (Super Admin only)
const getAllPasswordChangeRequests = async (req, res) => {
  try {
    const { status } = req.query;
    const filter = {};

    if (status) {
      filter.status = status;
    }

    const requests = await PasswordChangeRequest.find(filter)
      .populate("user", "name email phoneNumber role")
      .populate("processedBy", "name email")
      .populate({
        path: "user",
        populate: {
          path: "role",
          select: "name",
        },
      })
      .sort({ requestedAt: -1 });

    return response_handler(
      res,
      200,
      "Password change requests retrieved successfully",
      requests
    );
  } catch (error) {
    console.error("Error fetching password change requests:", error);
    return response_handler(
      res,
      500,
      "Error fetching password change requests"
    );
  }
};

// Get user's own password change requests
const getMyPasswordChangeRequests = async (req, res) => {
  try {
    const userId = req.user._id;

    const requests = await PasswordChangeRequest.find({ user: userId })
      .populate("processedBy", "name email")
      .sort({ requestedAt: -1 });

    return response_handler(
      res,
      200,
      "Your password change requests retrieved successfully",
      requests
    );
  } catch (error) {
    console.error("Error fetching password change requests:", error);
    return response_handler(
      res,
      500,
      "Error fetching password change requests"
    );
  }
};

// Approve password change request and set new password (Super Admin only)
const approvePasswordChangeRequest = async (req, res) => {
  try {
    const { requestId } = req.params;
    const { newPassword, notes } = req.body;
    const adminId = req.user._id;

    if (!newPassword || newPassword.length < 8) {
      return response_handler(
        res,
        400,
        "New password is required and must be at least 8 characters"
      );
    }

    const request = await PasswordChangeRequest.findById(requestId).populate(
      "user"
    );

    if (!request) {
      return response_handler(res, 404, "Password change request not found");
    }

    if (request.status !== "pending") {
      return response_handler(
        res,
        400,
        "This request has already been processed"
      );
    }

    const user = await SubAdmin.findById(request.user._id);
    if (!user) {
      return response_handler(res, 404, "User not found");
    }

    // Update user password
    user.password = newPassword;
    user.requirePasswordChange = true; // User must change password on next login
    user.passwordChangedAt = new Date();
    await user.save();

    // Update request status
    request.status = "approved";
    request.processedBy = adminId;
    request.processedAt = new Date();
    request.notes = notes;
    await request.save();

    await user.logActivity("PASSWORD_RESET", "Password reset by admin");

    return response_handler(
      res,
      200,
      "Password change request approved and password reset successfully"
    );
  } catch (error) {
    console.error("Error approving password change request:", error);
    return response_handler(
      res,
      500,
      "Error approving password change request"
    );
  }
};

// Reject password change request (Super Admin only)
const rejectPasswordChangeRequest = async (req, res) => {
  try {
    const { requestId } = req.params;
    const { notes } = req.body;
    const adminId = req.user._id;

    const request = await PasswordChangeRequest.findById(requestId);

    if (!request) {
      return response_handler(res, 404, "Password change request not found");
    }

    if (request.status !== "pending") {
      return response_handler(
        res,
        400,
        "This request has already been processed"
      );
    }

    // Update request status
    request.status = "rejected";
    request.processedBy = adminId;
    request.processedAt = new Date();
    request.notes = notes;
    await request.save();

    return response_handler(res, 200, "Password change request rejected");
  } catch (error) {
    console.error("Error rejecting password change request:", error);
    return response_handler(
      res,
      500,
      "Error rejecting password change request"
    );
  }
};

module.exports = {
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
};
