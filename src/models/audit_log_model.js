const mongoose = require("mongoose");

const auditLogSchema = new mongoose.Schema(
    {
        // Core fields for all log types
        timestamp: {
            type: Date,
            default: Date.now,
            index: true,
        },
        category: {
            type: String,
            enum: [
                "authentication", // Login, logout, password changes
                "data_access",    // Data viewed or accessed
                "admin_action",   // Admin performed actions
                "data_modification", // Data created, updated, deleted
                "system_event",   // System level events
                "error",          // Errors and exceptions
                "api",            // API calls
                "point_transaction", // Point earning, redemption, expiry
                "sdk_action", // SDK actions
                "app_type", // App type actions
                "trigger_event", // Trigger event actions
                "trigger_service", // Trigger service actions
                "conversion", // Conversion actions
                "redemption_rule", // Redemption rule actions
                "points_expiration", // Points expiration actions
                "tier", // Tier actions
                "point_criteria", // Point criteria actions
                "conversion_rule", // Conversion rule actions
                
            ],
            required: true,
            index: true,
        },
        action: {
            type: String,
            required: true,
            index: true,
        },
        status: {
            type: String,
            enum: ["success", "failure", "warning", "info"],
            default: "success",
            index: true,
        },

        // Actor information
        user: {
            type: mongoose.Schema.Types.ObjectId,
            refPath: "userModel",
            index: true,
        },
        userModel: {
            type: String,
            enum: ["Customer", "Admin"],
            default: "Admin",
        },
        userName: String,
        userEmail: String,

        // Request information
        ip: String,
        userAgent: String,
        requestId: {
            type: String,
            index: true,
        },

        // Target information
        targetId: {
            type: mongoose.Schema.Types.ObjectId,
            refPath: "targetModel",
            index: true,
        },
        targetModel: {
            type: String,
           
        },
        targetName: String,

        // Details of the action
        description: String,
        details: mongoose.Schema.Types.Mixed,

        // For data modifications
        before: mongoose.Schema.Types.Mixed,
        after: mongoose.Schema.Types.Mixed,

        // For errors
        errorCode: String,
        errorMessage: String,
        stackTrace: String,

        // For API calls
        endpoint: String,
        method: String,
        responseTime: Number,
        responseStatus: Number,

        // For point transactions
        points: Number,
        transactionType: {
            type: String,
            enum: ["earning", "redemption", "expiry", "adjustment", "referral"],
        },

        // For authentication
        sessionId: String,
        authMethod: {
            type: String,
            enum: ["password", "token", "api_key", "sdk_key"],
        },
    },
    {
        timestamps: true,
    }
);

// Create TTL index for automatic log rotation (default 1 days)
auditLogSchema.index({ createdAt: 1 }, {
    expireAfterSeconds: 2592000 // ✅ Correct way
});

// Create compound indexes for common queries
auditLogSchema.index({ category: 1, action: 1, timestamp: -1 });
auditLogSchema.index({ user: 1, timestamp: -1 });
auditLogSchema.index({ targetId: 1, timestamp: -1 });

const AuditLog = mongoose.model("AuditLog", auditLogSchema);

module.exports = AuditLog; 