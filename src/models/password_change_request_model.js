const mongoose = require("mongoose");

const passwordChangeRequestSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    requestedAt: {
      type: Date,
      default: Date.now,
    },
    processedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
    },
    processedAt: Date,
    notes: String,
    newPassword: String, // Temporary storage for admin-set password (will be hashed)
  },
  {
    timestamps: true,
  }
);

const PasswordChangeRequest = mongoose.model(
  "PasswordChangeRequest",
  passwordChangeRequestSchema
);

module.exports = PasswordChangeRequest;
