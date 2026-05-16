const mongoose = require("mongoose");
require("dotenv").config();

async function checkPointsDrift() {
  try {
    const dbUrl = process.env.MONGO_URL;
    console.log(`Connecting to: ${dbUrl.replace(/\/\/.*@/, "//***@")}...`);
    await mongoose.connect(dbUrl, {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 120000,
    });
    console.log("Connected. Running fast aggregation...\n");

    const db = mongoose.connection.db;

    // Single aggregation: sum active LP points per customer, then compare
    const lpSums = await db.collection("loyaltypoints").aggregate([
      { $match: { status: "active" } },
      { $group: { _id: "$customer_id", lp_sum: { $sum: "$points" } } },
    ], { allowDiskUse: true }).toArray();

    const lpMap = new Map();
    for (const row of lpSums) {
      lpMap.set(row._id.toString(), row.lp_sum);
    }
    console.log(`Aggregated active LP sums for ${lpMap.size} customers`);

    // Get all customers with points
    const customers = await db.collection("customers")
      .find({ total_points: { $gt: 0 } }, { projection: { customer_id: 1, total_points: 1, name: 1 } })
      .toArray();

    console.log(`Found ${customers.length} customers with total_points > 0\n`);

    const drifted = [];
    for (const c of customers) {
      const lpSum = lpMap.get(c._id.toString()) || 0;
      const drift = c.total_points - lpSum;
      if (drift !== 0) {
        drifted.push({
          customer_id: c.customer_id,
          name: c.name,
          total_points: c.total_points,
          active_lp: lpSum,
          drift,
        });
      }
    }

    console.log("=".repeat(80));
    console.log("PROD DRIFT ANALYSIS REPORT");
    console.log("=".repeat(80));
    console.log(`Total customers checked:    ${customers.length}`);
    console.log(`Customers with drift:       ${drifted.length}`);
    console.log(`Customers without drift:    ${customers.length - drifted.length}`);
    const totalDrift = drifted.reduce((s, c) => s + c.drift, 0);
    console.log(`Total drifted points:       ${totalDrift}`);
    console.log("=".repeat(80));

    if (drifted.length > 0) {
      drifted.sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift));
      console.log("\nDRIFTED CUSTOMERS (top 30, sorted by drift):\n");
      drifted.slice(0, 30).forEach((c, i) => {
        console.log(
          `  ${String(i + 1).padStart(3)}. [${c.customer_id}] ${(c.name || "(no name)").padEnd(20)}` +
          `  total_points=${String(c.total_points).padStart(7)}  active_LP=${String(c.active_lp).padStart(7)}  drift=${c.drift}`
        );
      });
      if (drifted.length > 30) {
        console.log(`\n  ... and ${drifted.length - 30} more customers with drift`);
      }
    } else {
      console.log("\nNo drift found — all customers are in sync.");
    }

    console.log("\n" + "=".repeat(80));
  } catch (error) {
    console.error("Error:", error.message);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

checkPointsDrift();
