const AuditLog = require("../../../models/audit_log_model");
const { logger } = require("../../../middlewares/logger");
const { v4: uuidv4 } = require("uuid");
const {
  auditConfig,
  isAuditEnabled,
  sanitizeAuditData,
} = require("../../../config/audit");
const { OMAN_TIMEZONE, resolveOmanDateRange } = require("../../../utils/date");

/**
 * Queue for background processing of audit logs
 */
const auditQueue = [];
let isProcessingQueue = false;

/**
 * Process the audit queue in the background
 */
async function processAuditQueue() {
  if (isProcessingQueue || auditQueue.length === 0) return;

  isProcessingQueue = true;
  let batch = [];

  try {
    // Process up to 50 logs at a time
    batch = auditQueue.splice(0, 50);

    if (batch.length > 0) {
      await AuditLog.insertMany(batch);
      logger.debug(`Processed ${batch.length} audit logs from queue`);
    }
  } catch (error) {
    logger.error(`Error processing audit queue: ${error.message}`, {
      stack: error.stack,
    });

    // Put failed items back in the queue
    auditQueue.unshift(...batch);
  } finally {
    isProcessingQueue = false;

    // If there are more items, continue processing
    if (auditQueue.length > 0) {
      setImmediate(processAuditQueue);
    }
  }
}

/**
 * Audit Service - Handles all audit logging operations
 */
class AuditService {
  /**
   * Create a new audit log entry
   * @param {Object} logData - The log data
   * @returns {Promise<Object>} - The created log entry
   */
  static async createLog(logData) {
    try {
      // Check if audit logging is enabled for this category
      if (!isAuditEnabled(logData.category)) {
        return null;
      }

      // Generate a request ID if not provided
      if (!logData.requestId) {
        logData.requestId = uuidv4();
      }

      // Set timestamp if not provided
      if (!logData.timestamp) {
        logData.timestamp = new Date();
      }

      // Sanitize sensitive data
      if (logData.details) {
        logData.details = sanitizeAuditData(logData.details);
      }

      if (logData.before) {
        logData.before = sanitizeAuditData(logData.before);
      }

      if (logData.after) {
        logData.after = sanitizeAuditData(logData.after);
      }

      // Use background processing in production
      if (auditConfig.useBackgroundProcessing) {
        auditQueue.push(logData);

        // Start processing the queue if not already processing
        if (!isProcessingQueue) {
          setImmediate(processAuditQueue);
        }

        return { queued: true, requestId: logData.requestId };
      } else {
        // Direct processing for development or when background processing is disabled
        const log = new AuditLog(logData);
        await log.save();
        return log;
      }
    } catch (error) {
      logger.error(`Error creating audit log: ${error.message}`, {
        stack: error.stack,
        logData,
      });
      // Don't throw - audit logging should never break the application
      return null;
    }
  }

  /**
   * Log authentication events
   * @param {Object} options - Log options
   */
  static async logAuthentication({
    action,
    status = "success",
    user = null,
    userModel = "User",
    userName = null,
    userEmail = null,
    ip = null,
    userAgent = null,
    requestId = null,
    description = null,
    details = null,
    sessionId = null,
    authMethod = "password",
  }) {
    return this.createLog({
      category: "authentication",
      action,
      status,
      user,
      userModel,
      userName,
      userEmail,
      ip,
      userAgent,
      requestId,
      description,
      details,
      sessionId,
      authMethod,
    });
  }

  /**
   * Log data access events
   * @param {Object} options - Log options
   */
  static async logDataAccess({
    action,
    status = "success",
    user = null,
    userModel = "User",
    userName = null,
    userEmail = null,
    ip = null,
    userAgent = null,
    requestId = null,
    targetId = null,
    targetModel = null,
    targetName = null,
    description = null,
    details = null,
  }) {
    return this.createLog({
      category: "data_access",
      action,
      status,
      user,
      userModel,
      userName,
      userEmail,
      ip,
      userAgent,
      requestId,
      targetId,
      targetModel,
      targetName,
      description,
      details,
    });
  }

  /**
   * Log admin actions
   * @param {Object} options - Log options
   */
  static async logAdminAction({
    action,
    status = "success",
    user = null,
    userModel = "Admin",
    userName = null,
    userEmail = null,
    ip = null,
    userAgent = null,
    requestId = null,
    targetId = null,
    targetModel = null,
    targetName = null,
    description = null,
    details = null,
  }) {
    return this.createLog({
      category: "admin_action",
      action,
      status,
      user,
      userModel,
      userName,
      userEmail,
      ip,
      userAgent,
      requestId,
      targetId,
      targetModel,
      targetName,
      description,
      details,
    });
  }

  /**
   * Log data modification events
   * @param {Object} options - Log options
   */
  static async logDataModification({
    action,
    status = "success",
    user = null,
    userModel = "User",
    userName = null,
    userEmail = null,
    ip = null,
    userAgent = null,
    requestId = null,
    targetId = null,
    targetModel = null,
    targetName = null,
    description = null,
    details = null,
    before = null,
    after = null,
  }) {
    return this.createLog({
      category: "data_modification",
      action,
      status,
      user,
      userModel,
      userName,
      userEmail,
      ip,
      userAgent,
      requestId,
      targetId,
      targetModel,
      targetName,
      description,
      details,
      before,
      after,
    });
  }

  /**
   * Log system events
   * @param {Object} options - Log options
   */
  static async logSystemEvent({
    action,
    status = "success",
    user = null,
    userModel = null,
    userName = null,
    userEmail = null,
    requestId = null,
    description = null,
    details = null,
  }) {
    return this.createLog({
      category: "system_event",
      action,
      status,
      user,
      userModel,
      userName,
      userEmail,
      requestId,
      description,
      details,
    });
  }

  /**
   * Log error events
   * @param {Object} options - Log options
   */
  static async logError({
    action,
    status = "failure",
    user = null,
    userModel = null,
    userName = null,
    userEmail = null,
    ip = null,
    userAgent = null,
    requestId = null,
    description = null,
    details = null,
    errorCode = null,
    errorMessage = null,
    stackTrace = null,
  }) {
    return this.createLog({
      category: "error",
      action,
      status,
      user,
      userModel,
      userName,
      userEmail,
      ip,
      userAgent,
      requestId,
      description,
      details,
      errorCode,
      errorMessage,
      stackTrace,
    });
  }

  /**
   * Log API calls
   * @param {Object} options - Log options
   */
  static async logApiCall({
    action,
    status = "success",
    user = null,
    userModel = null,
    userName = null,
    userEmail = null,
    ip = null,
    userAgent = null,
    requestId = null,
    description = null,
    details = null,
    endpoint = null,
    method = null,
    responseTime = null,
    responseStatus = null,
  }) {
    return this.createLog({
      category: "api",
      action,
      status,
      user,
      userModel,
      userName,
      userEmail,
      ip,
      userAgent,
      requestId,
      description,
      details,
      endpoint,
      method,
      responseTime,
      responseStatus,
    });
  }

  /**
   * Log point transactions
   * @param {Object} options - Log options
   */
  static async logPointTransaction({
    action,
    status = "success",
    user = null,
    userModel = "User",
    userName = null,
    userEmail = null,
    ip = null,
    userAgent = null,
    requestId = null,
    targetId = null,
    targetModel = "Transaction",
    description = null,
    details = null,
    points = null,
    transactionType = null,
  }) {
    return this.createLog({
      category: "point_transaction",
      action,
      status,
      user,
      userModel,
      userName,
      userEmail,
      ip,
      userAgent,
      requestId,
      targetId,
      targetModel,
      description,
      details,
      points,
      transactionType,
    });
  }

  /**
   * Query audit logs with filtering and pagination
   * @param {Object} filters - Query filters
   * @param {Object} options - Query options (pagination, sorting)
   * @returns {Promise<Object>} - Query results with pagination info
   */
  static async queryLogs(filters = {}, options = {}) {
    try {
      const {
        page = 1,
        limit = 20,
        sortBy = "timestamp",
        sortOrder = "desc",
      } = options;

      const skip = (page - 1) * limit;
      const sort = {};
      sort[sortBy] = sortOrder === "asc" ? 1 : -1;

      // Build query from filters
      const query = {};

      if (filters.category) query.category = filters.category;
      if (filters.action) query.action = filters.action;
      if (filters.status) query.status = filters.status;
      if (filters.user) query.user = filters.user;
      if (filters.userModel) query.userModel = filters.userModel;
      if (filters.targetId) query.targetId = filters.targetId;
      if (filters.targetModel) query.targetModel = filters.targetModel;
      if (filters.requestId) query.requestId = filters.requestId;

      // Date range filtering — resolved as Oman day boundaries so the last
      // day of a selected range isn't silently dropped and the boundary
      // matches the Oman business day, not UTC.
      if (filters.startDate || filters.endDate) {
        const { startDate: gte, endDate: lte } = resolveOmanDateRange(
          filters.startDate,
          filters.endDate,
          { fallback: "none" }
        );
        query.timestamp = {};
        if (gte) query.timestamp.$gte = gte;
        if (lte) query.timestamp.$lte = lte;
      }

      // Text search
      if (filters.search) {
        query.$or = [
          { description: { $regex: filters.search, $options: "i" } },
          { userName: { $regex: filters.search, $options: "i" } },
          { userEmail: { $regex: filters.search, $options: "i" } },
          { targetName: { $regex: filters.search, $options: "i" } },
        ];
      }

      // Execute query with pagination
      const logs = await AuditLog.find(query)
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit))
        .lean();

      // Get total count for pagination
      const total = await AuditLog.countDocuments(query);

      return {
        logs,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      logger.error(`Error querying audit logs: ${error.message}`, {
        stack: error.stack,
        filters,
        options,
      });
      throw error;
    }
  }

  /**
   * Get audit log statistics
   * @param {Object} filters - Query filters
   * @returns {Promise<Object>} - Statistics object
   */
  static async getStatistics(filters = {}) {
    try {
      const query = {};

      // Date range filtering — resolved as Oman day boundaries so the last
      // day of a selected range isn't silently dropped and the boundary
      // matches the Oman business day, not UTC.
      if (filters.startDate || filters.endDate) {
        const { startDate: gte, endDate: lte } = resolveOmanDateRange(
          filters.startDate,
          filters.endDate,
          { fallback: "none" }
        );
        query.timestamp = {};
        if (gte) query.timestamp.$gte = gte;
        if (lte) query.timestamp.$lte = lte;
      }

      // Get counts by category
      const categoryStats = await AuditLog.aggregate([
        { $match: query },
        { $group: { _id: "$category", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]);

      // Get counts by status
      const statusStats = await AuditLog.aggregate([
        { $match: query },
        { $group: { _id: "$status", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]);

      // Get top actions
      const actionStats = await AuditLog.aggregate([
        { $match: query },
        { $group: { _id: "$action", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]);

      // Get recent activity trend (last 7 days)
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const activityTrend = await AuditLog.aggregate([
        {
          $match: {
            timestamp: { $gte: sevenDaysAgo },
          },
        },
        {
          $group: {
            _id: {
              // Grouped in Oman time so daily activity counts match the
              // Oman business day, not UTC.
              $dateToString: {
                format: "%Y-%m-%d",
                date: "$timestamp",
                timezone: OMAN_TIMEZONE,
              },
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]);

      return {
        totalLogs: await AuditLog.countDocuments(query),
        categoryStats,
        statusStats,
        actionStats,
        activityTrend,
      };
    } catch (error) {
      logger.error(`Error getting audit statistics: ${error.message}`, {
        stack: error.stack,
        filters,
      });
      throw error;
    }
  }

  /**
   * Log an SDK action
   * @param {Object} data - SDK action data
   * @returns {Promise<Object>} Created audit log
   */
  static async logSdkAction(data) {
    if (!isAuditEnabled()) return null;

    try {
      const sanitizedData = sanitizeAuditData(data);

      const auditLog = {
        category: "sdk_action",
        action: sanitizedData.action,
        status: sanitizedData.status || "success",
        user: sanitizedData.user,
        userModel: sanitizedData.userModel || "Admin",
        userName: sanitizedData.userName,
        userEmail: sanitizedData.userEmail,
        ip: sanitizedData.ip,
        userAgent: sanitizedData.userAgent,
        requestId: sanitizedData.requestId || uuidv4(),
        targetId: sanitizedData.targetId,
        targetModel: sanitizedData.targetModel,
        targetName: sanitizedData.targetName,
        description:
          sanitizedData.description || `SDK action: ${sanitizedData.action}`,
        details: sanitizedData.details || {},
        timestamp: new Date(),
      };

      // Add to queue for background processing
      auditQueue.push(auditLog);

      // Trigger queue processing
      setTimeout(processAuditQueue, 0);

      return auditLog;
    } catch (error) {
      logger.error(`Error logging SDK action: ${error.message}`, {
        stack: error.stack,
        data,
      });
      return null;
    }
  }
}

module.exports = AuditService;
