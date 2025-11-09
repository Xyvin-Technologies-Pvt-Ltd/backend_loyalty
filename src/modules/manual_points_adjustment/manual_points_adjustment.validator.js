const Joi = require("joi");
const response_handler = require("../../helpers/response_handler");

const objectId = Joi.string()
  .regex(/^[0-9a-fA-F]{24}$/)
  .message("Invalid ObjectId format");

const addIndividualSchema = Joi.object({
  customer_id: objectId.required(),
  points: Joi.number().positive().required(),
  point_criteria: Joi.string().trim().required(),
  requested_by: Joi.string().trim().required(),
  note: Joi.string().trim().required(),
});

const bulkSchema = Joi.object({
  requested_by: Joi.string().trim().required(),
});

const reduceSchema = Joi.object({
  customer_id: objectId.required(),
  points: Joi.number().positive().required(),
  requested_by: Joi.string().trim().required(),
  note: Joi.string().trim().required(),
});

const createValidator =
  (schema, property = "body") =>
  (req, res, next) => {
    const { error, value } = schema.validate(req[property], {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      const message = error.details.map((detail) => detail.message).join(", ");
      return response_handler(res, 400, message);
    }

    req[property] = value;
    return next();
  };

module.exports = {
  validateAddIndividualPayload: createValidator(addIndividualSchema),
  validateBulkPayload: createValidator(bulkSchema),
  validateReducePayload: createValidator(reduceSchema),
};

