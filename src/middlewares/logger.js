const winston = require("winston");
const { format, transports } = winston;
const fs = require("fs");
const path = require("path");
const moment = require("moment-timezone");
const { OMAN_TIMEZONE } = require("../utils/date");

//? Ensure logs directory exists
const logDir = "logs";
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir);
}

//? Define custom log formats
const log_format = format.combine(
  // Oman-local timestamps so log lines can be correlated against Oman
  // business-day boundaries (e.g. the 02:00-Oman expiry run) without a
  // mental UTC+4 offset. A function form is required — a plain format
  // string here would render in server-local (UTC) time.
  format.timestamp({ format: () => moment().tz(OMAN_TIMEZONE).format("YYYY-MM-DD HH:mm:ss") }),
  format.printf(({ timestamp, level, message }) => {
    return `[${timestamp}] ${level.toUpperCase()}: ${message}`;
  })
);

//? Logger instance
const logger = winston.createLogger({
  level: "info",
  format: log_format,
  transports: [
    new transports.Console(),
    new transports.File({
      filename: path.join(logDir, "info.log"),
      level: "info",
    }),
    new transports.File({
      filename: path.join(logDir, "error.log"),
      level: "error",
    }),
  ],
});

//? Helper function to get user or admin details
const get_user_info = (req) => {
  if (req.user) {
    return `User: ${req.user.name} (${req.user.email})`;
  } else if (req.admin) {
    return `Admin: ${req.admin.name} (${req.admin.email})`;
  }
  return "Authenticated Request";
};

//? Middleware for logging incoming requests
const request_logger = (req, res, next) => {
  const start_time = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - start_time;
    const user_info = get_user_info(req);
    const log_message = `${req.method} ${req.originalUrl} ${res.statusCode} - ${duration}ms | ${user_info}`;

    if (res.statusCode >= 400) {
      logger.error(log_message);
    } else {
      logger.info(log_message);
    }
  });

  next();
};

//? Middleware for logging success messages
const success_logger = (message, req) => {
  const user_info = get_user_info(req);
  logger.info(`${message} | ${user_info}`);
};

//? Middleware for logging errors
const error_logger = (err, req, res, next) => {
  const user_info = get_user_info(req);
  logger.error(
    `Error: ${err.message} | URL: ${req.originalUrl} | ${user_info}`
  );
  next(err);
};

module.exports = { logger, request_logger, success_logger, error_logger };
