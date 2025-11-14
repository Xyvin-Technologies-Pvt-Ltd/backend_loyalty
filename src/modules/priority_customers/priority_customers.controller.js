const mongoose = require("mongoose");
const PriorityCustomer = require("../../models/priority_customer_model");
const Tier = require("../../models/tier_model");
const Customer = require("../../models/customer_model");
const { logger } = require("../../middlewares/logger");
const response_handler = require("../../helpers/response_handler");
const validator = require("./priority_customers.validator");

const validateRequest = (schema, payload) =>
  schema.validate(payload, { abortEarly: false });

const formatValidationError = (error) =>
  error.details.map((detail) => detail.message).join(", ");

const ensureObjectId = (id, label) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new Error(`${label} is invalid`);
  }
};

const ensureTierExists = async (tierId) => {
  const tier = await Tier.findById(tierId);
  if (!tier) {
    throw new Error("Specified tier does not exist");
  }
  return tier;
};

const ensureCustomerExists = async (customerId) => {
  const customer = await Customer.findById(customerId).populate("tier");
  if (!customer) {
    throw new Error("Specified customer does not exist");
  }
  return customer;
};


const buildListPipeline = ({ search, tier_id, is_active }) => {
  const matchStage = {};

  if (typeof is_active === "boolean") {
    matchStage.is_active = is_active;
  }

  if (tier_id) {
    matchStage.tier_id = new mongoose.Types.ObjectId(tier_id);
  }

  const pipeline = [{ $match: matchStage }];

  pipeline.push(
    {
      $lookup: {
        from: "customers",
        localField: "customer_id",
        foreignField: "_id",
        as: "customer",
      },
    },
    {
      $lookup: {
        from: "tiers",
        localField: "tier_id",
        foreignField: "_id",
        as: "tier",
      },
    },
    {
      $lookup: {
        from: "admins",
        localField: "added_by",
        foreignField: "_id",
        as: "added_by",
      },
    },
    {
      $unwind: {
        path: "$customer",
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: "$tier",
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: "$added_by",
        preserveNullAndEmptyArrays: true,
      },
    }
  );

  if (search) {
    const regex = new RegExp(search, "i");
    pipeline.push({
      $match: {
        $or: [
          { "customer.name": regex },
          { "customer.customer_id": regex },
          { "customer.email": regex },
          { "customer.phone": regex },
        ],
      },
    });
  }

  pipeline.push({
    $sort: { createdAt: -1 },
  });

  return pipeline;
};

const projectListResults = [
  {
    $project: {
      customer: {
        _id: 1,
        customer_id: 1,
        name: 1,
        email: 1,
        phone: 1,
        tier: 1,
        total_points: 1,
      },
      tier: {
        _id: 1,
        name: 1,
        hierarchy_level: 1,
        points_required: 1,
      },
      added_by: {
        _id: 1,
        name: 1,
        email: 1,
      },
      reason: 1,
      is_active: 1,
      createdAt: 1,
      updatedAt: 1,
    },
  },
];

const createPriorityCustomer = async (req, res) => {
  try {
    const { error, value } = validateRequest(
      validator.createPriorityCustomer,
      req.body
    );

    if (error) {
      return response_handler(
        res,
        400,
        `Invalid input: ${formatValidationError(error)}`
      );
    }

    const { customer_id, tier_id, reason } = value;

    ensureObjectId(customer_id, "Customer id");
    ensureObjectId(tier_id, "Tier id");

    const [customer, tier] = await Promise.all([
      ensureCustomerExists(customer_id),
      ensureTierExists(tier_id),
    ]);

    const existing = await PriorityCustomer.findOne({
      customer_id,
    });

    if (existing && existing.is_active) {
      return response_handler(
        res,
        409,
        "Customer is already marked as priority",
        existing
      );
    }

    let priorityCustomer;

    if (existing && !existing.is_active) {
      existing.tier_id = tier_id;
      existing.reason = reason || "";
      existing.is_active = true;
      existing.added_by = req.admin ? req.admin._id : null;
      priorityCustomer = await existing.save();
    } else {
      priorityCustomer = await PriorityCustomer.create({
        customer_id,
        tier_id,
        reason,
        added_by: req.admin ? req.admin._id : null,
      });
    }

    const populated = await PriorityCustomer.findById(priorityCustomer._id)
      .populate({
        path: "customer_id",
        populate: { path: "tier" },
      })
      .populate("tier_id")
      .populate("added_by");

    req.priorityCustomerCustomerId =
      populated?.customer_id?._id?.toString?.() || customer_id;

    return response_handler(
      res,
      201,
      "Priority customer created successfully",
      populated
    );
  } catch (err) {
    logger.error(`Error creating priority customer: ${err.message}`);
    return response_handler(
      res,
      500,
      "Failed to create priority customer",
      err.message
    );
  }
};

const getAllPriorityCustomers = async (req, res) => {
  try {
    const { error, value } = validateRequest(
      validator.listPriorityCustomers,
      req.query
    );

    if (error) {
      return response_handler(
        res,
        400,
        `Invalid query params: ${formatValidationError(error)}`
      );
    }

    const { page, limit, search, tier_id, is_active } = value;
    const pipeline = buildListPipeline({ search, tier_id, is_active });

    pipeline.push(
      {
        $facet: {
          data: [
            { $skip: (page - 1) * limit },
            { $limit: limit },
            ...projectListResults,
          ],
          totalCount: [{ $count: "count" }],
        },
      },
      {
        $project: {
          data: 1,
          total: { $ifNull: [{ $arrayElemAt: ["$totalCount.count", 0] }, 0] },
        },
      }
    );

    const results = await PriorityCustomer.aggregate(pipeline);
    const { data = [], total = 0 } = results[0] || {};

    return response_handler(res, 200, "Priority customers fetched", {
      customers: data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 0,
      },
    });
  } catch (err) {
    logger.error(`Error listing priority customers: ${err.message}`, {
      stack: err.stack,
    });
    return response_handler(
      res,
      500,
      "Failed to fetch priority customers",
      err.message
    );
  }
};

const getPriorityCustomerById = async (req, res) => {
  try {
    const { id } = req.params;
    ensureObjectId(id, "Priority customer id");

    const priorityCustomer = await PriorityCustomer.findById(id)
      .populate({
        path: "customer_id",
        populate: { path: "tier" },
      })
      .populate("tier_id")
      .populate("added_by");

    if (!priorityCustomer) {
      return response_handler(res, 404, "Priority customer not found");
    }

    return response_handler(
      res,
      200,
      "Priority customer fetched successfully",
      priorityCustomer
    );
  } catch (err) {
    logger.error(`Error getting priority customer: ${err.message}`);
    return response_handler(
      res,
      500,
      "Failed to fetch priority customer",
      err.message
    );
  }
};

const updatePriorityCustomer = async (req, res) => {
  try {
    const { id } = req.params;
    ensureObjectId(id, "Priority customer id");

    const { error, value } = validateRequest(
      validator.updatePriorityCustomer,
      req.body
    );

    if (error) {
      return response_handler(
        res,
        400,
        `Invalid input: ${formatValidationError(error)}`
      );
    }

    const priorityCustomer = await PriorityCustomer.findById(id);

    if (!priorityCustomer) {
      return response_handler(res, 404, "Priority customer not found");
    }

    let tierToAssign = null;
    if (value.tier_id) {
      ensureObjectId(value.tier_id, "Tier id");
      tierToAssign = await ensureTierExists(value.tier_id);
    }

    if (tierToAssign) {
      priorityCustomer.tier_id = tierToAssign._id;
    }

    if (Object.prototype.hasOwnProperty.call(value, "reason")) {
      priorityCustomer.reason = value.reason || "";
    }

    if (Object.prototype.hasOwnProperty.call(value, "is_active")) {
      priorityCustomer.is_active = value.is_active;
    }

    priorityCustomer.added_by = req.admin ? req.admin._id : null;

    await priorityCustomer.save();

    const populated = await PriorityCustomer.findById(id)
      .populate({
        path: "customer_id",
        populate: { path: "tier" },
      })
      .populate("tier_id")
      .populate("added_by");

    req.priorityCustomerCustomerId =
      populated?.customer_id?._id?.toString?.() ||
      priorityCustomer.customer_id?.toString?.();

    return response_handler(
      res,
      200,
      "Priority customer updated successfully",
      populated
    );
  } catch (err) {
    logger.error(`Error updating priority customer: ${err.message}`);
    return response_handler(
      res,
      500,
      "Failed to update priority customer",
      err.message
    );
  }
};

const deletePriorityCustomer = async (req, res) => {
  try {
    const { id } = req.params;
    ensureObjectId(id, "Priority customer id");

    const priorityCustomer = await PriorityCustomer.findById(id);

    if (!priorityCustomer) {
      return response_handler(res, 404, "Priority customer not found");
    }

    if (!priorityCustomer.is_active) {
      return response_handler(
        res,
        200,
        "Priority customer already removed",
        priorityCustomer
      );
    }

    priorityCustomer.is_active = false;
    priorityCustomer.updatedAt = new Date();

    await priorityCustomer.save();

    req.priorityCustomerCustomerId =
      priorityCustomer.customer_id?.toString?.() || null;

    return response_handler(
      res,
      200,
      "Priority customer removed successfully",
      priorityCustomer
    );
  } catch (err) {
    logger.error(`Error deleting priority customer: ${err.message}`);
    return response_handler(
      res,
      500,
      "Failed to remove priority customer",
      err.message
    );
  }
};

const checkPriorityCustomer = async (req, res) => {
  try {
    const { customerId } = req.params;
    ensureObjectId(customerId, "Customer id");

    const priorityCustomer = await PriorityCustomer.findOne({
      customer_id: customerId,
      is_active: true,
    })
      .populate("tier_id")
      .lean();

    if (!priorityCustomer) {
      return response_handler(res, 200, "Customer is not priority", {
        isPriority: false,
      });
    }

    return response_handler(res, 200, "Customer is priority", {
      isPriority: true,
      priority: priorityCustomer,
    });
  } catch (err) {
    logger.error(`Error checking priority customer: ${err.message}`);
    return response_handler(
      res,
      500,
      "Failed to check priority customer status",
      err.message
    );
  }
};

module.exports = {
  createPriorityCustomer,
  getAllPriorityCustomers,
  getPriorityCustomerById,
  updatePriorityCustomer,
  deletePriorityCustomer,
  checkPriorityCustomer,
};

