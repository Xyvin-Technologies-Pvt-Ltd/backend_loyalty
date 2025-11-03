/**
 * Express configuration
 * Sets up the Express application with middleware and basic settings
 */

const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const { request_logger, error_logger } = require("../middlewares/logger");
const { auditMiddleware } = require("../modules/audit");
const helmet = require("helmet");
const { xss } = require("express-xss-sanitizer");
const compression = require("compression");
const { env } = require("./env");

// Get the appropriate upload path based on environment
function getUploadPath() {
  // Check if running in Docker container
  const isDocker =
    fs.existsSync("/.dockerenv") || process.env.NODE_ENV !== "development";

  if (isDocker) {
    // Docker container path (will be mounted as volume in production)
    return "/app/uploads";
  } else {
    // Local development path (relative to project root)
    return path.join(process.cwd(), "uploads");
  }
}

function initializeExpress() {
  // Create Express application
  const app = express();

  // Set security HTTP headers (BEFORE CORS)
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: "cross-origin" },
    })
  );

  // Compress response bodies
  app.use(compression());

  // Enable Cross-Origin Resource Sharing (CORS) - MUST BE EARLY
  app.use(
    cors({
      origin: [
        "http://uat-loyalty.xyvin.com",
        "http://localhost:3000",
        "http://localhost:5173",
        "http://141.105.172.45:7733",
        "http://api-uat-loyalty.xyvin.com",
        "http://43.205.198.64",
      ],
      credentials: true, // if you need to allow cookies or auth headers
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: [
        "Content-Type",
        "Authorization",
        "X-Requested-With",
        "api-key",
        "x-api-key",
      ],
      optionsSuccessStatus: 200, // some legacy browsers (IE11, various SmartTVs) choke on 204
    })
  );

  // Handle preflight requests explicitly
  app.options("*", cors());

  // Parse JSON request bodies with increased size limit for file uploads metadata
  app.use(express.json({ limit: "50mb" }));

  // Parse URL-encoded request body with increased size limit
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));

  // Sanitize request data against XSS
  app.use(xss());

  // Serve static files from uploads directory
  // This allows uploaded files to be accessed via /uploads/filename
  const uploadPath = getUploadPath();

  // Ensure upload directory exists for static serving
  if (!fs.existsSync(uploadPath)) {
    fs.mkdirSync(uploadPath, { recursive: true });
    console.log(
      `📁 Created upload directory for static serving: ${uploadPath}`
    );
  }

  // Configure uploads static serving with CORS headers
  app.use("/uploads", (req, res, next) => {
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    next();
  });

  app.use(
    "/uploads",
    express.static(uploadPath, {
      maxAge: "1d", // Cache files for 1 day
      etag: true,
      lastModified: true,
    })
  );

  // Apply request logging middleware
  app.use(request_logger);

  // Apply audit API request logging middleware to all routes
  app.use(auditMiddleware.auditApiRequest());

  // Apply error logging middleware (should be applied after routes)
  app.use(error_logger);

  // Add rate limiting
  if (env === "production") {
    const rateLimit = require("express-rate-limit");
    app.use(
      rateLimit({
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 100, // limit each IP to 100 requests per windowMs
        message: "Too many requests from this IP, please try again later",
      })
    );
  }

  return app;
}

module.exports = initializeExpress;
