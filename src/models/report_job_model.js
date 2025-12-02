const mongoose = require("mongoose");

const reportJobSchema = new mongoose.Schema(
  {
    jobId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["pending", "processing", "completed", "failed"],
      default: "pending",
      index: true,
    },
    dateRange: {
      startDate: {
        type: Date,
        required: true,
      },
      endDate: {
        type: Date,
        required: true,
      },
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
    result: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    error: {
      type: String,
      default: null,
    },
    progress: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    // For scheduled jobs (current_month, last_30_days, etc.)
    reportType: {
      type: String,
      enum: ["custom", "current_month", "last_30_days", "last_quarter"],
      default: "custom",
    },
  },
  { timestamps: true }
);

// Index for finding recent jobs by user
reportJobSchema.index({ createdBy: 1, createdAt: -1 });

// Index for finding jobs by status and date range (for cache lookup)
reportJobSchema.index({ status: 1, "dateRange.startDate": 1, "dateRange.endDate": 1 });

// TTL index to auto-delete old completed jobs after 7 days
reportJobSchema.index({ completedAt: 1 }, { expireAfterSeconds: 604800 });

const ReportJob = mongoose.model("ReportJob", reportJobSchema);

module.exports = ReportJob;


