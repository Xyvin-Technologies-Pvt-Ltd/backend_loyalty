const response_handler = require("../../helpers/response_handler");
const CouponCode = require("../../models/merchant_offers.model");
const {
  validateCouponUpdate,
  createPreGeneratedCoupons,
  redeemDynamicCoupon,
} = require("./merchant_offers.validators");
const { v4: uuidv4 } = require("uuid");
const Transaction = require("../../models/transaction_model");
const Customer = require("../../models/customer_model");
const mongoose = require("mongoose");
//!search for coupon by title, description, code, merchantId, couponCategoryId, type, validityPeriod, discountDetails, redeemablePointsCount, eligibilityCriteria, usagePolicy, conditions, termsAndConditions, redemptionInstructions, redemptionUrl, linkData
//!reordering based on priority

// Create a single coupon
exports.createCoupon = async (req, res) => {
  try {
    const { error } = createPreGeneratedCoupons.validate(req.body);
    if (error) {
      return response_handler(res, 400, false, error.details[0].message);
    }

    let {
      title,
      description,
      posterImage,
      merchantId,
      couponCategoryId,
      type,
      code,
      numberOfCodes,
      validityPeriod,
      discountDetails,
      redeemablePointsCount,
      eligibilityCriteria,
      usagePolicy,
      conditions,
      termsAndConditions,
      redemptionInstructions,
      redemptionUrl,
      linkData,
      priority,
    } = req.body;

    // Validate type-specific requirements
    if (type === "PRE_GENERATED" && !code) {
      return response_handler(
        res,
        400,
        false,
        "Code is required for PRE_GENERATED type"
      );
    }

    if (type === "ONE_TIME_LINK" && !redemptionUrl) {
      return response_handler(
        res,
        400,
        false,
        "Redemption URL is required for ONE_TIME_LINK type"
      );
    }

    //if priority already present we shoudl shift the existing coupon to the next priority

    if (!priority) {
      //get the highest priority
      const highestPriority = await CouponCode.findOne({}).sort({
        priority: -1,
      });
      priority = highestPriority.priority ? highestPriority.priority + 1 : 1;
    }

    const couponData = {
      title,
      description,
      posterImage,
      merchantId,
      couponCategoryId,
      type,
      validityPeriod,
      discountDetails,
      redeemablePointsCount,
      eligibilityCriteria,
      usagePolicy,
      conditions,
      termsAndConditions,
      redemptionInstructions,
      redemptionUrl,
      linkData,
      priority,
    };
    if (type === "DYNAMIC") {
      couponData.code = Array.from({ length: numberOfCodes }, () => ({
        pin: uuidv4().substring(0, 4),
        isRedeemed: false,
      }));
    } else if (type === "PRE_GENERATED") {
      couponData.code = [{ pin: code, isRedeemed: false }];
    }
    const coupon = new CouponCode(couponData);
    await coupon.save();
    return response_handler(
      res,
      201,
      true,
      "Coupon created successfully",
      coupon
    );
  } catch (error) {
    console.error("Error creating coupon:", error);
    return response_handler(res, 500, false, "Error creating coupon");
  }
};

// Create bulk coupons with pre-generated codes
exports.createBulkCoupons = async (req, res) => {
  try {
    const { error } = createPreGeneratedCoupons.validate(req.body);
    if (error) {
      return response_handler(res, 400, false, error.details[0].message);
    }

    const {
      title,
      description,
      posterImage,
      merchantId,
      couponCategoryId,
      validityPeriod,
      discountDetails,
      redeemablePointsCount,
      eligibilityCriteria,
      usagePolicy,
      conditions,
      termsAndConditions,
      redemptionInstructions,
      codes, // Array of pre-generated codes
    } = req.body;

    if (!codes || !Array.isArray(codes) || codes.length === 0) {
      return response_handler(
        res,
        400,
        false,
        "Pre-generated codes are required for bulk creation"
      );
    }

    const batchId = uuidv4();
    const coupons = codes.map((code) => ({
      title,
      description,
      posterImage,
      merchantId,
      couponCategoryId,
      type: "PRE_GENERATED",
      code: [{ pin: code, isRedeemed: false }],
      validityPeriod,
      discountDetails,
      redeemablePointsCount,
      eligibilityCriteria,
      usagePolicy,
      conditions,
      termsAndConditions,
      redemptionInstructions,
      batchId,
    }));

    const createdCoupons = await CouponCode.insertMany(coupons);
    return response_handler(
      res,
      201,
      true,
      "Bulk coupons created successfully",
      {
        batchId,
        count: createdCoupons.length,
        coupons: createdCoupons,
      }
    );
  } catch (error) {
    console.error("Error creating bulk coupons:", error);
    return response_handler(res, 500, false, "Error creating bulk coupons");
  }
};

// Create a one-time link coupon
exports.createOneTimeLinkCoupon = async (req, res) => {
  try {
    const { error } = validateCouponCreation(req.body);
    if (error) {
      return response_handler(res, 400, false, error.details[0].message);
    }

    const {
      title,
      description,
      posterImage,
      merchantId,
      couponCategoryId,
      validityPeriod,
      discountDetails,
      redeemablePointsCount,
      eligibilityCriteria,
      usagePolicy,
      conditions,
      termsAndConditions,
      redemptionUrl,
      linkData,
    } = req.body;

    if (!redemptionUrl) {
      return response_handler(
        res,
        400,
        false,
        "Redemption URL is required for one-time link coupons"
      );
    }

    const coupon = new CouponCode({
      title,
      description,
      posterImage,
      merchantId,
      couponCategoryId,
      type: "ONE_TIME_LINK",
      validityPeriod,
      discountDetails,
      redeemablePointsCount,
      eligibilityCriteria,
      usagePolicy,
      conditions,
      termsAndConditions,
      redemptionUrl,
      linkData,
    });

    await coupon.save();
    return response_handler(
      res,
      201,
      true,
      "One-time link coupon created successfully",
      coupon
    );
  } catch (error) {
    console.error("Error creating one-time link coupon:", error);
    return response_handler(
      res,
      500,
      false,
      "Error creating one-time link coupon"
    );
  }
};

// Get coupons by batch ID
exports.getCouponsByBatch = async (req, res) => {
  try {
    const { batchId } = req.params;
    const { page = 1, limit = 10 } = req.query;

    const coupons = await CouponCode.find({ batchId })
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .sort({ createdAt: -1 });

    const total = await CouponCode.countDocuments({ batchId });

    return response_handler(res, 200, true, "Coupons retrieved successfully", {
      coupons,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Error retrieving coupons by batch:", error);
    return response_handler(
      res,
      500,
      false,
      "Error retrieving coupons by batch"
    );
  }
};

exports.getCouponDetails = async (req, res) => {
  try {
    const { couponId } = req.params;
    const coupon = await CouponCode.findById(couponId);
    return response_handler(
      res,
      200,
      "Coupon details retrieved successfully",
      coupon
    );
  } catch (error) {
    console.error("Error retrieving coupon details:", error);
    return response_handler(res, 500, false, "Error retrieving coupon details");
  }
};

exports.getAllCoupons = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      type,
      categoryId,
      brandId,
      search = "",
    } = req.query;

    const filter = {};
    if (type) filter.type = type;
    if (categoryId) filter.couponCategoryId = categoryId;
    if (search && search.trim()) {
      const searchRegex = { $regex: search.trim(), $options: "i" };
      filter.$or = [
        { "title.en": searchRegex },
        { "title.ar": searchRegex },
        { "description.en": searchRegex },
        { "description.ar": searchRegex },
      ];

      // Handle merchant name and category name search
      const merchantFilter = {
        $or: [{ "title.en": searchRegex }, { "title.ar": searchRegex }],
      };
      const categoryFilter = {
        $or: [{ "title.en": searchRegex }, { "title.ar": searchRegex }],
      };

      // Find matching merchants and categories
      const merchantPromise = mongoose
        .model("CouponBrand")
        .find(merchantFilter)
        .select("_id");
      const categoryPromise = mongoose
        .model("CouponCategory")
        .find(categoryFilter)
        .select("_id");

      // Wait for both queries to complete
      const [matchingMerchants, matchingCategories] = await Promise.all([
        merchantPromise,
        categoryPromise,
      ]);

      // If we found matching merchants or categories, add them to the filter
      if (matchingMerchants.length > 0) {
        const merchantIds = matchingMerchants.map((m) => m._id);
        if (!filter.$or) filter.$or = [];
        filter.$or.push({ merchantId: { $in: merchantIds } });
      }

      if (matchingCategories.length > 0) {
        const categoryIds = matchingCategories.map((c) => c._id);
        if (!filter.$or) filter.$or = [];
        filter.$or.push({ couponCategoryId: { $in: categoryIds } });
      }
    }

    if (brandId) filter.merchantId = brandId;

    const total = await CouponCode.countDocuments(filter);

    // Get coupons with pagination and populate related fields
    const coupons = await CouponCode.find(filter)
      .populate("merchantId")
      .populate("couponCategoryId")
      .sort({ priority: 1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    return response_handler(
      res,
      200,
      "All coupons retrieved successfully",
      coupons,
      total
    );
  } catch (error) {
    console.error("Error retrieving all coupons:", error);
    return response_handler(res, 500, false, "Error retrieving all coupons");
  }
};

exports.updateCoupon = async (req, res) => {
  try {
    const { couponId } = req.params;
    const { error } = createPreGeneratedCoupons.validate(req.body);
    if (error) {
      return response_handler(res, 400, false, error.details[0].message);
    }

    const {
      title,
      description,
      posterImage,
      merchantId,
      couponCategoryId,
      validityPeriod,
      discountDetails,
      redeemablePointsCount,
      eligibilityCriteria,
      usagePolicy,
      conditions,
      termsAndConditions,
      redemptionInstructions,
      redemptionUrl,
      linkData,
      priority,
      code, // Add code field for PRE_GENERATED coupons
    } = req.body;

    // Get the existing coupon to check type and handle priority
    const existingCoupon = await CouponCode.findById(couponId);
    if (!existingCoupon) {
      return response_handler(res, 404, false, "Coupon not found");
    }

    // Handle priority changes
    if (priority !== undefined && existingCoupon.priority !== priority) {
      const oldPriority = existingCoupon.priority;
      const newPriority = priority;

      if (newPriority < oldPriority) {
        // Moving UP
        console.log("Moving UP");
        await CouponCode.updateMany(
          { priority: { $gte: newPriority, $lt: oldPriority } },
          { $inc: { priority: 1 } }
        );
      } else if (newPriority > oldPriority) {
        // Moving DOWN
        console.log("Moving DOWN");
        await CouponCode.updateMany(
          { priority: { $gt: oldPriority, $lte: newPriority } },
          { $inc: { priority: -1 } }
        );
      }
    }

    // Prepare update object
    const updateData = {
      title,
      description,
      posterImage,
      merchantId,
      couponCategoryId,
      validityPeriod,
      discountDetails,
      redeemablePointsCount,
      eligibilityCriteria,
      usagePolicy,
      conditions,
      termsAndConditions,
      redemptionInstructions,
      redemptionUrl,
      linkData,
      priority,
    };

    // Handle code updates for PRE_GENERATED coupons
    if (existingCoupon.type === "PRE_GENERATED" && code) {
      // If code is provided, we need to handle it carefully
      if (Array.isArray(code)) {
        // If it's an array of new codes, we need to preserve existing redemption status
        const existingCodes = existingCoupon.code || [];
        const existingCodeMap = new Map();

        // Create a map of existing codes and their redemption status
        existingCodes.forEach((existingCode) => {
          existingCodeMap.set(existingCode.pin, existingCode.isRedeemed);
        });

        // Process new codes and preserve redemption status where possible
        const processedCodes = code.map((newCode) => {
          if (typeof newCode === "string") {
            // If it's just a string (pin), check if it exists and preserve redemption status
            return {
              pin: newCode,
              isRedeemed: existingCodeMap.get(newCode) || false,
            };
          } else if (typeof newCode === "object" && newCode.pin) {
            // If it's an object with pin, preserve redemption status if it exists
            return {
              pin: newCode.pin,
              isRedeemed:
                existingCodeMap.get(newCode.pin) || newCode.isRedeemed || false,
            };
          }
          return newCode;
        });

        updateData.code = processedCodes;
      } else if (typeof code === "string") {
        // If it's a single string code, check if it exists and preserve redemption status
        const existingCodes = existingCoupon.code || [];
        const existingCode = existingCodes.find((c) => c.pin === code);

        updateData.code = [
          {
            pin: code,
            isRedeemed: existingCode ? existingCode.isRedeemed : false,
          },
        ];
      }
    }

    const updatedCoupon = await CouponCode.findByIdAndUpdate(
      couponId,
      { $set: updateData },
      { new: true }
    );

    return response_handler(
      res,
      200,
      true,
      "Coupon updated successfully",
      updatedCoupon
    );
  } catch (error) {
    console.error("Error updating coupon:", error);
    return response_handler(res, 500, false, "Error updating coupon");
  }
};

exports.deleteCoupon = async (req, res) => {
  try {
    const { couponId } = req.params;
    await CouponCode.findByIdAndDelete(couponId);
    return response_handler(res, 200, true, "Coupon deleted successfully");
  } catch (error) {
    console.error("Error deleting coupon:", error);
    return response_handler(res, 500, false, "Error deleting coupon");
  }
};

// Redeem a dynamic coupon by checking pin and updating redemption status
// Initialize sequential priorities for all existing coupons
exports.initializeCouponPriorities = async (req, res) => {
  try {
    // Get all coupons sorted by creation date (oldest first)
    const coupons = await CouponCode.find().sort({ createdAt: 1 });

    // Update each coupon with a sequential priority
    for (let i = 0; i < coupons.length; i++) {
      await CouponCode.findByIdAndUpdate(coupons[i]._id, {
        $set: { priority: i + 1 }, // Start from 1
      });
    }

    return response_handler(
      res,
      200,
      true,
      `Successfully initialized priorities for ${coupons.length} coupons`,
      { totalCoupons: coupons.length }
    );
  } catch (error) {
    console.error("Error initializing coupon priorities:", error);
    return response_handler(
      res,
      500,
      false,
      "Error initializing coupon priorities"
    );
  }
};

exports.redeemPreGeneratedCoupon = async (req, res) => {
  try {
    // Validate request body
    const { error } = redeemDynamicCoupon.validate(req.body);
    if (error) {
      return response_handler(res, 400, false, error.details[0].message);
    }

    const { couponId, pin, customer_id } = req.body;

    // Find the coupon by ID
    const coupon = await CouponCode.findById(couponId);
    if (!coupon) {
      return response_handler(res, 404, false, "Coupon not found");
    }

    // Check if coupon is expired
    const currentDate = new Date();
    if (
      currentDate < new Date(coupon.validityPeriod.startDate) ||
      currentDate > new Date(coupon.validityPeriod.endDate)
    ) {
      return response_handler(
        res,
        400,
        false,
        "Coupon has expired or is not yet valid"
      );
    }

    // Find the specific pin in the code array
    const pinIndex = coupon.code.findIndex((code) => code.pin === pin);
    if (pinIndex === -1) {
      return response_handler(res, 404, false, "Invalid coupon pin");
    }

    // Update the redemption status
    coupon.code[pinIndex].isRedeemed = true;

    // Add user ID to the redeemed pin if needed
    coupon.code[pinIndex].redeemedBy = customer_id;
    coupon.code[pinIndex].redeemedAt = new Date();

    //usuageHistory

    // Save the updated coupon
    await coupon.save();
    //get customer
    const customer = await Customer.findOne({ customer_id });
    if (!customer) {
      return response_handler(res, 404, false, "Customer not found");
    }
    //transaction
    //CREATE TRANSACTION ID WITH UNIQUE CODE
    let transactionId = Math.random()
      .toString(36)
      .substring(2, 10)
      .toUpperCase();

    const transaction = new Transaction({
      customer_id: customer._id,
      coupon_id: coupon._id,
      transaction_type: "offer-redeem",
      points: coupon.redeemablePointsCount,
      status: "completed",
      transaction_id: transactionId,
      metadata: {
        coupon_id: coupon._id,
        coupon_title: coupon.title,
        coupon_discount: coupon.discountDetails,
      },
    });
    await transaction.save();

    //add to usageHistory

    coupon.usageHistory.push({
      customerId: customer._id,
      usedAt: new Date(),
      pin: coupon.code[pinIndex].pin,
      transactionId: transactionId,
    });
    await coupon.save();

    return response_handler(res, 200, true, "Coupon redeemed successfully", {
      couponId: coupon._id,
      title: coupon.title,
      transactionId: transactionId,
      discountDetails: coupon.discountDetails,
    });
  } catch (error) {
    console.error("Error redeeming coupon:", error);
    return response_handler(res, 500, false, "Error redeeming coupon");
  }
};
