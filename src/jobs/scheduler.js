const { logger } = require("../middlewares/logger");
const moment = require("moment-timezone");
const { processExpiredPoints } = require("./point_expiry_checker.job");
const { processTierDowngrades } = require("./tier_downgrade.job");

const OMAN_TIMEZONE = "Asia/Muscat";
const SCHEDULED_HOUR = 2; // 2 AM
const SCHEDULED_MINUTE = 0;


function scheduleDaily(job, hour, minute, jobType = "daily") {
  const now = moment().tz(OMAN_TIMEZONE);
  let scheduledTime = moment()
    .tz(OMAN_TIMEZONE)
    .hour(hour)
    .minute(minute)
    .second(0)
    .millisecond(0);

  // If the time has already passed today, schedule for tomorrow
  if (scheduledTime.isBefore(now) || scheduledTime.isSame(now)) {
    scheduledTime.add(1, "day");
  }

  const timeUntilExecution = scheduledTime.diff(now);

  logger.info(
    `Scheduling daily job to run at ${scheduledTime.format(
      "YYYY-MM-DD HH:mm:ss"
    )} Oman time (in ${Math.round(timeUntilExecution / 60000)} minutes)`
  );

  // Schedule the first execution
  const timer = setTimeout(async () => {
    try {
      await job(jobType);
    } catch (error) {
      logger.error(`Error executing scheduled job: ${error.message}`, {
        stack: error.stack,
      });
    }

    // Schedule the job to run again tomorrow
    scheduleDaily(job, hour, minute, jobType);
  }, timeUntilExecution);

  return timer;
}


function scheduleMonthly(job, jobType = "monthly") {
  const now = moment().tz(OMAN_TIMEZONE);

  let scheduledTime = moment()
    .tz(OMAN_TIMEZONE)
    .endOf("month")
    .hour(SCHEDULED_HOUR)
    .minute(SCHEDULED_MINUTE)
    .second(0)
    .millisecond(0);

  // If the time has already passed this month, schedule for next month's last day
  if (scheduledTime.isBefore(now) || scheduledTime.isSame(now)) {
    scheduledTime = moment()
      .tz(OMAN_TIMEZONE)
      .add(1, "month")
      .endOf("month")
      .hour(SCHEDULED_HOUR)
      .minute(SCHEDULED_MINUTE)
      .second(0)
      .millisecond(0);
  }

  const timeUntilExecution = scheduledTime.diff(now);

  logger.info(
    `Scheduling monthly job to run on last day of month at ${scheduledTime.format(
      "YYYY-MM-DD HH:mm:ss"
    )} Oman time (in ${Math.round(timeUntilExecution / 3600000)} hours)`
  );

  // Schedule the first execution
  const timer = setTimeout(async () => {
    try {
      await job(jobType);
    } catch (error) {
      logger.error(`Error executing monthly scheduled job: ${error.message}`, {
        stack: error.stack,
      });
    }

    // Schedule the job to run again next month's last day
    scheduleMonthly(job, jobType);
  }, timeUntilExecution);

  return timer;
}

function scheduleNow(job, jobType = "manual") {
  job(jobType);
}


function initializeScheduledJobs() {
  try {
    logger.info("Initializing scheduled jobs");

    // Schedule point expiry checker to run daily at 2 AM Oman time
    scheduleDaily(processExpiredPoints, SCHEDULED_HOUR, SCHEDULED_MINUTE, "daily");
    logger.info(
      `Point expiry checker scheduled to run daily at ${SCHEDULED_HOUR}:${SCHEDULED_MINUTE.toString().padStart(2, "0")} AM Oman time`
    );

    // // Schedule tier downgrade to run on last day of each month at 2 AM Oman time
    // scheduleMonthly(processTierDowngrades, "monthly");
    // logger.info(
    //   `Tier downgrade scheduled to run on last day of each month at ${SCHEDULED_HOUR}:${SCHEDULED_MINUTE.toString().padStart(2, "0")} AM Oman time`
    // );
    
    logger.info(
      `Tier downgrade scheduled to run manually at ${SCHEDULED_HOUR}:${SCHEDULED_MINUTE.toString().padStart(2, "0")} AM Oman time`
    );

    logger.info("All jobs scheduled successfully");
  } catch (error) {
    logger.error(`Error initializing scheduled jobs: ${error.message}`, {
      stack: error.stack,
    });
  }
}

module.exports = {
  initializeScheduledJobs,
};
