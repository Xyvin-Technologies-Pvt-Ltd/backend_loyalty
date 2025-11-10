const mongoose = require("mongoose");

const priorityCustomerSchema = new mongoose.Schema(
  {
    customer_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
      unique: true,
    },
    tier_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tier",
      required: true,
    },
    added_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
    reason: {
      type: String,
      trim: true,
      maxlength: 500,
      default: "",
    },
    is_active: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

priorityCustomerSchema.index({ customer_id: 1, is_active: 1 });
priorityCustomerSchema.index({ tier_id: 1, is_active: 1 });

const PriorityCustomer = mongoose.model(
  "PriorityCustomer",
  priorityCustomerSchema
);

module.exports = PriorityCustomer;

