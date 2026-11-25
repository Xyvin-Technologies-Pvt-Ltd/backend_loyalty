const Customer = require("../../models/customer_model");
const Admin = require("../../models/admin_model");
const KedmahOffer = require("../../models/kedmah_offers_model");
const MerchantOffer = require("../../models/merchant_offers.model");
const CouponBrand = require("../../models/coupon_brand_model");
const Transaction = require("../../models/transaction_model");
const { logger } = require("../../middlewares/logger");
const response_handler = require("../../helpers/response_handler");
const { OMAN_TIMEZONE } = require("../../utils/date");

/**
 * Get dashboard statistics
 */
const getDashboardStats = async (req, res) => {
  try {
    // Get total customers
    const totalCustomers = await Customer.countDocuments();
    const activeCustomers = await Customer.countDocuments({ status: true });

    // Get total admins
    const totalAdmins = await Admin.countDocuments();
    const activeAdmins = await Admin.countDocuments({ status: true });

    // Get total offers
    const kedmahOffers = await KedmahOffer.countDocuments();
    const merchantOffers = await MerchantOffer.countDocuments();
    const totalActiveOffers = kedmahOffers + merchantOffers;

    // Get total brands
    const totalBrands = await CouponBrand.countDocuments();

    // Get points statistics
    const pointsStats = await Transaction.aggregate([
      {
        $match: {
          status: "completed",
        },
      },
      {
        $group: {
          _id: "$transaction_type",
          total: { $sum: "$points" },
        },
      },
    ]);

    let totalPointsIssued = 0;
    let totalPointsRedeemed = 0;
    let totalPointsExpired = 0;

    pointsStats.forEach((stat) => {
      switch (stat._id) {
        case "earn":
          totalPointsIssued = stat.total;
          break;
        case "redeem":
          totalPointsRedeemed = Math.abs(stat.total);
          break;
        case "expire":
          totalPointsExpired = Math.abs(stat.total);
          break;
      }
    });

    // Get recent transactions
    const recentTransactions = await Transaction.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .populate("customer_id", "name customer_id")
      .select("transaction_type points status transaction_date");

    // Get recent customers
    const recentCustomers = await Customer.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .populate("tier", "name")
      .select("name customer_id tier total_points status");

    // Get customer growth (last 6 months)
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const customerGrowth = await Customer.aggregate([
      {
        $match: {
          createdAt: { $gte: sixMonthsAgo },
        },
      },
      {
        $group: {
          _id: {
            // Grouped in Oman time — without this, month buckets shift for
            // signups near a UTC month boundary that isn't an Oman one.
            year: { $year: { date: "$createdAt", timezone: OMAN_TIMEZONE } },
            month: { $month: { date: "$createdAt", timezone: OMAN_TIMEZONE } },
          },
          count: { $sum: 1 },
        },
      },
      {
        $sort: {
          "_id.year": 1,
          "_id.month": 1,
        },
      },
    ]);

    // Get points activity (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const pointsActivity = await Transaction.aggregate([
      {
        $match: {
          transaction_date: { $gte: sevenDaysAgo },
          status: "completed",
        },
      },
      {
        $group: {
          _id: {
            // Grouped in Oman time so the 02:00-Oman expiry batch (and any
            // other activity near midnight UTC) lands on the correct Oman day.
            date: {
              $dateToString: {
                format: "%Y-%m-%d",
                date: "$transaction_date",
                timezone: OMAN_TIMEZONE,
              },
            },
            type: "$transaction_type",
          },
          total: { $sum: "$points" },
        },
      },
      {
        $sort: {
          "_id.date": 1,
        },
      },
    ]);

    // Format the response
    const stats = {
      overview: {
        total_customers: totalCustomers,
        active_customers: activeCustomers,
        total_admins: totalAdmins,
        active_admins: activeAdmins,
        total_active_offers: totalActiveOffers,
        total_brands: totalBrands,
      },
      points: {
        total_issued: totalPointsIssued,
        total_redeemed: totalPointsRedeemed,
        total_expired: totalPointsExpired,
        current_active:
          totalPointsIssued - totalPointsRedeemed - totalPointsExpired,
      },
      recent: {
        transactions: recentTransactions,
        customers: recentCustomers,
      },
      trends: {
        customer_growth: customerGrowth,
        points_activity: pointsActivity,
      },
    };


    return response_handler(
      res,
      200,
      "Dashboard statistics retrieved successfully",
      stats
    );
  } catch (error) {
    logger.error(`Error retrieving dashboard statistics: ${error.message}`);
    return response_handler(
      res,
      500,
      "Failed to retrieve dashboard statistics",
      error.message
    );
  }
};

module.exports = {
  getDashboardStats,
};
