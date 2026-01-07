const mongoose = require("mongoose");

const loyalty_points_schema = new mongoose.Schema(
  {
    customer_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
    },
    points: { type: Number, required: true },
    expiryDate: { type: Date, required: true }, // Expiry date for each point transaction
    transaction_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Transaction",
      required: true,
    },
    earnedAt: { type: Date, default: Date.now },
    status: { type: String, enum: ["active", "expired"], default: "active" },
  },
  {
    timestamps: true,
  }
);

// Indexes for faster queries
loyalty_points_schema.index({ customer_id: 1 });
loyalty_points_schema.index({ transaction_id: 1 }); // Critical for report export performance
loyalty_points_schema.index({ status: 1, expiryDate: 1 }); // For expiry checking queries
loyalty_points_schema.index({ customer_id: 1, status: 1 }); // For customer points lookup

const LoyaltyPoints = mongoose.model("LoyaltyPoints", loyalty_points_schema);

module.exports = LoyaltyPoints;
