const Joi = require("joi");

/**
 * Validator for points activity report generation
 */
const generatePointsReportValidator = Joi.object({
  startDate: Joi.date()
    .optional()
    .description("Start date for the report period"),
  endDate: Joi.date()
    .optional()
    .min(Joi.ref("startDate"))
    .description("End date for the report period (must be after start date)"),
  appType: Joi.string()
    .optional()
    .description("Filter by specific app type ID"),
  includeInactive: Joi.boolean()
    .optional()
    .default(false)
    .description("Include inactive customers in the report"),
});

module.exports = {
  generatePointsReportValidator,
};

