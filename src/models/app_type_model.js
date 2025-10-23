const mongoose = require("mongoose");

const appTypeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    icon: { type: String, required: true },
    description: { type: String, required: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

const AppType = mongoose.model("AppType", appTypeSchema);

module.exports = AppType;
