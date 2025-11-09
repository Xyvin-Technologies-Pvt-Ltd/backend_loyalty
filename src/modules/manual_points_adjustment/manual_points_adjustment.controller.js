const { v4: uuidv4 } = require("uuid");
const XLSX = require("xlsx");
const mongoose = require("mongoose");
const response_handler = require("../../helpers/response_handler");
const { SafeTransaction } = require("../../helpers/transaction");
const { logger } = require("../../middlewares/logger");
const Transaction = require("../../models/transaction_model");
const Customer = require("../../models/customer_model");
const PointCriteria = require("../../models/point_criteria_model");
const LoyaltyPoints = require("../../models/loyalty_points_model");
const PointsExpirationRules = require("../../models/points_expiration_rules_model");
const AppType = require("../../models/app_type_model");

const REQUIRED_BULK_COLUMNS = ["customer_id", "point_criteria", "note"];

const normalizeString = (value) => (value || "").toString().trim();

const applySession = (query, session) =>
  session ? query.session(session) : query;

const findAppType = async (requestedBy, session = null) => {
  const normalized = normalizeString(requestedBy);
  if (!normalized) {
    return null;
  }

  return applySession(
    AppType.findOne({
      name: new RegExp(`^${normalized}$`, "i"),
    }),
    session
  );
};

const resolvePointCriteria = async (identifier, session = null) => {
  const normalized = normalizeString(identifier);
  if (!normalized) {
    return null;
  }

  if (mongoose.Types.ObjectId.isValid(normalized)) {
    const byId = await applySession(
      PointCriteria.findById(normalized),
      session
    );
    if (byId) {
      return byId;
    }
  }

  return applySession(
    PointCriteria.findOne({ unique_code: normalized }),
    session
  );
};

const buildManualNote = (action, note) =>
  `Manual points ${action} by admin - ${normalizeString(note)}`;

const buildManualMetadata = (additional = {}) => ({
  admin_entered: true,
  manual_source: "admin_panel",
  ...additional,
});

const redeemPointsFIFO = async (customerId, pointsToRedeem, session) => {
  try {
    const validPoints = await LoyaltyPoints.find({
      customer_id: customerId,
      expiryDate: { $gte: new Date() },
      status: "active",
    })
      .sort({ earnedAt: 1 })
      .session(session);

    const totalAvailablePoints = validPoints.reduce(
      (sum, entry) => sum + entry.points,
      0
    );

    if (totalAvailablePoints < pointsToRedeem) {
      return {
        success: false,
        availablePoints: totalAvailablePoints,
        redeemedPoints: 0,
        message: `Insufficient points. Available: ${totalAvailablePoints}, Requested: ${pointsToRedeem}`,
      };
    }

    let remainingPoints = pointsToRedeem;
    let actualRedeemedPoints = 0;
    const usedLoyaltyPoints = [];

    for (const entry of validPoints) {
      if (remainingPoints <= 0) break;

      if (remainingPoints >= entry.points) {
        remainingPoints -= entry.points;
        actualRedeemedPoints += entry.points;

        await LoyaltyPoints.findByIdAndUpdate(
          entry._id,
          {
            status: "redeemed",
            redeemedAt: new Date(),
            points: 0,
          },
          { session }
        );

        usedLoyaltyPoints.push({
          loyalty_point_id: entry._id,
          original_points: entry.points,
          points_used: entry.points,
          fully_redeemed: true,
          expiryDate: entry.expiryDate,
          earnedAt: entry.earnedAt,
        });
      } else {
        const pointsToUse = remainingPoints;
        actualRedeemedPoints += remainingPoints;
        remainingPoints = 0;

        await LoyaltyPoints.findByIdAndUpdate(
          entry._id,
          { points: entry.points - pointsToUse },
          { session }
        );

        usedLoyaltyPoints.push({
          loyalty_point_id: entry._id,
          original_points: entry.points,
          points_used: pointsToUse,
          fully_redeemed: false,
          expiryDate: entry.expiryDate,
          earnedAt: entry.earnedAt,
        });
      }
    }

    return {
      success: true,
      availablePoints: totalAvailablePoints,
      redeemedPoints: actualRedeemedPoints,
      message: `Successfully redeemed ${actualRedeemedPoints} points using FIFO`,
      usedLoyaltyPoints,
    };
  } catch (error) {
    logger.error(`Error in FIFO point redemption: ${error.message}`, {
      customerId,
      pointsToRedeem,
      stack: error.stack,
    });

    return {
      success: false,
      availablePoints: 0,
      redeemedPoints: 0,
      message: `Error during point redemption: ${error.message}`,
    };
  }
};

const getManualPointsForCriteria = (criteria) => {
  if (
    !criteria ||
    !Array.isArray(criteria.pointSystem) ||
    criteria.pointSystem.length === 0
  ) {
    return {
      success: false,
      message: "Point criteria is missing point system configuration",
    };
  }

  const fixedEntry =
    criteria.pointSystem.find((entry) => entry.pointType === "fixed") ||
    criteria.pointSystem[0];

  if (
    !fixedEntry ||
    !Number.isFinite(fixedEntry.pointRate) ||
    fixedEntry.pointRate <= 0
  ) {
    return {
      success: false,
      message: "Point criteria does not have a valid fixed point rule",
    };
  }

  return {
    success: true,
    points: fixedEntry.pointRate,
    rule: fixedEntry,
  };
};

const addPointsIndividual = async (req, res) => {
  const transaction = new SafeTransaction();
  const session = await transaction.start();

  try {
    const { customer_id, point_criteria, requested_by, note } = req.body;

    const customer = await Customer.findById(customer_id)
      .populate("tier")
      .session(session);
    if (!customer) {
      await transaction.abort();
      return response_handler(res, 404, "Customer not found");
    }

    const criteria = await resolvePointCriteria(point_criteria, session);
    if (!criteria) {
      await transaction.abort();
      return response_handler(res, 404, "Point criteria not found");
    }

    const criteriaPoints = getManualPointsForCriteria(criteria);
    if (!criteriaPoints.success) {
      await transaction.abort();
      return response_handler(res, 400, criteriaPoints.message);
    }

    const pointsToAward = criteriaPoints.points;
    const pointRule = criteriaPoints.rule;

    const requestedAppType = await findAppType(requested_by, session);

    const newTransaction = await Transaction.create(
      [
        {
          customer_id: customer._id,
          transaction_type: "earn",
          points: pointsToAward,
          transaction_id: `PROMO-$${uuidv4().slice(0, 8)}`,
          point_criteria: criteria._id,
          app_type: requestedAppType?._id ?? null,
          status: "completed",
          note: buildManualNote("addition", note),
          metadata: buildManualMetadata({
            requested_by,
            point_criteria_code: criteria.unique_code,
            manual_point_rule: {
              pointType: pointRule.pointType,
              pointRate: pointRule.pointRate,
            },
          }),
          transaction_date: new Date(),
        },
      ],
      { session }
    );

    const updatedCustomer = await Customer.findByIdAndUpdate(
      customer._id,
      {
        $inc: {
          total_points: pointsToAward,
          coins: pointsToAward,
        },
      },
      { new: true, session }
    );

    if (!updatedCustomer) {
      await transaction.abort();
      return response_handler(res, 500, "Failed to update customer points");
    }

    try {
      const expiryDate = await PointsExpirationRules.calculateExpiryDate(
        customer.tier?._id ?? null
      );

      await LoyaltyPoints.create(
        [
          {
            customer_id: customer._id,
            points: pointsToAward,
            expiryDate,
            transaction_id: newTransaction[0]._id,
            earnedAt: new Date(),
            status: "active",
            metadata: buildManualMetadata({ requested_by }),
          },
        ],
        { session }
      );
    } catch (error) {
      logger.error(`Error creating loyalty points record: ${error.message}`, {
        customer_id,
        stack: error.stack,
      });
    }

    try {
      const tierController = require("../tier/tier.controller");
      await tierController.checkAndUpgradeTier(customer._id, null, session);
    } catch (error) {
      logger.error(`Error evaluating tier upgrade: ${error.message}`, {
        customer_id,
        stack: error.stack,
      });
    }

    await transaction.commit();

    return response_handler(res, 201, "Manual points added successfully", {
      transaction: newTransaction[0],
      point_balance: updatedCustomer.total_points,
      points_awarded: pointsToAward,
    });
  } catch (error) {
    await transaction.abort();
    logger.error(`Error adding manual points: ${error.message}`, {
      stack: error.stack,
      body: req.body,
    });
    return response_handler(
      res,
      500,
      "Failed to add manual points",
      error.message
    );
  } finally {
    await transaction.end();
  }
};

const addPointsBulk = async (req, res) => {
  if (!req.file) {
    return response_handler(res, 400, "No upload file provided");
  }

  const requestedBy = normalizeString(req.body?.requested_by);
  if (!requestedBy) {
    return response_handler(
      res,
      400,
      "requested_by is required for bulk upload"
    );
  }

  let rows = [];
  try {
    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const firstSheet = workbook.SheetNames[0];
    rows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheet], {
      defval: "",
    });
  } catch (error) {
    logger.error(`Error parsing bulk upload file: ${error.message}`, {
      stack: error.stack,
    });
    return response_handler(res, 400, "Unable to parse upload file");
  }

  if (!rows.length) {
    return response_handler(res, 400, "Uploaded file does not contain data");
  }

  const validationErrors = [];
  const enrichedRows = [];

  for (let index = 0; index < rows.length; index += 1) {
    const rawRow = rows[index];
    const rowNumber = index + 2; // account for header row

    const missingColumns = REQUIRED_BULK_COLUMNS.filter(
      (column) => !Object.prototype.hasOwnProperty.call(rawRow, column)
    );

    if (missingColumns.length) {
      validationErrors.push(
        `Row ${rowNumber}: Missing columns ${missingColumns.join(", ")}`
      );
      continue;
    }

    const customerIdentifier = normalizeString(rawRow.customer_id);
    const pointsValue = Number(rawRow.points);
    const criteriaIdentifier = normalizeString(rawRow.point_criteria);
    const note = normalizeString(rawRow.note);

    if (!customerIdentifier) {
      validationErrors.push(`Row ${rowNumber}: customer_id is required`);
      continue;
    }

    if (!Number.isFinite(pointsValue) || pointsValue <= 0) {
      validationErrors.push(`Row ${rowNumber}: points must be positive`);
      continue;
    }

    if (!criteriaIdentifier) {
      validationErrors.push(`Row ${rowNumber}: point_criteria is required`);
      continue;
    }

    if (!note) {
      validationErrors.push(`Row ${rowNumber}: note is required`);
      continue;
    }

    const customer = await Customer.findOne({
      customer_id: customerIdentifier,
    }).populate("tier");
    if (!customer) {
      validationErrors.push(
        `Row ${rowNumber}: Customer ${customerIdentifier} not found`
      );
      continue;
    }

    const criteria = await resolvePointCriteria(criteriaIdentifier);
    if (!criteria) {
      validationErrors.push(
        `Row ${rowNumber}: Point criteria ${criteriaIdentifier} not found`
      );
      continue;
    }

    enrichedRows.push({
      rowNumber,
      customer,
      criteria,
      points: pointsValue,
      note,
    });
  }

  if (validationErrors.length) {
    return response_handler(
      res,
      400,
      "Bulk upload validation failed",
      validationErrors.join("; ")
    );
  }

  const transaction = new SafeTransaction();
  const txSession = await transaction.start();

  try {
    const requestedAppType = await findAppType(requestedBy, txSession);
    const processedDetails = [];

    for (const entry of enrichedRows) {
      const { customer, criteria, points, note, rowNumber } = entry;

      const [createdTransaction] = await Transaction.create(
        [
          {
            customer_id: customer._id,
            transaction_type: "earn",
            points,
            transaction_id: uuidv4(),
            point_criteria: criteria._id,
            app_type: requestedAppType?._id ?? null,
            status: "completed",
            note: buildManualNote("addition", note),
            metadata: buildManualMetadata({
              requested_by: requestedBy,
              point_criteria_code: criteria.unique_code,
              bulk_row: rowNumber,
            }),
            transaction_date: new Date(),
          },
        ],
        { session: txSession }
      );

      const updatedCustomer = await Customer.findByIdAndUpdate(
        customer._id,
        {
          $inc: {
            total_points: points,
            coins: points,
          },
        },
        { new: true, session: txSession }
      );

      try {
        const expiryDate = await PointsExpirationRules.calculateExpiryDate(
          customer.tier?._id ?? null
        );

        await LoyaltyPoints.create(
          [
            {
              customer_id: customer._id,
              points,
              expiryDate,
              transaction_id: createdTransaction._id,
              earnedAt: new Date(),
              status: "active",
              metadata: buildManualMetadata({
                requested_by: requestedBy,
                bulk_row: rowNumber,
              }),
            },
          ],
          { session: txSession }
        );
      } catch (error) {
        logger.error(
          `Error creating loyalty point entry for bulk upload: ${error.message}`,
          {
            customer_id: customer.customer_id,
            row: rowNumber,
            stack: error.stack,
          }
        );
      }

      processedDetails.push({
        row: rowNumber,
        customer_id: customer.customer_id,
        transaction_id: createdTransaction.transaction_id,
        new_balance: updatedCustomer.total_points,
      });
    }

    try {
      const tierController = require("../tier/tier.controller");
      for (const entry of enrichedRows) {
        await tierController.checkAndUpgradeTier(
          entry.customer._id,
          null,
          txSession
        );
      }
    } catch (error) {
      logger.error(
        `Error evaluating tier upgrades for bulk upload: ${error.message}`,
        {
          stack: error.stack,
        }
      );
    }

    await transaction.commit();

    return response_handler(res, 200, "Bulk manual points added successfully", {
      total_rows: enrichedRows.length,
      success_count: enrichedRows.length,
      details: processedDetails,
    });
  } catch (error) {
    await transaction.abort();
    logger.error(`Error processing bulk manual points: ${error.message}`, {
      stack: error.stack,
    });
    return response_handler(
      res,
      500,
      "Failed to process bulk manual points",
      error.message
    );
  } finally {
    await transaction.end();
  }
};

const reducePoints = async (req, res) => {
  const transaction = new SafeTransaction();
  const session = await transaction.start();

  try {
    const { customer_id, points, requested_by, note } = req.body;
    const numericPoints = Number(points);

    const customer = await Customer.findById(customer_id)
      .populate("tier")
      .session(session);

    if (!customer) {
      await transaction.abort();
      return response_handler(res, 404, "Customer not found");
    }

    if (!Number.isFinite(numericPoints) || numericPoints <= 0) {
      await transaction.abort();
      return response_handler(res, 400, "Points must be a positive number");
    }

    const fifoResult = await redeemPointsFIFO(
      customer._id,
      numericPoints,
      session
    );

    if (!fifoResult.success) {
      await transaction.abort();
      return response_handler(res, 400, fifoResult.message);
    }

    const requestedAppType = await findAppType(requested_by, session);

    const newTransaction = await Transaction.create(
      [
        {
          customer_id: customer._id,
          transaction_type: "redeem",
          points: -numericPoints,
          transaction_id: uuidv4(),
          status: "completed",
          app_type: requestedAppType?._id ?? null,
          note: buildManualNote("reduction", note),
          metadata: buildManualMetadata({
            requested_by,
            redeemed_points: fifoResult.redeemedPoints,
            used_loyalty_points: fifoResult.usedLoyaltyPoints,
          }),
          transaction_date: new Date(),
        },
      ],
      { session }
    );

    const updatedCustomer = await Customer.findByIdAndUpdate(
      customer._id,
      {
        $inc: {
          total_points: -numericPoints,
        },
      },
      { new: true, session }
    );

    await transaction.commit();

    return response_handler(res, 200, "Manual points reduced successfully", {
      transaction: newTransaction[0],
      point_balance: updatedCustomer.total_points,
    });
  } catch (error) {
    await transaction.abort();
    logger.error(`Error reducing manual points: ${error.message}`, {
      stack: error.stack,
      body: req.body,
    });
    return response_handler(
      res,
      500,
      "Failed to reduce manual points",
      error.message
    );
  } finally {
    await transaction.end();
  }
};

const downloadSampleTemplate = async (req, res) => {
  const workbook = XLSX.utils.book_new();
  const sampleData = [
    ["customer_id", "points", "point_criteria", "note"],
    ["CUST000001", 100, "64f0c0a8b8c19f001234abcd", "Welcome bonus adjustment"],
    ["CUST000002", 50, "LOYALTY-SUMMER-2024", "Manual compensation"],
  ];

  const worksheet = XLSX.utils.aoa_to_sheet(sampleData);
  XLSX.utils.book_append_sheet(workbook, worksheet, "Manual Points");

  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

  res.setHeader(
    "Content-Disposition",
    'attachment; filename="manual-points-template.xlsx"'
  );
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );

  return res.status(200).send(buffer);
};

module.exports = {
  addPointsIndividual,
  addPointsBulk,
  reducePoints,
  downloadSampleTemplate,
};
