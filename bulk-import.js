const mongoose = require("mongoose");
const XLSX = require("xlsx");
const Customer = require("./src/models/customer_model");
const Tier = require("./src/models/tier_model");

// Database connection
const connectDB = async () => {
  try {
    await mongoose.connect(
      process.env.MONGODB_URI || "mongodb://localhost:27017/loyalty"
    );
    console.log("✅ Connected to MongoDB");
  } catch (error) {
    console.error("❌ MongoDB connection error:", error);
    process.exit(1);
  }
};

// Bulk import function with MongoDB bulk operations
async function bulkImportCustomersFromExcel(batchSize = 100) {
  try {
    const filePath = "./src/modules/customer/tier-up.xlsx";

    console.log(`📂 Reading Excel file from ${filePath}`);
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const sheetData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

    console.log(`📊 Found ${sheetData.length} rows in Excel file`);
    console.log("📋 Sample data:", sheetData.slice(0, 3));
    console.log(
      `🔄 Processing in batches of ${batchSize} using bulk operations`
    );

    let successCount = 0;
    let errorCount = 0;
    const errors = [];
    const totalRows = sheetData.length;

    // Get all tiers once to avoid repeated queries
    console.log("🔍 Loading all tiers...");
    const allTiers = await Tier.find({});
    const tierMap = new Map();
    allTiers.forEach((tier) => {
      tierMap.set(tier.name.en, tier._id);
    });
    console.log(`✅ Loaded ${allTiers.length} tiers`);

    // Process in batches
    for (let i = 0; i < sheetData.length; i += batchSize) {
      const batch = sheetData.slice(i, i + batchSize);
      const batchNumber = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(sheetData.length / batchSize);

      console.log(
        `\n🔄 Processing batch ${batchNumber}/${totalBatches} (${batch.length} records)`
      );

      // Prepare bulk operations
      const bulkOps = [];
      const batchErrors = [];

      batch.forEach((row, index) => {
        const rowNumber = i + index + 1;
        const customerId = row.CustomerID?.trim();
        const tierName = row.Tier?.trim();

        if (!customerId || !tierName) {
          batchErrors.push(`Row ${rowNumber}: Missing CustomerID or Tier`);
          return;
        }

        const tierId = tierMap.get(tierName);
        if (!tierId) {
          batchErrors.push(
            `Customer ${customerId}: Tier '${tierName}' not found`
          );
          return;
        }

        // Add to bulk operations
        bulkOps.push({
          updateOne: {
            filter: { customer_id: customerId },
            update: {
              customer_id: customerId,
              tier: tierId,
              updatedAt: new Date(),
            },
            upsert: true,
          },
        });
      });

      // Execute bulk operations
      if (bulkOps.length > 0) {
        try {
          const result = await Customer.bulkWrite(bulkOps, { ordered: false });
          successCount += result.upsertedCount + result.modifiedCount;
          console.log(
            `✅ Batch ${batchNumber}: ${result.upsertedCount} inserted, ${result.modifiedCount} updated`
          );
        } catch (error) {
          console.error(`❌ Batch ${batchNumber} failed:`, error.message);
          errorCount += bulkOps.length;
          batchErrors.push(`Batch ${batchNumber}: ${error.message}`);
        }
      }

      // Add batch errors to total errors
      errors.push(...batchErrors);
      errorCount += batchErrors.length;

      // Add a small delay between batches
      if (i + batchSize < sheetData.length) {
        console.log(`⏳ Waiting 50ms before next batch...`);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }

    console.log(`\n📊 Import Summary:`);
    console.log(`✅ Successful: ${successCount}`);
    console.log(`❌ Errors: ${errorCount}`);
    console.log(`📋 Total processed: ${totalRows}`);
    console.log(`🔄 Batches processed: ${Math.ceil(totalRows / batchSize)}`);
    console.log(`📦 Batch size: ${batchSize}`);

    if (errors.length > 0) {
      console.log(`\n❌ Errors encountered:`);
      errors.slice(0, 10).forEach((error) => console.log(`  - ${error}`));
    }
  } catch (error) {
    console.error("❌ Error importing customers:", error);
  }
}

// Main execution
async function main() {
  const batchSize = process.argv[2] ? parseInt(process.argv[2]) : 100;

  console.log(`🚀 Starting bulk import with batch size: ${batchSize}`);

  await connectDB();
  await bulkImportCustomersFromExcel(batchSize);
  await mongoose.connection.close();
  console.log("🔌 Database connection closed");
}

main().catch(console.error);

