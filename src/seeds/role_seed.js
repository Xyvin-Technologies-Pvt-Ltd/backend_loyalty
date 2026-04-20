const mongoose = require("mongoose");
const Role = require("../models/role_model");
const { logger } = require("../middlewares/logger");

/**
 * Seed roles with permissions that match the UI
 */
const seedRoles = async () => {
    try {
        // Check if roles already exist
        const existingRoles = await Role.countDocuments();
        if (existingRoles > 0) {
            logger.info("Roles already seeded. Skipping role seed.");
            return;
        }

        // Define all possible permissions based on the UI
        const allPermissions = {
            customers: [
                "VIEW_CUSTOMERS",
                "EDIT_CUSTOMERS",
                "DELETE_CUSTOMERS",
                "EXPORT_CUSTOMERS",
                "MANAGE_PRIORITY_CUSTOMERS"
            ],
            points: [
                "MANAGE_POINTS",
                "VIEW_POINTS_HISTORY",
                "ADJUST_POINTS",
                "MANAGE_CRITERIA"
            ],
            offers: [
                "CREATE_OFFERS",
                "EDIT_OFFERS",
                "DELETE_OFFERS",
                "MANAGE_REDEMPTIONS"
            ],
            tiers: [
                "MANAGE_TIERS",
                "VIEW_TIERS",
                "ASSIGN_TIERS"
            ],
            reports: [
                "VIEW_REPORTS",
                "EXPORT_REPORTS",
                "MANAGE_ANALYTICS",
                "VIEW_DASHBOARD"
            ],
            system: [
                "MANAGE_ROLES",
                "MANAGE_ADMINS",
                "VIEW_AUDIT_LOGS",
                "MANAGE_SETTINGS"
            ]
        };

        // Create Super Admin role with all permissions
        const superAdminPermissions = Object.values(allPermissions).flat();
        const superAdmin = new Role({
            name: "Super Admin",
            description: "Full system access",
            permissions: superAdminPermissions,
            status: true
        });

        // Create Manager role with limited permissions
        const managerPermissions = [
            ...allPermissions.customers,
            ...allPermissions.points,
            "VIEW_REPORTS", "EXPORT_REPORTS", "VIEW_DASHBOARD",
            "VIEW_TIERS"
        ];
        const manager = new Role({
            name: "Manager",
            description: "Manages customers and points",
            permissions: managerPermissions,
            status: true
        });

        // Create Reports Viewer role
        const reportViewerPermissions = [
            "VIEW_CUSTOMERS",
            "VIEW_POINTS_HISTORY",
            "VIEW_REPORTS",
            "EXPORT_REPORTS",
            "VIEW_DASHBOARD"
        ];
        const reportViewer = new Role({
            name: "Reports Viewer",
            description: "Can view and export reports only",
            permissions: reportViewerPermissions,
            status: true
        });

        // Create Customer Support role
        const customerSupportPermissions = [
            "VIEW_CUSTOMERS",
            "VIEW_POINTS_HISTORY",
            "ADJUST_POINTS",
            "VIEW_TIERS"
        ];
        const customerSupport = new Role({
            name: "Customer Support",
            description: "Handles customer inquiries and basic point adjustments",
            permissions: customerSupportPermissions,
            status: true
        });

        // Save all roles
        await Role.insertMany([superAdmin, manager, reportViewer, customerSupport]);

        logger.info("Roles seeded successfully!");
    } catch (error) {
        logger.error(`Error seeding roles: ${error.message}`);
    }
};

module.exports = seedRoles; 