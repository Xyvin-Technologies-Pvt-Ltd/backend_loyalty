/**
 * TEMPORARY DEBUG (session 67e7bc) — dump stored Focus9 summaries around a date
 * and what buildRows() would push to SQL, so we can compare Mongo vs SQL backfill.
 *
 * Run: node src/seeds/debug_focus9_dump.js
 */
const mongoose = require("mongoose");
const moment = require("moment-timezone");
require("dotenv").config();

const Focus9DailySummary = require("../models/focus9_daily_summary_model");
const { buildRows } = require("../services/focus9_sql_sync.service");

const OMAN_TZ = "Asia/Muscat";
const LOG_ENDPOINT =
  "http://127.0.0.1:7431/ingest/98cfb3b4-06e5-4a3f-9c66-5eb7ccae209c";

async function agentLog(message, data) {
  try {
    await fetch(LOG_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "67e7bc" },
      body: JSON.stringify({ sessionId: "67e7bc", hypothesisId: "H7", location: "debug_focus9_dump.js", message, data, timestamp: Date.now() }),
    });
  } catch (e) {}
  console.log(`\n=== ${message} ===`);
  console.log(JSON.stringify(data, null, 2));
}

async function run() {
  await mongoose.connect(process.env.MONGO_URL, { serverSelectionTimeoutMS: 10000 });

  const days = ["2026-07-16", "2026-07-17", "2026-07-18", "2026-07-19"];
  for (const d of days) {
    const start = moment.tz(d, "YYYY-MM-DD", OMAN_TZ).startOf("day").toDate();
    const doc = await Focus9DailySummary.findOne({ date: start }).lean();
    if (!doc) {
      await agentLog(`Mongo summary ${d}`, { found: false, omanStartISO: start.toISOString() });
      continue;
    }
    const rows = buildRows(doc);
    await agentLog(`Mongo summary ${d}`, {
      found: true,
      dateFieldISO: doc.date.toISOString(),
      sql_synced: doc.sql_synced,
      sql_synced_at: doc.sql_synced_at,
      app: {
        addition: doc.khedmah_app_addition_amt,
        expired: doc.khedmah_app_expired_amt,
        redeemed: doc.khedmah_app_redeemed_amt,
        redeem_cancel: doc.khedmah_app_redeem_cancellation_amt,
      },
      delivery: {
        addition: doc.khedmah_delivery_addition_amt,
        expired: doc.khedmah_delivery_expired_amt,
        redeemed: doc.khedmah_delivery_redeemed_amt,
        redeem_cancel: doc.khedmah_delivery_redeem_cancellation_amt,
      },
      sqlRowsToPush: rows.map((r) => ({
        TransactionDate: r.TransactionDate && new Date(r.TransactionDate).toISOString(),
        TransactionType: r.TransactionType,
        AdditionAmount: r.AdditionAmount,
        ExpiryAmount: r.ExpiryAmount,
        RedemptionAmount: r.RedemptionAmount,
        RedemptionCancel: r.RedemptionCancel,
        PostedStatus: r.PostedStatus,
      })),
    });
  }

  await mongoose.disconnect();
  console.log("\nDone.");
}

run().catch((e) => { console.error(e); process.exit(1); });
