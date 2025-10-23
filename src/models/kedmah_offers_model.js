const mongoose = require("mongoose");

// Kedmah In-house Offers Schema
const kedmahOffersSchema = new mongoose.Schema(
  {
    // Basic information
    title: {
      en: { type: String, required: true },
      ar: { type: String },
    },
    description: {
      en: { type: String, required: true },
      ar: { type: String },
    },
    posterImage: {
      type: String,
      required: true,
    },

    serviceCategory: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TriggerServices",
      required: true,
    },
    eventType: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TriggerEvent",
      default: null,
    },

    // Type and status
    offerType: {
      type: String,
      enum: ["DISCOUNT", "FLAT_OFFER"],
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
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
        enum: ["PERCENTAGE", "FIXED"],
        required: function () {
          return this.offerType === "DISCOUNT";
        },
      },
      value: {
        type: Number,
        required: function () {
          return this.offerType === "DISCOUNT";
        },
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
          required: true,
        },
      ],
      minTransactionHistory: {
        type: Number,
        default: 0,
      },
      minPointsBalance: {
        type: Number,
        default: 0,
      },
    },

    // Usage limits
    usagePolicy: {
      frequency: {
        type: String,
        enum: ["DAILY", "WEEKLY", "MONTHLY", "TOTAL"],
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
    conditions: {
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
          enum: ["Khedmah-site", "KhedmahPay-Wallet", "ALL"],
          default: "ALL",
        },
      ],
    },

    // Terms and conditions
    termsAndConditions: [
      {
        type: String,
      },
    ],
    redemptionInstructions: {
      type: String,
      required: true,
    },

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
        transactionId: {
          type: String,
          default: null,
        },
      },
    ],
  },
  { timestamps: true }
);

// Helper method to check if a user can use the offer
kedmahOffersSchema.methods.canUserUseCoupon = async function (customerId) {
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
    case "MONTHLY":
      relevantDate = new Date(now.setDate(1));
      break;
  }

  const usageInPeriod = userUsageHistory.filter(
    (usage) => new Date(usage.usedAt) >= relevantDate
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
kedmahOffersSchema.methods.checkEligibility = async function (
  customer,
  transactionValue,
  paymentMethod
) {
  const now = new Date();

  // Check if offer is active and valid
  if (!this.isActive) {
    return {
      eligible: false,
      reason: "Offer is not active",
    };
  }

  if (
    now < this.validityPeriod.startDate ||
    now > this.validityPeriod.endDate
  ) {
    return {
      eligible: false,
      reason: "Offer is not valid at this time",
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
        reason: "App type not eligible for this offer",
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
      reason: "Payment method not eligible for this offer",
    };
  }

  // Check user type eligibility
  if (
    !this.eligibilityCriteria.userTypes.includes("ALL") &&
    !this.eligibilityCriteria.userTypes.includes(customer.userType)
  ) {
    return {
      eligible: false,
      reason: "User type not eligible for this offer",
    };
  }

  // Check tier eligibility
  if (
    this.eligibilityCriteria.tiers &&
    this.eligibilityCriteria.tiers.length > 0
  ) {
    const customerTierIds = customer.tiers.map((tier) => tier.toString());
    const eligibleTierIds = this.eligibilityCriteria.tiers.map((tier) =>
      tier.toString()
    );

    if (!eligibleTierIds.some((tierId) => customerTierIds.includes(tierId))) {
      return {
        eligible: false,
        reason: "User tier not eligible for this offer",
      };
    }
  }

  // Check points balance
  if (customer.pointsBalance < this.eligibilityCriteria.minPointsBalance) {
    return {
      eligible: false,
      reason: `Minimum points balance of ${this.eligibilityCriteria.minPointsBalance} required`,
    };
  }

  // Check transaction history
  if (
    customer.transactionCount < this.eligibilityCriteria.minTransactionHistory
  ) {
    return {
      eligible: false,
      reason: `Minimum transaction history of ${this.eligibilityCriteria.minTransactionHistory} required`,
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

// Add indexes for faster queries
kedmahOffersSchema.index({
  "validityPeriod.startDate": 1,
  "validityPeriod.endDate": 1,
});
kedmahOffersSchema.index({ offerType: 1, isActive: 1 });
kedmahOffersSchema.index({ serviceCategory: 1 });
kedmahOffersSchema.index({ "eligibilityCriteria.tiers": 1 });
kedmahOffersSchema.index({ isActive: 1, offerType: 1 });

const KedmahOffers = mongoose.model("KedmahOffers", kedmahOffersSchema);

module.exports = KedmahOffers;
