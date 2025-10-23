const mongoose = require("mongoose");

const couponCodeSchema = new mongoose.Schema(
  {
    // Basic identification
    title: {
      en: { type: String, required: true },
      ar: { type: String },
    },
    description: {
      en: { type: String, required: true },
      ar: { type: String },
    },
    posterImage: {
      type: String, // URL to the image
      required: true,
    },
    priority: {
      type: Number,
    },

    // Relationships
    merchantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CouponBrand",
      required: true,
    },

    couponCategoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CouponCategory",
      default: null,
    },

    // Type and status
    type: {
      type: String,
      enum: ["PRE_GENERATED", "DYNAMIC", "ONE_TIME_LINK", "BULK-UPLOAD"],
      required: true,
    },

    code: [
      {
        pin: {
          type: String,
          required: true,
        },
        isRedeemed: {
          type: Boolean,
          default: false,
        },
      },
    ],
    status: {
      type: String,
      enum: ["UNUSED", "CLAIMED", "REDEEMED", "EXPIRED"],
      default: "UNUSED",
    },

    // Validity period
    validityPeriod: {
      startDate: {
        type: Date,
        required: true,
      },
      endDate: {
        type: Date,
        required: true,
      },
    },

    // Discount details
    discountDetails: {
      type: {
        type: String,
        enum: ["PERCENTAGE", "FIXED", "BUY-1-GET-1"],
        required: true,
      },
      value: {
        type: Number,
        required: true,
      },
    },

    // Points integration
    redeemablePointsCount: {
      type: Number,
      default: 0,
    },

    // Eligibility criteria
    eligibilityCriteria: {
      userTypes: [
        {
          type: String,
          enum: ["NEW", "EXISTING", "PREMIUM", "ALL"],
        },
      ],

      tiers: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Tier",
        },
      ],

      minTransactionHistory: {
        type: Number,
        default: 0,
      },
    },

    // Usage limits
    usagePolicy: {
      frequency: {
        type: String,
        enum: ["DAILY", "WEEKLY", "BIWEEKLY", "MONTHLY", "TOTAL"],
        required: true,
      },
      maxUsagePerPeriod: {
        type: Number,
        required: true,
      },
      maxTotalUsage: {
        type: Number,
        default: null, // null means unlimited total usage
      },
      userLimit: {
        type: Number,
        default: null, // null means unlimited users
      },
    },

    // Purchase requirements
    conditions: [
      {
        appType: [
          {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AppType",
            required: true,
          },
        ],
        minTransactionValue: {
          type: Number,
          default: 0,
        },
        maxTransactionValue: {
          type: Number,
          default: null,
        },
        applicablePaymentMethods: [
          {
            type: String,
            enum: ["Khedmah-Pay", "Khedmah-Wallet", "ALL"],
            default: "ALL",
          },
        ],
      },
    ],

    // Terms and conditions
    termsAndConditions: [
      {
        type: String,
      },
    ],
    redemptionInstructions: {
      type: String,
    },
    redemptionUrl: String,

    // Usage tracking
    usageHistory: [
      {
        customerId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Customer",
        },
        usedAt: {
          type: Date,
          default: Date.now,
        },
        pin: {
          type: String,
          required: true,
        },
        transactionId: {
          type: String,
          default: null,
        },
      },
    ],

    // Customer assignment - if claimed by a specific customer
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      default: null,
    },

    // Bulk upload tracking
    batchId: {
      type: String,
      default: null,
    },

    // One-time link specific fields
    linkData: {
      type: Object,
      default: null,
    },
  },
  { timestamps: true }
);

// Helper method to check if a user can use the coupon
couponCodeSchema.methods.canUserUseCoupon = async function (customerId) {
  const now = new Date();
  const userUsageHistory = this.usageHistory.filter(
    (usage) => usage.customerId.toString() === customerId.toString()
  );

  // Check max total usage per user
  if (
    this.usagePolicy.maxTotalUsage !== null &&
    userUsageHistory.length >= this.usagePolicy.maxTotalUsage
  ) {
    return {
      canUse: false,
      reason: "Maximum total usage limit reached",
    };
  }

  // If TOTAL frequency is specified, we've already checked the limit above
  if (this.usagePolicy.frequency === "TOTAL") {
    return { canUse: true };
  }

  // Check period-based usage
  let relevantDate;
  switch (this.usagePolicy.frequency) {
    case "DAILY":
      relevantDate = new Date(now.setHours(0, 0, 0, 0));
      break;
    case "WEEKLY":
      relevantDate = new Date(now.setDate(now.getDate() - now.getDay()));
      break;
    case "BIWEEKLY":
      relevantDate = new Date(now.setDate(now.getDate() - 14));
      break;
    case "MONTHLY":
      relevantDate = new Date(now.setDate(1));
      break;
  }

  const usageInPeriod = userUsageHistory.filter(
    (usage) => usage.usedAt >= relevantDate
  ).length;

  if (usageInPeriod >= this.usagePolicy.maxUsagePerPeriod) {
    return {
      canUse: false,
      reason: `Usage limit for this ${this.usagePolicy.frequency.toLowerCase()} period reached`,
    };
  }

  return {
    canUse: true,
  };
};

// Helper to check eligibility based on various criteria
couponCodeSchema.methods.checkEligibility = async function (
  customer,
  transactionValue,
  paymentMethod
) {
  const now = new Date();

  // Check if coupon is active and valid
  if (!this.isActive) {
    return {
      eligible: false,
      reason: "Coupon is not active",
    };
  }

  if (
    now < this.validityPeriod.startDate ||
    now > this.validityPeriod.endDate
  ) {
    return {
      eligible: false,
      reason: "Coupon is not valid at this time",
    };
  }

  // Check app type eligibility
  if (this.conditions.appType && this.conditions.appType.length > 0) {
    const customerAppTypes = customer.appTypes.map((appType) =>
      appType.toString()
    );
    const eligibleAppTypes = this.conditions.appType.map((appType) =>
      appType.toString()
    );

    if (
      !eligibleAppTypes.some((appTypeId) =>
        customerAppTypes.includes(appTypeId)
      )
    ) {
      return {
        eligible: false,
        reason: "App type not eligible for this coupon",
      };
    }
  }

  // Check transaction value
  if (transactionValue < this.conditions.minTransactionValue) {
    return {
      eligible: false,
      reason: `Minimum transaction value of ${this.conditions.minTransactionValue} required`,
    };
  }

  if (
    this.conditions.maxTransactionValue !== null &&
    transactionValue > this.conditions.maxTransactionValue
  ) {
    return {
      eligible: false,
      reason: `Transaction value exceeds maximum limit of ${this.conditions.maxTransactionValue}`,
    };
  }

  // Check payment method
  if (
    !this.conditions.applicablePaymentMethods.includes("ALL") &&
    !this.conditions.applicablePaymentMethods.includes(paymentMethod)
  ) {
    return {
      eligible: false,
      reason: "Payment method not eligible for this coupon",
    };
  }

  // Check user type eligibility
  if (
    !this.eligibilityCriteria.userTypes.includes("ALL") &&
    !this.eligibilityCriteria.userTypes.includes(user.userType)
  ) {
    return {
      eligible: false,
      reason: "User type not eligible for this coupon",
    };
  }

  // Check tier eligibility
  if (
    this.eligibilityCriteria.tiers &&
    this.eligibilityCriteria.tiers.length > 0
  ) {
    const userTierIds = user.tiers.map((tier) => tier.toString());
    const eligibleTierIds = this.eligibilityCriteria.tiers.map((tier) =>
      tier.toString()
    );

    if (!eligibleTierIds.some((tierId) => userTierIds.includes(tierId))) {
      return {
        eligible: false,
        reason: "User tier not eligible for this coupon",
      };
    }
  }

  // Check points balance
  if (user.pointsBalance < this.eligibilityCriteria.minPointsBalance) {
    return {
      eligible: false,
      reason: `Minimum points balance of ${this.eligibilityCriteria.minPointsBalance} required`,
    };
  }

  // Check usage limits
  const usageCheck = await this.canUserUseCoupon(customer._id);
  if (!usageCheck.canUse) {
    return {
      eligible: false,
      reason: usageCheck.reason,
    };
  }

  return {
    eligible: true,
  };
};

// Indexes for faster queries
// couponCodeSchema.index({ code: 1 });
couponCodeSchema.index({ merchantId: 1, isActive: 1 });
couponCodeSchema.index({
  "validityPeriod.startDate": 1,
  "validityPeriod.endDate": 1,
});
couponCodeSchema.index({ "eligibilityCriteria.tiers": 1 });
couponCodeSchema.index({ couponCategoryId: 1 });
couponCodeSchema.index({ isActive: 1, type: 1 });
couponCodeSchema.index({ batchId: 1 });

module.exports = mongoose.model("CouponCode", couponCodeSchema);
