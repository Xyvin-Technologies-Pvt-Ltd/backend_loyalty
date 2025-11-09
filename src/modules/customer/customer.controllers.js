const Customer = require("../../models/customer_model");
const Transaction = require("../../models/transaction_model");
const LoyaltyPoints = require("../../models/loyalty_points_model");
const Tier = require("../../models/tier_model");
const { logger } = require("../../middlewares/logger");
const response_handler = require("../../helpers/response_handler");
const mongoose = require("mongoose");
const XLSX = require("xlsx");
/**
 * Create a new customer
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const createCustomer = async (req, res) => {
  try {
    const { name, email, phone, app_type, device_token, device_type } =
      req.body;

    // Check if customer with email or phone already exists
    const existingCustomer = await Customer.findOne({
      $or: [{ email: email }, { phone: phone }],
    });

    if (existingCustomer) {
      return response_handler(
        res,
        400,
        "Customer with this email or phone already exists"
      );
    }

    // Generate a unique customer ID
    const customerCount = await Customer.countDocuments();
    const customer_id = `CUST${(customerCount + 1)
      .toString()
      .padStart(6, "0")}`;

    // Generate a unique referral code
    const referral_code = generateReferralCode(name);

    //find basic tier based on least point required
    const basicTier = await Tier.findOne({ points_required: { $gt: 0 } }).sort({
      points_required: 1,
    });

    // Create the customer
    const customer = new Customer({
      customer_id,
      name,
      email,
      phone,
      app_type,
      referral_code,
      tier: basicTier._id,
      device_token,
      device_type,
    });

    await customer.save();

    return response_handler(
      res,
      201,
      "Customer created successfully",
      customer
    );
  } catch (error) {
    logger.error(`Error creating customer: ${error.message}`);
    return response_handler(
      res,
      500,
      "Failed to create customer",
      error.message
    );
  }
};

/**
 * Get all customers with pagination and filtering
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getAllCustomers = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      name,
      email,
      phone,
      app_type,
      status,
      sort_by = "createdAt",
      sort_order = "desc",
    } = req.query;

    // Build filter object

    let filter = {};

    if (name && name.trim() !== "") {
      filter.$or = [
        { name: { $regex: name, $options: "i" } },
        { customer_id: { $regex: name, $options: "i" } },
        { email: { $regex: name, $options: "i" } },
        { phone: { $regex: name, $options: "i" } },
      ];
    }
    if (app_type) filter.app_type = app_type;
    if (status !== undefined) filter.status = status === "true";

    // Build sort object
    const sort = {};
    sort[sort_by] = sort_order === "asc" ? 1 : -1;

    // Execute query with pagination

    const customers = await Customer.aggregate([
      { $match: filter },

      { $skip: (page - 1) * parseInt(limit) },
      { $limit: parseInt(limit) },
      {
        $lookup: {
          from: "tiers",
          localField: "tier",
          foreignField: "_id",
          as: "tier",
        },
      },
      {
        $lookup: {
          from: "apptypes",
          localField: "app_type",
          foreignField: "_id",
          as: "app_type",
        },
      },
      {
        $project: {
          customer_id: 1,
          name: 1,
          email: 1,
          phone: 1,
          total_points: 1, // 👈 include points field
          tier: { $arrayElemAt: ["$tier", 0] }, // flatten array
          app_type: { $arrayElemAt: ["$app_type", 0] }, // flatten array
        },
      },
    ]);
    // Get total count for pagination
    const totalCustomers = await Customer.countDocuments(filter);

    return response_handler(res, 200, "Customers retrieved successfully", {
      customers,
      pagination: {
        total: totalCustomers,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(totalCustomers / parseInt(limit)),
      },
    });
  } catch (error) {
    logger.error(`Error retrieving customers: ${error.message}`);
    return response_handler(
      res,
      500,
      "Failed to retrieve customers",
      error.message
    );
  }
};

/**
 * Get a customer by ID
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getCustomerById = async (req, res) => {
  try {
    const { id } = req.params;

    const customer = await Customer.findById(id)
      .populate("tier", "name description points_required")
      .populate("app_type", "name description")
      .populate("referred_by", "name email");

    if (!customer) {
      return response_handler(res, 404, "Customer not found");
    }

    return response_handler(
      res,
      200,
      "Customer retrieved successfully",
      customer
    );
  } catch (error) {
    logger.error(`Error retrieving customer: ${error.message}`);
    return response_handler(
      res,
      500,
      "Failed to retrieve customer",
      error.message
    );
  }
};

/**
 * Update a customer
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const updateCustomer = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, phone, app_type, status, tier } = req.body;

    // Check if customer exists
    const customer = await Customer.findById(id);

    if (!customer) {
      return response_handler(res, 404, "Customer not found");
    }

    // Check if email or phone is already used by another customer
    if (email && email !== customer.email) {
      const existingCustomer = await Customer.findOne({
        email,
        _id: { $ne: id },
      });
      if (existingCustomer) {
        return response_handler(
          res,
          400,
          "Email is already in use by another customer"
        );
      }
    }

    if (phone && phone !== customer.phone) {
      const existingCustomer = await Customer.findOne({
        phone,
        _id: { $ne: id },
      });
      if (existingCustomer) {
        return response_handler(
          res,
          400,
          "Phone number is already in use by another customer"
        );
      }
    }

    // Update customer
    const updatedCustomer = await Customer.findByIdAndUpdate(
      id,
      { name, email, phone, app_type, status, tier },
      { new: true, runValidators: true }
    )
      .populate("tier", "name description points_required")
      .populate("app_type", "name description");

    return response_handler(
      res,
      200,
      "Customer updated successfully",
      updatedCustomer
    );
  } catch (error) {
    logger.error(`Error updating customer: ${error.message}`);
    return response_handler(
      res,
      500,
      "Failed to update customer",
      error.message
    );
  }
};

/**
 * Delete a customer
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const deleteCustomer = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if customer exists
    const customer = await Customer.findById(id);

    if (!customer) {
      return response_handler(res, 404, "Customer not found");
    }

    // Instead of deleting, set status to false (soft delete)
    customer.status = false;
    await customer.save();

    return response_handler(res, 200, "Customer deactivated successfully");
  } catch (error) {
    logger.error(`Error deactivating customer: ${error.message}`);
    return response_handler(
      res,
      500,
      "Failed to deactivate customer",
      error.message
    );
  }
};

/**
 * Get customer dashboard with summary information
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getCustomerDashboard = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if customer exists
    const customer = await Customer.findById(id)
      .populate("tier", "name description points_required")
      .populate("app_type", "name description");

    if (!customer) {
      return response_handler(res, 404, "Customer not found");
    }

    // Get point balance
    const pointsEarned = await Transaction.aggregate([
      {
        $match: {
          customer_id: mongoose.Types.ObjectId(id),
          points: { $gt: 0 },
          status: "completed",
        },
      },
      { $group: { _id: null, total: { $sum: "$points" } } },
    ]);

    const pointsSpent = await Transaction.aggregate([
      {
        $match: {
          customer_id: mongoose.Types.ObjectId(id),
          points: { $lt: 0 },
          transaction_type: "redeem",
          status: "completed",
        },
      },
      { $group: { _id: null, total: { $sum: "$points" } } },
    ]);

    const pointsExpired = await Transaction.aggregate([
      {
        $match: {
          customer_id: mongoose.Types.ObjectId(id),
          points: { $lt: 0 },
          transaction_type: "expire",
          status: "completed",
        },
      },
      { $group: { _id: null, total: { $sum: "$points" } } },
    ]);

    const totalEarned = pointsEarned.length > 0 ? pointsEarned[0].total : 0;
    const totalSpent =
      pointsSpent.length > 0 ? Math.abs(pointsSpent[0].total) : 0;
    const totalExpired =
      pointsExpired.length > 0 ? Math.abs(pointsExpired[0].total) : 0;
    const currentBalance = totalEarned - totalSpent - totalExpired;

    // Get upcoming expirations
    const currentDate = new Date();
    const expiringPoints = await LoyaltyPoints.aggregate([
      {
        $match: {
          customer_id: mongoose.Types.ObjectId(id),
          expiryDate: {
            $gt: currentDate,
            $lt: new Date(currentDate.getTime() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
          },
        },
      },
      { $group: { _id: null, total: { $sum: "$points" } } },
    ]);

    const pointsExpiringIn30Days =
      expiringPoints.length > 0 ? expiringPoints[0].total : 0;

    // Get recent transactions
    const recentTransactions = await Transaction.find({ customer_id: id })
      .sort({ transaction_date: -1 })
      .limit(5)
      .populate("trigger_event", "name")
      .populate("app_type", "name");

    // Get tier progress
    let tierProgress = 0;
    if (customer.tier) {
      const nextTier = await Tier.findOne({
        points_required: { $gt: customer.tier.points_required },
        app_type: { $in: customer.app_type },
      }).sort({ points_required: 1 });

      if (nextTier) {
        const pointsForNextTier =
          nextTier.points_required - customer.tier.points_required;
        const pointsEarned = currentBalance - customer.tier.points_required;
        tierProgress = Math.min(
          100,
          Math.max(0, (pointsEarned / pointsForNextTier) * 100)
        );
      } else {
        tierProgress = 100; // Already at highest tier
      }
    }

    // Get referral stats
    const referralCount = customer.user_referer_count || 0;

    return response_handler(
      res,
      200,
      "Customer dashboard retrieved successfully",
      {
        customer: {
          _id: customer._id,
          customer_id: customer.customer_id,
          name: customer.name,
          email: customer.email,
          phone: customer.phone,
          tier: customer.tier,
          referral_code: customer.referral_code,
          status: customer.status,
        },
        points_summary: {
          total_earned: totalEarned,
          total_spent: totalSpent,
          total_expired: totalExpired,
          current_balance: currentBalance,
          expiring_in_30_days: pointsExpiringIn30Days,
        },
        tier_progress: {
          current_tier: customer.tier ? customer.tier.name : "No Tier",
          progress_percentage: tierProgress,
        },
        referrals: {
          referral_code: customer.referral_code,
          total_referrals: referralCount,
        },
        recent_transactions: recentTransactions,
      }
    );
  } catch (error) {
    logger.error(`Error retrieving customer dashboard: ${error.message}`);
    return response_handler(
      res,
      500,
      "Failed to retrieve customer dashboard",
      error.message
    );
  }
};

/**
 * Generate a unique referral code based on customer name
 * @param {String} name - Customer name
 * @returns {String} - Unique referral code
 */
const generateReferralCode = (name) => {
  const namePrefix = name.substring(0, 3).toUpperCase();
  const randomString = Math.random().toString(36).substring(2, 7).toUpperCase();
  return `${namePrefix}${randomString}`;
};

const importCustomersFromExcel = async (req, res) => {
  try {
    const filePath = "./src/modules/customer/tier-up.xlsx";
    const batchSize = parseInt(req.query.batchSize) || 50; // Default batch size of 50

    // 1. Read Excel file
    console.log(`📂 Reading Excel file from ${filePath}`);
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const sheetData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

    let successCount = 0;
    let errorCount = 0;
    const errors = [];
    const totalRows = sheetData.length;

    console.log(`📊 Processing ${totalRows} rows in batches of ${batchSize}`);

    // 2. Process in batches
    for (let i = 0; i < sheetData.length; i += batchSize) {
      const batch = sheetData.slice(i, i + batchSize);
      const batchNumber = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(sheetData.length / batchSize);

      console.log(
        `🔄 Processing batch ${batchNumber}/${totalBatches} (${batch.length} records)`
      );

      // Process each batch
      const batchPromises = batch.map(async (row, index) => {
        const rowNumber = i + index + 1;
        const customerId = row.CustomerID?.trim();
        const tierName = row.Tier?.trim();

        if (!customerId || !tierName) {
          return {
            success: false,
            error: `Row ${rowNumber}: Missing CustomerID or Tier`,
            customerId: customerId || "N/A",
          };
        }

        try {
          // Find tier by name
          const tier = await Tier.findOne({ "name.en": tierName });
          if (!tier) {
            return {
              success: false,
              error: `Customer ${customerId}: Tier '${tierName}' not found`,
              customerId,
            };
          }

          // Upsert (create/update) customer
          await Customer.findOneAndUpdate(
            { customer_id: customerId },
            { customer_id: customerId, tier: tier._id },
            { upsert: true, new: true }
          );

          return {
            success: true,
            customerId,
          };
        } catch (error) {
          return {
            success: false,
            error: `Customer ${customerId}: ${error.message}`,
            customerId,
          };
        }
      });

      // Wait for batch to complete
      const batchResults = await Promise.all(batchPromises);

      // Process batch results
      batchResults.forEach((result) => {
        if (result.success) {
          successCount++;
          console.log(`✅ Customer ${result.customerId} imported successfully`);
        } else {
          errorCount++;
          errors.push(result.error);
          console.error(`❌ ${result.error}`);
        }
      });

      // Add a small delay between batches to prevent overwhelming the database
      if (i + batchSize < sheetData.length) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    console.log(
      `✅ Import completed: ${successCount} successful, ${errorCount} errors`
    );

    return response_handler(res, 200, "Import completed successfully", {
      totalProcessed: totalRows,
      successCount,
      errorCount,
      batchSize,
      totalBatches: Math.ceil(totalRows / batchSize),
      errors: errors.slice(0, 10), // Return first 10 errors
    });
  } catch (error) {
    console.error("❌ Error importing customers:", error);
    return response_handler(res, 500, "Error importing customers", {
      error: error.message,
    });
  }
};

module.exports = {
  createCustomer,
  getAllCustomers,
  getCustomerById,
  updateCustomer,
  deleteCustomer,
  getCustomerDashboard,
  importCustomersFromExcel,
};
