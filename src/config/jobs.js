

const { initializeScheduledJobs } = require('../jobs/scheduler');
const { initializeBulkPointsWorker } = require('../jobs/bulk_points.worker');
const { logger } = require('../middlewares/logger');

/**
 * Initialize scheduled jobs and BullMQ workers
 */
function startScheduledJobs() {
    try {
        initializeScheduledJobs();
        initializeBulkPointsWorker();
        logger.info('Scheduled jobs and workers initialized');
    } catch (error) {
        logger.error(`Error initializing scheduled jobs: ${error.message}`, { stack: error.stack });
    }
}

module.exports = {
    startScheduledJobs
}; 