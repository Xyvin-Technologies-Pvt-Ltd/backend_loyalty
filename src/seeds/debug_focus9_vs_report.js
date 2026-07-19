/**
 * TEMPORARY DEBUG SCRIPT (session 67e7bc) — Focus9 Mongo vs Summary Report.
 * Compares, for a target date, the stored Focus9 daily summary against the
 * Summary Report aggregation computed under 3 different day-boundary windows
 * (Oman / server-local / forced-UTC) to isolate the timezone discrepancy.
 *
 * Run:  node src/seeds/debug_focus9_vs_report.js 2026-07-18
 */
const mongoose = require("mongoose");
const moment = require("moment-timezone");
require("dotenv").config();

const Transaction = require("../models/transaction_model");
const AppType = require("../models/app_type_model");
const Focus9DailySummary = require("../models/focus9_daily_summary_model");

const OMAN_TZ = "Asia/Muscat";
const LOG_ENDPOINT =
  "http://127.0.0.1:7431/ingest/98cfb3b4-06e5-4a3f-9c66-5eb7ccae209c";

async function agentLog(message, data) {
  try {
    await fetch(LOG_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "67e7bc",
      },
      body: JSON.stringify({
        sessionId: "67e7bc",
        hypothesisId: "H1",
        location: "debug_focus9_vs_report.js",
        message,
        data,
        timestamp: Date.now(),
      }),
    });
  } catch (e) {
    /* ignore */
  }
  console.log(`\n=== ${message} ===`);
  console.log(JSON.stringify(data, null, 2));
}

// Report-style aggregation: exact match on metadata.requested_by === name
async function sumPoints(name, type, start, end) {
  const r = await Transaction.aggregate([
    {
      $match: {
        transaction_type: type,
        status: "completed",
        transaction_date: { $gte: start, $lte: end },
        "metadata.requested_by": name,
      },
    },
    { $group: { _id: null, total: { $sum: "$points" }, count: { $sum: 1 } } },
  ]);
  return { total: r[0]?.total || 0, count: r[0]?.count || 0 };
}

async function reportBlock(names, start, end) {
  const out = {};
  for (const name of names) {
    const earn = await sumPoints(name, "earn", start, end);
    const redeem = await sumPoints(name, "redeem", start, end);
    const expire = await sumPoints(name, "expire", start, end);
    out[name] = {
      earn_points: earn.total,
      redeem_points: redeem.total,
      expire_points: expire.total,
      counts: { earn: earn.count, redeem: redeem.count, expire: expire.count },
    };
  }
  return out;
}

async function run() {
  const dateStr = process.argv[2] || "2026-07-18";

  const dbUrl = process.env.MONGO_URL;
  await mongoose.connect(dbUrl, {
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 120000,
  });

  // --- Window 1: Oman (what Focus9 job uses) ---
  const omanStart = moment.tz(dateStr, "YYYY-MM-DD", OMAN_TZ).startOf("day").toDate();
  const omanEnd = moment.tz(dateStr, "YYYY-MM-DD", OMAN_TZ).endOf("day").toDate();

  // --- Window 2: server-local (what reports.controller actually does) ---
  const localStart = new Date(dateStr);
  localStart.setHours(0, 0, 0, 0);
  const localEnd = new Date(dateStr);
  localEnd.setHours(23, 59, 59, 999);

  // --- Window 3: forced UTC (what a prod server running UTC produces) ---
  const utcStart = new Date(`${dateStr}T00:00:00.000Z`);
  const utcEnd = new Date(`${dateStr}T23:59:59.999Z`);

  await agentLog("Environment + windows", {
    dateStr,
    serverTZOffsetMin: new Date().getTimezoneOffset(),
    processTZ: process.env.TZ || "(unset)",
    omanWindow: { start: omanStart.toISOString(), end: omanEnd.toISOString() },
    localWindow: { start: localStart.toISOString(), end: localEnd.toISOString() },
    utcWindow: { start: utcStart.toISOString(), end: utcEnd.toISOString() },
  });

  // Active app type names used by the Summary Report
  const appTypes = await AppType.find({ isActive: true }).sort({ name: 1 }).lean();
  const names = appTypes.map((a) => a.name);
  await agentLog("Active AppType names (report matches these exactly)", { names });

  // Distinct requested_by values present in the Oman window (naming sanity check)
  const distinctRequestedBy = await Transaction.aggregate([
    {
      $match: {
        status: "completed",
        transaction_date: { $gte: omanStart, $lte: omanEnd },
        transaction_type: { $in: ["earn", "expire", "redeem", "adjust"] },
      },
    },
    { $group: { _id: "$metadata.requested_by", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);
  await agentLog("Distinct metadata.requested_by (Oman window)", {
    values: distinctRequestedBy.map((d) => ({ requested_by: d._id, count: d.count })),
  });

  // Stored Focus9 summary for this Oman date (values are OMR)
  const stored = await Focus9DailySummary.findOne({ date: omanStart }).lean();
  await agentLog("Focus9 stored summary (OMR) + points-equivalent (x1000)", {
    found: Boolean(stored),
    date: stored?.date,
    khedmah_app: stored && {
      addition_omr: stored.khedmah_app_addition_amt,
      expired_omr: stored.khedmah_app_expired_amt,
      redeemed_omr: stored.khedmah_app_redeemed_amt,
      addition_pts: stored.khedmah_app_addition_amt * 1000,
      expired_pts: stored.khedmah_app_expired_amt * 1000,
      redeemed_pts: stored.khedmah_app_redeemed_amt * 1000,
    },
    khedmah_delivery: stored && {
      addition_omr: stored.khedmah_delivery_addition_amt,
      expired_omr: stored.khedmah_delivery_expired_amt,
      redeemed_omr: stored.khedmah_delivery_redeemed_amt,
      addition_pts: stored.khedmah_delivery_addition_amt * 1000,
      expired_pts: stored.khedmah_delivery_expired_amt * 1000,
      redeemed_pts: stored.khedmah_delivery_redeemed_amt * 1000,
    },
  });

  // Report-style aggregation under each window
  await agentLog("Summary Report aggregation — OMAN window (points)", {
    window: "oman",
    data: await reportBlock(names, omanStart, omanEnd),
  });
  await agentLog("Summary Report aggregation — SERVER-LOCAL window (points)", {
    window: "server-local",
    serverTZOffsetMin: new Date().getTimezoneOffset(),
    data: await reportBlock(names, localStart, localEnd),
  });
  await agentLog("Summary Report aggregation — FORCED-UTC window (points, mimics prod)", {
    window: "utc",
    data: await reportBlock(names, utcStart, utcEnd),
  });

  await mongoose.disconnect();
  console.log("\nDone.");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
