const response_handler = require("../../helpers/response_handler");
const Admin = require("../../models/admin_model");
const Customer = require("../../models/customer_model");
const { hash_password, compare_passwords } = require("../../utils/bcrypt");
const {
  generate_referral_code,
} = require("../../utils/generate_referral_code");
const { generate_admin_token } = require("../../utils/generate_admin_token");
const validator = require("./auth.validator");

//for admin only
exports.signup = async (req, res) => {
  try {
    const { error } = validator.signup.validate(req.body, {
      abortEarly: false,
    });
    if (error) {
      const error_messages = error.details.map((err) => err.message).join(", ");
      return response_handler(res, 400, `Invalid input: ${error_messages}`);
    }

    const existing_user = await Admin.findOne({ email: req.body.email });
    if (existing_user) {
      return response_handler(res, 400, "User already exists with this email.");
    }

    req.body.password = await hash_password(req.body.password, 10);
    const new_user = await Admin.create(req.body);
    return response_handler(res, 201, "Signup successful!", new_user);
  } catch (error) {
    return response_handler(
      res,
      500,
      `Internal Server Error. ${error.message}`
    );
  }
};

exports.admin_login = async (req, res) => {
  try {
    const { error } = validator.login.validate(req.body, {
      abortEarly: false,
    });
    if (error) {
      const error_messages = error.details.map((err) => err.message).join(", ");
      return response_handler(res, 400, `Invalid input: ${error_messages}`);
    }

    const user = await Admin.findOne({ email: req.body.email });
    if (!user) {
      return response_handler(res, 400, "User not found.");
    }

    // Check if account is active
    if (!user.isActive) {
      return response_handler(
        res,
        403,
        "Account is inactive. Please contact administrator."
      );
    }

    const is_password_valid = await compare_passwords(
      req.body.password,
      user.password
    );
    if (!is_password_valid) {
      return response_handler(res, 400, "Invalid password.");
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    const jwt_token = await generate_admin_token(user._id);

    // Check if password change is required
    const requirePasswordChange =
      user.isFirstLogin || user.requirePasswordChange;

    return response_handler(res, 200, "Login successful!", {
      token: jwt_token,
      requirePasswordChange,
      isFirstLogin: user.isFirstLogin,
    });
  } catch (error) {
    return response_handler(
      res,
      500,
      `Internal Server Error. ${error.message}`
    );
  }
};

exports.getMe = async (req, res) => {
  try {
    const user = await Admin.findById(
      req.admin._id,
      "name email _id status role"
    ).populate("role");
    return response_handler(
      res,
      200,
      "User details retrieved successfully",
      user
    );
  } catch (error) {
    return response_handler(
      res,
      500,
      `Internal Server Error. ${error.message}`
    );
  }
};

exports.logout = async (req, res) => {
  try {
    res.clearCookie("token");
    return response_handler(res, 200, "Logout successful!");
  } catch (error) {
    return response_handler(
      res,
      500,
      `Internal Server Error. ${error.message}`
    );
  }
};

// Force password change (for first-time login)
exports.forcePasswordChange = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return response_handler(
        res,
        400,
        "Current password and new password are required."
      );
    }

    if (newPassword.length < 8) {
      return response_handler(
        res,
        400,
        "New password must be at least 8 characters long."
      );
    }

    const admin = await Admin.findById(req.admin._id);
    if (!admin) {
      return response_handler(res, 404, "Admin not found.");
    }

    // Verify current password
    const isPasswordValid = await compare_passwords(
      currentPassword,
      admin.password
    );
    if (!isPasswordValid) {
      return response_handler(res, 400, "Current password is incorrect.");
    }

    // Check if new password is same as current
    const isSamePassword = await compare_passwords(newPassword, admin.password);
    if (isSamePassword) {
      return response_handler(
        res,
        400,
        "New password must be different from current password."
      );
    }

    // Update password and flags
    admin.password = newPassword;
    admin.isFirstLogin = false;
    admin.requirePasswordChange = false;
    admin.passwordChangedAt = new Date();
    await admin.save();

    await admin.logActivity(
      "PASSWORD_CHANGE",
      "Password changed after first login"
    );

    return response_handler(res, 200, "Password changed successfully!");
  } catch (error) {
    return response_handler(
      res,
      500,
      `Internal Server Error. ${error.message}`
    );
  }
};

//for user only
exports.register = async (req, res) => {
  try {
    const { error } = validator.register.validate(req.body, {
      abortEarly: false,
    });
    if (error) {
      const error_messages = error.details.map((err) => err.message).join(", ");
      return response_handler(res, 400, `Invalid input: ${error_messages}`);
    }

    const existing_user = await Customer.findOne({
      $or: [
        { email: req.body.email },
        { phone: req.body.phone },
        { customer_id: req.body.customer_id },
      ],
    });
    let point = 0;
    if (existing_user) {
      const jwt_token = generate_token(existing_user._id);
      return response_handler(res, 200, "Login successful!", jwt_token);
    } else {
      //TODO: add referal logic and newly registered user points, also attach the tier based on the point
      req.body.referral_code = await generate_referral_code(req.body.name);
      if (req.body.refer_code) {
        const refer_user = await Customer.findOne({
          referral_code: req.body.refer_code,
        });
        if (!refer_user) {
          return response_handler(res, 400, "Invalid referal code.");
        }
        refer_user.user_referer_count += 1;
        await refer_user.save();
        req.body.referred_by = refer_user._id;
      }
      const new_user = await Customer.create(req.body);
      const jwt_token = generate_token(new_user._id);
      return response_handler(res, 200, "Login successful!", jwt_token);
    }
  } catch (error) {
    return response_handler(
      res,
      500,
      `Internal Server Error. ${error.message}`
    );
  }
};
