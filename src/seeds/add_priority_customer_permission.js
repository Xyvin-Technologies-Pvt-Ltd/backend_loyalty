/**
 * Migration: add MANAGE_PRIORITY_CUSTOMERS permission to all roles that
 * should have it (Super Admin gets it; run once on each environment).
 *
 * Usage:  node src/seeds/add_priority_customer_permission.js
 */

const mongoose = require("mongoose");
const Role = require("../models/role_model");
const { logger } = require("../middlewares/logger");
require("dotenv").config();

const PERMISSION = "MANAGE_PRIORITY_CUSTOMERS";
const SUPER_ADMIN_NAME = "Super Admin";

const run = async () => {
    await mongoose.connect(process.env.MONGODB_URI);

    const superAdmin = await Role.findOne({ name: SUPER_ADMIN_NAME });

    if (!superAdmin) {
        logger.error(`Role "${SUPER_ADMIN_NAME}" not found. Aborting.`);
        process.exit(1);
    }

    if (superAdmin.permissions.includes(PERMISSION)) {
        logger.info(`"${PERMISSION}" already present on ${SUPER_ADMIN_NAME}. Nothing to do.`);
        process.exit(0);
    }

    superAdmin.permissions.push(PERMISSION);
    await superAdmin.save();

    logger.info(`✅ Added "${PERMISSION}" to ${SUPER_ADMIN_NAME} (id: ${superAdmin._id})`);
    process.exit(0);
};

run().catch((err) => {
    logger.error(`Migration failed: ${err.message}`);
    process.exit(1);
});
