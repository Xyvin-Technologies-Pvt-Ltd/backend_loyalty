/**
 * Queue configuration
 * Sets up BullMQ queues for background job processing
 */

const { Queue, Worker } = require("bullmq");
const { logger } = require("../middlewares/logger");
const { redisClient } = require("./redis");

// Redis connection options for BullMQ
// Redis Cloud free tier only supports DB 0, so we must not set a db index
const connection = {
  host: process.env.REDIS_HOST || "localhost",
  port: process.env.REDIS_PORT || 6379,
  username: process.env.REDIS_USERNAME || "default",
  password: process.env.REDIS_PASSWORD || "",
};

// Define queues
const queues = {
  // Email queue for sending emails
  email: new Queue("email", { connection }),

  // Notification queue for push notifications
  notification: new Queue("notification", { connection }),

  // Points processing queue
  points: new Queue("points", { connection }),

  // Segment refresh queue
  segmentRefresh: new Queue("segment-refresh", { connection }),

  // Export queue for data exports
  export: new Queue("export", { connection }),

  // Analytics queue for processing analytics data
  analytics: new Queue("analytics", { connection }),
};


/**
 * Add a job to a queue
 * @param {string} queueName - Name of the queue
 * @param {string} jobName - Name of the job
 * @param {Object} data - Job data
 * @param {Object} options - Job options
 * @returns {Promise<Job>} - The created job
 */
const addJob = async (queueName, jobName, data, options = {}) => {
  try {
    const queue = queues[queueName];
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }

    const job = await queue.add(jobName, data, options);
    logger.debug("Job added to queue", { queueName, jobName, jobId: job.id });
    return job;
  } catch (error) {
    logger.error("Error adding job to queue", {
      error: error.message,
      queueName,
      jobName,
    });
    throw error;
  }
};

/**
 * Create a worker for processing jobs
 * @param {string} queueName - Name of the queue
 * @param {Function} processor - Job processor function
 * @param {Object} options - Worker options
 * @returns {Worker} - The created worker
 */
const createWorker = (queueName, processor, options = {}) => {
  try {
    const worker = new Worker(queueName, processor, {
      connection,
      concurrency: options.concurrency || 5,
      ...options,
    });

    // Worker event handlers
    worker.on("completed", (job) => {
      logger.debug("Job completed", { queueName, jobId: job.id });
    });

    worker.on("failed", (job, err) => {
      logger.error("Job failed", {
        queueName,
        jobId: job?.id,
        error: err.message,
      });
    });

    worker.on("error", (err) => {
      logger.error("Worker error", { queueName, error: err.message, code: err.code });
    });

    logger.info("Worker created", { queueName });
    return worker;
  } catch (error) {
    logger.error("Error creating worker", {
      error: error.message,
      queueName,
    });
    throw error;
  }
};

/**
 * Initialize all workers
 * @param {Object} processors - Map of queue names to processor functions
 */
const initializeWorkers = (processors) => {
  const workers = {};

  Object.entries(processors).forEach(([queueName, processor]) => {
    workers[queueName] = createWorker(queueName, processor);
  });

  return workers;
};

/**
 * Gracefully shut down all queues and workers
 * @param {Object} workers - Map of workers to shut down
 */
const shutdownQueues = async (workers = {}) => {
  logger.info("Shutting down queues and workers");

  // Close all workers
  const workerPromises = Object.values(workers).map((worker) => worker.close());
  await Promise.all(workerPromises);

  // Close all queues
  const queuePromises = Object.values(queues).map((queue) => queue.close());
  await Promise.all(queuePromises);

  logger.info("All queues and workers shut down");
};

module.exports = {
  queues,
  addJob,
  createWorker,
  initializeWorkers,
  shutdownQueues,
};
