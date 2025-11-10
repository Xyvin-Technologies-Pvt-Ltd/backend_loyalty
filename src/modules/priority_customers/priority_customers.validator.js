const Joi = require("joi");
const mongoose = require("mongoose");

const objectId = Joi.string()
  .trim()
  .custom((value, helpers) => {
    if (!mongoose.Types.ObjectId.isValid(value)) {
      return helpers.error("any.invalid");
    }
    return value;
  }, "ObjectId Validation")
  .message("Invalid id format");

const baseSchema = {
  customer_id: objectId.required(),
  tier_id: objectId.required(),
  reason: Joi.string().trim().allow("").max(500),
  is_active: Joi.boolean(),
};

const createPriorityCustomer = Joi.object({
  customer_id: baseSchema.customer_id,
  tier_id: baseSchema.tier_id,
  reason: baseSchema.reason,
});

const updatePriorityCustomer = Joi.object({
  tier_id: baseSchema.tier_id.optional(),
  reason: baseSchema.reason.optional(),
  is_active: baseSchema.is_active.optional(),
}).min(1);

const listPriorityCustomers = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10),
  search: Joi.string().trim().allow(""),
  tier_id: objectId.allow(null, ""),
  is_active: Joi.boolean(),
});

module.exports = {
  createPriorityCustomer,
  updatePriorityCustomer,
  listPriorityCustomers,
};

