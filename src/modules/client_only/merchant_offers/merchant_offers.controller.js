const CouponCode = require("../../../models/merchant_offers.model");
const response_handler = require("../../../helpers/response_handler");
const { logger } = require("../../../middlewares/logger");
const { resolveOmanDateRange } = require("../../../utils/date");

exports.getAvailableOffers = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      merchant_id,
      category_id,
      start_date,
      end_date,
    } = req.query;

    // Build query for active and valid offers
    const query = {
      status: "UNUSED",
      // TODO  end validity period
      // validityPeriod: {
      //     startDate: { $lte: new Date() },
      //     endDate: { $gte: new Date() }
      // }
    };

    // Add filters if provided
    if (merchant_id) {
      query.merchantId = merchant_id;
    }
    if (category_id) {
      query.couponCategoryId = category_id;
    }
    if (start_date || end_date) {
      const { startDate: gte, endDate: lte } = resolveOmanDateRange(
        start_date,
        end_date,
        { fallback: "none" }
      );
      query.validityPeriod = {};
      if (gte) query.validityPeriod.startDate = { $gte: gte };
      if (lte) query.validityPeriod.endDate = { $lte: lte };
    }

    // Calculate pagination
    const skip = (page - 1) * limit;

    // Get offers with pagination and populate merchant details
    const offers = await CouponCode.find(query)
      .populate("merchantId", "name logo")
      .populate("couponCategoryId", "name")
      .sort({ "validityPeriod.endDate": 1 })
      .skip(skip)
      .limit(parseInt(limit));

    // Get total count for pagination
    const total = await CouponCode.countDocuments(query);

    // Check eligibility for each offer
    // const offersWithEligibility = await Promise.all(offers.map(async (offer) => {
    //     console.log(req.user,req.customerId);
    //     const eligibilityCheck = await offer.checkEligibility(req.user);
    //     return {
    //         ...offer.toObject(),
    //         eligibility: eligibilityCheck
    //     };
    // }));

    return response_handler(
      res,
      200,
      "Available offers retrieved successfully",
      {
        offers: offers,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          total_pages: Math.ceil(total / limit),
        },
      }
    );
  } catch (error) {
    logger.error(`Error fetching available offers: ${error.message}`);
    return response_handler(res, 500, error.message, null);
  }
};

exports.getOfferDetails = async (req, res) => {
  try {
    const { offer_id } = req.params;
    const { transaction_value, payment_method } = req.query;

    const offer = await CouponCode.findById(offer_id)
      .populate("merchantId", "name logo")
      .populate("couponCategoryId", "name");

    if (!offer) {
      return response_handler(res, 404, "Offer not found", null);
    }

    // Check eligibility if transaction details are provided
    let eligibility = null;
    if (transaction_value && payment_method) {
      eligibility = await offer.checkEligibility(
        req.user,
        transaction_value,
        payment_method
      );
    }

    return response_handler(res, 200, "Offer details retrieved successfully", {
      ...offer.toObject(),
      eligibility,
    });
  } catch (error) {
    logger.error(`Error fetching offer details: ${error.message}`);
    return response_handler(res, 500, error.message, null);
  }
};

exports.checkOfferEligibility = async (req, res) => {
  try {
    const { offer_id } = req.params;
    const { transaction_value, payment_method } = req.body;

    if (!transaction_value || !payment_method) {
      return response_handler(
        res,
        400,
        "Transaction value and payment method are required",
        null
      );
    }

    const offer = await CouponCode.findById(offer_id)
      .populate("merchantId", "name logo")
      .populate("couponCategoryId", "name");

    if (!offer) {
      return response_handler(res, 404, "Offer not found", null);
    }

    const eligibility = await offer.checkEligibility(
      req.user,
      transaction_value,
      payment_method
    );

    return response_handler(
      res,
      200,
      "Offer eligibility checked successfully",
      {
        offer_id,
        eligibility,
      }
    );
  } catch (error) {
    logger.error(`Error checking offer eligibility: ${error.message}`);
    return response_handler(res, 500, error.message, null);
  }
};

exports.getMyClaimedOffers = async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;

    // Build query for user's claimed offers
    const query = {
      customerId: req.user._id,
    };

    if (status) {
      query.status = status;
    }

    // Calculate pagination
    const skip = (page - 1) * limit;

    // Get claimed offers with pagination
    const offers = await CouponCode.find(query)
      .populate("merchantId", "name logo")
      .populate("couponCategoryId", "name")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    // Get total count for pagination
    const total = await CouponCode.countDocuments(query);

    return response_handler(res, 200, "Claimed offers retrieved successfully", {
      offers,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        total_pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    logger.error(`Error fetching claimed offers: ${error.message}`);
    return response_handler(res, 500, error.message, null);
  }
};

exports.redeemDynamicCoupon = async (req, res) => {
  try {
    const { couponId, pin } = req.body;
    const userId = req.user._id;

    if (!couponId || !pin) {
      return response_handler(
        res,
        400,
        false,
        "Coupon ID and PIN are required"
      );
    }

    // Find the coupon by ID
    const coupon = await CouponCode.findById(couponId);
    if (!coupon) {
      return response_handler(res, 404, false, "Coupon not found");
    }

    // Check if coupon is of type DYNAMIC
    if (coupon.type !== "DYNAMIC") {
      return response_handler(res, 400, false, "This is not a dynamic coupon");
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

    // Check if pin is already redeemed
    if (coupon.code[pinIndex].isRedeemed) {
      return response_handler(
        res,
        400,
        false,
        "Coupon has already been redeemed"
      );
    }

    // Update the redemption status
    coupon.code[pinIndex].isRedeemed = true;

    // Add user ID to the redeemed pin
    coupon.code[pinIndex].redeemedBy = userId;
    coupon.code[pinIndex].redeemedAt = new Date();

    // Save the updated coupon
    await coupon.save();

    return response_handler(res, 200, true, "Coupon redeemed successfully", {
      couponId: coupon._id,
      title: coupon.title,
      discountDetails: coupon.discountDetails,
    });
  } catch (error) {
    logger.error(`Error redeeming coupon: ${error.message}`);
    return response_handler(res, 500, false, "Error redeeming coupon");
  }
};
