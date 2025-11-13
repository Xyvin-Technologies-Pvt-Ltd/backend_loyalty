/**
 * Server startup
 * Initializes and starts the Express server
 */

const clc = require("cli-color");
const { logger } = require("./middlewares/logger");
const { PORT, NODE_ENV, BASE_PATH } = require("./config/env");
const initializeExpress = require("./config/express");
const registerRoutes = require("./config/routes");
const { connectDatabase, isDatabaseConnected } = require("./config/database");
const { registerErrorHandlers } = require("./config/errorHandlers");
const { startScheduledJobs } = require("./config/jobs");
const { runDatabaseSeeds } = require("./config/seeds");
const { setupGracefulShutdown } = require("./config/shutdown");

/**
 * Initialize and start the server
 */
async function startServer() {
  try {
    // Register global error handlers
    registerErrorHandlers();

    // Initialize Express application
    const app = initializeExpress();

    // Connect to database
    await connectDatabase();

    // Verify database connection
    if (!isDatabaseConnected()) {
      throw new Error("Database connection verification failed");
    }

    // Register routes
    registerRoutes(app, BASE_PATH);

    // Start the server
    const server = app.listen(PORT, () => {
      const port_message = clc.redBright(`✓ App is running on port: ${PORT}`);
      const env_message = clc.yellowBright(
        `✓ Environment: ${NODE_ENV || "development"}`
      );
      const status_message = clc.greenBright(
        "✓ Server is up and running smoothly 🚀"
      );

      logger.info(
        `Server started on port ${PORT} in ${NODE_ENV || "development"} mode`
      );

      console.log(`${port_message}\n${env_message}\n${status_message}`);

      // Initialize scheduled jobs
      // startScheduledJobs();

      // Run database seeds in development mode
      // runDatabaseSeeds(NODE_ENV);
    });

    // Setup graceful shutdown
    setupGracefulShutdown(server);

    return server;
  } catch (error) {
    logger.error(`Failed to start server: ${error.message}`, {
      stack: error.stack,
    });
    console.error(clc.redBright(`❌ Failed to start server: ${error.stack}`));
    process.exit(1);
  }
}

// Start the server
startServer();
