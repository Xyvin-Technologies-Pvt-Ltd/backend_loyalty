const mongoose = require("mongoose");

const focus9DailySummarySchema = new mongoose.Schema(
  {
    date: {
      type: Date,
      required: true,
      unique: true,
      index: true,
    },
    khedmah_app_addition_amt: {
      type: Number,
      default: 0,
      required: true,
    },
    khedmah_app_expired_amt: {
      type: Number,
      default: 0,
      required: true,
    },
    khedmah_app_redeemed_amt: {
      type: Number,
      default: 0,
      required: true,
    },
    khedmah_delivery_addition_amt: {
      type: Number,
      default: 0,
      required: true,
    },
    khedmah_delivery_expired_amt: {
      type: Number,
      default: 0,
      required: true,
    },
    khedmah_delivery_redeemed_amt: {
      type: Number,
      default: 0,
      required: true,
    },
    posting_flag: {
      type: Number,
      default: 0,
      enum: [0, 1],
      required: true,
      index: true,
    },
    total_transactions_processed: {
      type: Number,
      default: 0,
      required: true,
    },
    summary_generated_at: {
      type: Date,
      default: Date.now,
      required: true,
    },
  },
  { timestamps: true }
);

// Indexes for faster queries
focus9DailySummarySchema.index({ date: 1 }, { unique: true });
focus9DailySummarySchema.index({ posting_flag: 1 });
focus9DailySummarySchema.index({ createdAt: -1 });

const Focus9DailySummary = mongoose.model(
  "Focus9DailySummary",
  focus9DailySummarySchema
);

module.exports = Focus9DailySummary;

