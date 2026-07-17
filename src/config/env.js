/**
 * Environment configuration
 * Centralizes all environment variables for easy access throughout the application
 */

// Load environment variables
require('dotenv').config();

module.exports = {
    // Server configuration
    PORT: process.env.PORT || 3000,
    NODE_ENV: process.env.NODE_ENV || 'development',
    API_VERSION: process.env.API_VERSION || 'v1',

    // Base path for API routes
    BASE_PATH: `/api/${process.env.API_VERSION || 'v1'}`,

    // Database configuration
    MONGO_URL: process.env.MONGO_URL,
    DB_URI: process.env.DB_URI, // Keeping for backward compatibility

    // JWT configuration
    JWT_SECRET: process.env.JWT_SECRET,
    JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',

    // Swagger configuration
    SWAGGER_API_KEY: process.env.SWAGGER_API_KEY,
    SWAGGER_SUPER_ADMIN_TOKEN: process.env.SWAGGER_SUPER_ADMIN_TOKEN,

    // FOCUS SQL Server integration
    FOCUS_CRON_ENABLED: process.env.FOCUS_CRON_ENABLED !== 'false',
    FOCUS_SQL_ENABLED: process.env.FOCUS_SQL_ENABLED === 'true',
    FOCUS_SQL_HOST: process.env.FOCUS_SQL_HOST,
    FOCUS_SQL_PORT: parseInt(process.env.FOCUS_SQL_PORT || '1433', 10),
    FOCUS_SQL_DATABASE: process.env.FOCUS_SQL_DATABASE,
    FOCUS_SQL_USER: process.env.FOCUS_SQL_USER,
    FOCUS_SQL_PASSWORD: process.env.FOCUS_SQL_PASSWORD,
    FOCUS_SQL_TABLE: process.env.FOCUS_SQL_TABLE || 'dbo.TblLoyaltyPoints',
    FOCUS_SQL_ENCRYPT: process.env.FOCUS_SQL_ENCRYPT === 'true',
    FOCUS_SQL_TRUST_SERVER_CERT: process.env.FOCUS_SQL_TRUST_SERVER_CERT !== 'false',
}; 