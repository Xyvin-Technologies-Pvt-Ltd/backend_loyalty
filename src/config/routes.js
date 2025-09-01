/**
 * Routes configuration
 * Registers all application routes with the Express app
 */

const { logger } = require("../middlewares/logger");
const response_handler = require("../helpers/response_handler");
// Create two separate instances of swagger-ui-express
const swaggerUi = require("swagger-ui-express");

const { swagger_spec, swagger_options } = require("../swagger/swagger");
const {
  sdk_swagger_spec,
  sdk_swagger_options,
} = require("../swagger/swagger_client");
// Import route modules
const auth_routes = require("../modules/auth/auth.routes");
const log_routes = require("../modules/log/log.routes");
const tier_routes = require("../modules/tier/tier.routes");
const tier_eligibility_routes = require("../modules/tier_eligibility/tier_eligibility.routes");
const point_criteria_routes = require("../modules/point_criteria/point_criteria.routes");
const role_routes = require("../modules/role/role.routes");
const redemption_rules_routes = require("../modules/redemption_rules/redemption_rules.routes");
const points_expiration_routes = require("../modules/points_expiration/points_expiration.routes");
const { sdkAccessKeyRoutes, sdkApiRoutes } = require("../modules/sdk");
const auditRoutes = require("../modules/audit/routes/audit.routes");
const { themeSettingsRoutes } = require("../modules/theme_settings");
const app_type_routes = require("../modules/app_types/app_type.routes");
const trigger_event_routes = require("../modules/trigger_event/trigger_event.routes");
const trigger_services_routes = require("../modules/trigger_services/trigger_services.routes");
const coin_management_routes = require("../modules/coin_convertion_rule/coin_management.routes");
const referral_program_entry_routes = require("../modules/referral_program_entry/referral_program.routes");
const referral_program_rules_routes = require("../modules/referral_program_rules/refferal_program_rules.routes");
const transaction_routes = require("../modules/transaction/transaction.routes");
const customer_routes = require("../modules/customer/customer.routes");
const loyalty_points_routes = require("../modules/loyalty_points_core/loyalty_points.router");
const coupon_brand_routes = require("../modules/coupon_brand/coupon_brand.routes");
const coupon_category_routes = require("../modules/coupon_category/coupon_category.routes");
const customer_support_routes = require("../modules/customer_support/support.routes");
const sub_admin_routes = require("../modules/sub_admin/sub_admin.routes");
//clinet only routes
const client_only_routes = require("../modules/client_only/index");
//Offers routes
const merchant_offers_routes = require("../modules/merchant_offers/merchant_offers.routes");
const kedmah_offers_routes = require("../modules/kedmah_offers/kedmah_offers.routes");
const payment_method_routes = require("../modules/payment_method/payment_method.router");
//upload routes
const upload_routes = require("../modules/upload/upload.routes");
const dashboard_routes = require("../modules/dashboard/dashboard.routes")


//new-kedmah-sdk-route 
const new_kedmah_sdk_routes = require("../modules/new_kedmah_sdk/new_kedmah_sdk.routes");
// Helper function to create separate swagger setup handlers
const useSchema =
  (schema, options) =>
  (...args) =>
    swaggerUi.setup(schema, options)(...args);

function registerRoutes(app, basePath) {
  // Define a route for the API root
  app.get(basePath, (req, res) => {
    logger.info("API root accessed", { endpoint: basePath });
    return response_handler(
      res,
      200,
      "🔐 Access point secured! Only those with the key may proceed. Do you dare to unlock the secrets within? 🚀"
    );
  });
  // Main API Swagger setup with useSchema function
  app.use(
    `${basePath}/api-docs`,
    (req, res, next) => {
      logger.info("Swagger UI accessed", { endpoint: `${basePath}/api-docs` });
      next();
    },
    swaggerUi.serve,
    useSchema(swagger_spec, swagger_options)
  );

  // SDK API Swagger setup with useSchema function
  app.use(
    `${basePath}/sdk-docs`,
    (req, res, next) => {
      logger.info("SDK Swagger UI accessed", {
        endpoint: `${basePath}/sdk-docs`,
      });
      next();
    },
    swaggerUi.serve,
    useSchema(sdk_swagger_spec, sdk_swagger_options)
  );

  // Register module routes
  app.use(`${basePath}/auth`, auth_routes);
  app.use(`${basePath}/logs`, log_routes);
  app.use(`${basePath}/tier`, tier_routes);
  app.use(`${basePath}/tier-eligibility`, tier_eligibility_routes);
  app.use(`${basePath}/point-criteria`, point_criteria_routes);
  app.use(`${basePath}/roles-settings`, role_routes);
  app.use(`${basePath}/redemption-rules`, redemption_rules_routes);
  app.use(`${basePath}/point-expiry-rules`, points_expiration_routes);
  app.use(`${basePath}/app-types`, app_type_routes);
  app.use(`${basePath}/trigger-events`, trigger_event_routes);
  app.use(`${basePath}/trigger-services`, trigger_services_routes);
  app.use(`${basePath}/coin-conversion`, coin_management_routes);
  app.use(`${basePath}/referral-program-entry`, referral_program_entry_routes);
  app.use(`${basePath}/referral-program-rules`, referral_program_rules_routes);
  app.use(`${basePath}/transaction`, transaction_routes);
  app.use(`${basePath}/customer`, customer_routes);
  app.use(`${basePath}/loyalty-points`, loyalty_points_routes);
  app.use(`${basePath}/coupon-brand`, coupon_brand_routes);
  app.use(`${basePath}/coupon-category`, coupon_category_routes);
  app.use(`${basePath}/customer-support`, customer_support_routes);
  app.use(`${basePath}/sub-admin`, sub_admin_routes);
  // SDK routes
  app.use(`${basePath}/sdk/access-keys`, sdkAccessKeyRoutes);
  app.use(`${basePath}/sdk/api`, sdkApiRoutes);

  //Offers routes
  app.use(`${basePath}/merchant-offers`, merchant_offers_routes);
  app.use(`${basePath}/kedmah-offers`, kedmah_offers_routes);

  // Audit routes
  app.use(`${basePath}/audit`, auditRoutes);
  app.use(`${basePath}/transactions`, transaction_routes);
  app.use(`${basePath}/customer-support`, customer_support_routes);
  app.use(`${basePath}/dashboard`, dashboard_routes);

  // Theme settings routes
  app.use(`${basePath}/theme-settings`, themeSettingsRoutes);


  //upload routes
  app.use(`${basePath}/upload`, upload_routes);

  //client only routes
  app.use(`${basePath}/client`, client_only_routes);

  //payment method routes
  app.use(`${basePath}/payment-method`, payment_method_routes); 

  //new-kedmah-sdk-route 
  app.use(`${basePath}/khedmah-sdk`, new_kedmah_sdk_routes);
}

module.exports = registerRoutes;
