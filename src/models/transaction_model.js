const mongoose = require("mongoose");
const { v4: uuidv4 } = require('uuid');
const transaction_schema = new mongoose.Schema(
  {
    customer_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
    },
    coupon_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CouponCode",
      default: null,
    },
    transaction_type: {
      type: String,
      required: true,
    },

    points: {
      type: Number,
      required: true,
      // Positive for earn, negative for redeem/expire
    },

    transaction_id: {
      type: String,
      unique: true,
      required: true,
      default: uuidv4(),
    },


    point_criteria: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PointsCriteria",
      default: null,
    },
    payment_method: {
      type: String,
      // Separate logic for Khedmah & KhedmahPay
      default: null,
    },

    status: {
      type: String,
      trim: true,
      enum: [
        "pending",
        "completed",
        "rejected",
        "cancelled",
        "failed",
        "expired",
      ],
      default: "pending",
    },

    note: {
      type: String,
      trim: true,
    },

    reference_id: {
      type: String,
      // ID of the original transaction or action that triggered this
      trim: true,
    },

    app_type: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AppType",
      default: null,
    },

    transaction_date: {
      type: Date,
      default: Date.now,
    },

    metadata: {
      type: mongoose.Schema.Types.Mixed,
      // Flexible field for additional context-specific data
      default: {},
    },
  },
  { timestamps: true }
);

// Indexes for faster queries
transaction_schema.index({ customer_id: 1, transaction_date: -1 });
transaction_schema.index({ customer_id: 1, transaction_type: 1 });
// transaction_schema.index({ transaction_id: 1 }, { unique: true });
transaction_schema.index({ reference_id: 1 });
transaction_schema.index({ point_criteria: 1 });

// Critical indexes for reports performance
transaction_schema.index({ transaction_date: 1, status: 1, transaction_type: 1 });
transaction_schema.index({ transaction_date: 1, status: 1, "metadata.requested_by": 1 });
transaction_schema.index({ transaction_type: 1, status: 1, transaction_date: 1, "metadata.requested_by": 1 });
transaction_schema.index({ transaction_id: 1, transaction_type: 1 }); // For PROMO and ADMIN regex queries

const Transaction = mongoose.model("Transaction", transaction_schema);

module.exports = Transaction; 
