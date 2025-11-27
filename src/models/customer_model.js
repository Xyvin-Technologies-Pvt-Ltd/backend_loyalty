const mongoose = require("mongoose");

const customer_schema = new mongoose.Schema(
  {
    customer_id: { type: String, trim: true ,unique: true},
    name: { type: String, trim: true },
    email: { type: String, trim: true },
    phone: { type: String, trim: true },
    tier: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tier",
    },
    referral_code: {
      type: String,
      unique: true,
      required: false,
    },
    coins: {
      type: Number,
      default: 0,
    },
 
    referred_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      default: null,
    },
    user_referer_count: {
      type: Number,
      default: 0,
    },
    status: {
      type: Boolean,
      default: true,
    },
    app_type: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "AppType",
      },
    ],
    //for notification
    device_token: [{ type: String, trim: true, default: null }], //multiple device token
    device_type: {
      type: String,
      enum: ["android", "ios", "web"],
      default: null,
      // required: true,
    },
    notification_preferences: {
      email: { type: Boolean, default: true },
      sms: { type: Boolean, default: true },
      push: { type: Boolean, default: true },
    },
    total_points: { type: Number, default: 0 },

    last_active: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

const Customer = mongoose.model("Customer", customer_schema);

//INDEXING
customer_schema.index({ customer_id: 1 });

customer_schema.index({ app_type: 1 });

// Critical indexes for reports performance
customer_schema.index({ createdAt: 1, app_type: 1 });


module.exports = Customer;
