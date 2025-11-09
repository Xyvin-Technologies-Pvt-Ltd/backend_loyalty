const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const admin_schema = new mongoose.Schema({
    // Basic Information
    name: {
        type: String,
        required: true,
        trim: true
    },
    email: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        lowercase: true
    },
    phoneNumber: {
        type: String,
        trim: true
    },
    password: {
        type: String,
        required: true,
        minlength: 8
    },
    isFirstLogin: {
        type: Boolean,
        default: true
    },

    // Role and Access
    role: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Role',
        required: true
    },
    isActive: {
        type: Boolean,
        default: true
    },
    lastLogin: {
        type: Date
    },
    isSuperAdmin: {
        type: Boolean,
        default: false
    },



    // Security
    passwordResetToken: String,
    passwordResetExpires: Date,
    passwordChangedAt: Date,
    loginAttempts: {
        type: Number,
        default: 0
    },
    accountLocked: {
        type: Boolean,
        default: false
    },
    accountLockedUntil: Date,

    // Activity Tracking
    lastActivity: {
        type: Date,
        default: Date.now
    },
    activityLog: [{
        action: String,
        timestamp: Date,
        details: String
    }]
}, {
    timestamps: true
});

// Hash password before saving
admin_schema.pre('save', async function (next) {
    if (!this.isModified('password')) return next();

    try {
        const salt = await bcrypt.genSalt(10);
        this.password = await bcrypt.hash(this.password, salt);
        this.passwordChangedAt = new Date();
        next();
    } catch (error) {
        next(error);
    }
});

// Method to compare password
admin_schema.methods.comparePassword = async function (candidatePassword) {
    return bcrypt.compare(candidatePassword, this.password);
};

// Method to log activity
admin_schema.methods.logActivity = async function (action, details) {
    this.activityLog.push({
        action,
        timestamp: new Date(),
        details
    });
    this.lastActivity = new Date();
    await this.save();
};

// Method to check if account is locked
admin_schema.methods.isAccountLocked = function () {
    if (!this.accountLocked) return false;

    if (this.accountLockedUntil && this.accountLockedUntil > new Date()) {
        return true;
    }

    // If lock period has expired, unlock the account
    this.accountLocked = false;
    this.loginAttempts = 0;
    this.save();
    return false;
};

const Admin = mongoose.model("Admin", admin_schema);

module.exports = Admin;