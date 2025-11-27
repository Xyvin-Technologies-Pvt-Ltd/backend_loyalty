/**
 * Database configuration
 * Handles database connection and related operations
 */

const mongoose = require('mongoose');
const clc = require('cli-color');
const { logger } = require('../middlewares/logger');
const { NODE_ENV, MONGO_URL } = require('./env');

// MongoDB connection options
const connectionOptions = {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 120000, // 120 seconds - increased for heavy report queries
};

/**
 * Initialize database connection
 * @returns {Promise} Resolves when connection is established
 */
async function connectDatabase() {
    try {
        // Connect to MongoDB
        await mongoose.connect(MONGO_URL, connectionOptions);

        // Log success
        logger.info('Database connection established successfully');
        console.log(clc.greenBright("✅ Database linked successfully! 🚀"+MONGO_URL));

        return Promise.resolve();
    } catch (error) {
        // Log error
        logger.error(`Database connection error: ${error.message}`, { stack: error.stack });
        console.log(clc.redBright("❌ Database connection failed! Check the logs below:"));
        console.log(clc.bgYellowBright.black(error.message || error));

        // In production, we might want to exit the process on database connection failure
        if (NODE_ENV === 'production') {
            process.exit(1);
        }

        return Promise.reject(error);
    }
}

/**
 * Disconnect from the database
 * @returns {Promise} Resolves when disconnected
 */
async function disconnectDatabase() {
    try {
        await mongoose.disconnect();
        logger.info('Database disconnected successfully');
        return Promise.resolve();
    } catch (error) {
        logger.error(`Database disconnection error: ${error.message}`, { stack: error.stack });
        return Promise.reject(error);
    }
}

/**
 * Check database connection status
 * @returns {Boolean} True if connected, false otherwise
 */
function isDatabaseConnected() {
    return mongoose.connection.readyState === 1;
}

/**
 * Get database connection information
 * @returns {Object} Database connection information
 */
function getDatabaseInfo() {
    return {
        connected: isDatabaseConnected(),
        host: mongoose.connection.host,
        name: mongoose.connection.name,
        port: mongoose.connection.port,
        models: Object.keys(mongoose.models)
    };
}

// Export database functions
module.exports = {
    connectDatabase,
    disconnectDatabase,
    isDatabaseConnected,
    getDatabaseInfo
}; 