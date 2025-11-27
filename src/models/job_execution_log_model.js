const mongoose = require("mongoose");

const jobExecutionLogSchema = new mongoose.Schema(
  {
    // Job identification
    jobName: {
      type: String,
      required: true,
      enum: ["point_expiry_checker", "tier_downgrade"],
      index: true,
    },
    jobType: {
      type: String,
      enum: ["daily", "monthly", "manual"],
      required: true,
      index: true,
    },

    // Execution timing
    startedAt: {
      type: Date,
      required: true,
      index: true,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    duration: {
      type: Number, // Duration in milliseconds
      default: null,
    },

    // Execution status
    status: {
      type: String,
      enum: ["running", "completed", "failed", "partial"],
      default: "running",
      required: true,
      index: true,
    },

    // Processing metrics
    metrics: {
      totalRecords: {
        type: Number,
        default: 0,
      },
      processedRecords: {
        type: Number,
        default: 0,
      },
      successfulRecords: {
        type: Number,
        default: 0,
      },
      failedRecords: {
        type: Number,
        default: 0,
      },
    },

    // Error information
    error: {
      message: String,
      stack: String,
      code: String,
    },

    // Job-specific details
    details: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    // Additional metadata
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for efficient querying
jobExecutionLogSchema.index({ jobName: 1, startedAt: -1 });
jobExecutionLogSchema.index({ status: 1, startedAt: -1 });
jobExecutionLogSchema.index({ createdAt: -1 });

// TTL index - keep logs for 90 days (optional, can be configured)
if (process.env.ENVIRONMENT !== "development") {
  jobExecutionLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });
}

const JobExecutionLog = mongoose.model(
  "JobExecutionLog",
  jobExecutionLogSchema
);

module.exports = JobExecutionLog;

