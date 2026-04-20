const mongoose = require("mongoose");

const bulkPointsJobSchema = new mongoose.Schema(
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
    totalRows: { type: Number, required: true },
    processedCount: { type: Number, default: 0 },
    successCount: { type: Number, default: 0 },
    skippedCount: { type: Number, default: 0 },
    failedCount: { type: Number, default: 0 },
    progress: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    estimatedTimeMs: { type: Number, default: 0 },
    requestedBy: { type: String, required: true },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
    result: { type: mongoose.Schema.Types.Mixed, default: null },
    error: { type: String, default: null },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

bulkPointsJobSchema.index({ createdBy: 1, createdAt: -1 });
bulkPointsJobSchema.index({ status: 1 });
bulkPointsJobSchema.index({ completedAt: 1 }, { expireAfterSeconds: 604800 });

const BulkPointsJob = mongoose.model("BulkPointsJob", bulkPointsJobSchema);

module.exports = BulkPointsJob;
