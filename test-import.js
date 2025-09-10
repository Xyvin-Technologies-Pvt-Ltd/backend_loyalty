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

// Import function with batch processing
async function importCustomersFromExcel(batchSize = 50) {
  try {
    const filePath = "./src/modules/customer/tier-up.xlsx";

    console.log(`📂 Reading Excel file from ${filePath}`);
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const sheetData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

    console.log(`📊 Found ${sheetData.length} rows in Excel file`);
    console.log("📋 Sample data:", sheetData.slice(0, 3));
    console.log(`🔄 Processing in batches of ${batchSize}`);

    let successCount = 0;
    let errorCount = 0;
    const errors = [];
    const totalRows = sheetData.length;

    // Process in batches
    for (let i = 0; i < sheetData.length; i += batchSize) {
      const batch = sheetData.slice(i, i + batchSize);
      const batchNumber = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(sheetData.length / batchSize);

      console.log(
        `\n🔄 Processing batch ${batchNumber}/${totalBatches} (${batch.length} records)`
      );

      // Process each batch
      const batchPromises = batch.map(async (row, index) => {
        const rowNumber = i + index + 1;
        const customerId = row.CustomerID?.trim();
        const tierName = row.Tier?.trim();

        if (!customerId || !tierName) {
          return {
            success: false,
            error: `Row ${rowNumber}: Missing CustomerID or Tier`,
            customerId: customerId || "N/A",
          };
        }

        try {
          const tier = await Tier.findOne({ "name.en": tierName });
          if (!tier) {
            return {
              success: false,
              error: `Customer ${customerId}: Tier '${tierName}' not found`,
              customerId,
            };
          }

          await Customer.findOneAndUpdate(
            { customer_id: customerId },
            { customer_id: customerId, tier: tier._id },
            { upsert: true, new: true }
          );

          return {
            success: true,
            customerId,
          };
        } catch (error) {
          return {
            success: false,
            error: `Customer ${customerId}: ${error.message}`,
            customerId,
          };
        }
      });

      // Wait for batch to complete
      const batchResults = await Promise.all(batchPromises);

      // Process batch results
      batchResults.forEach((result) => {
        if (result.success) {
          successCount++;
          console.log(`✅ Customer ${result.customerId} imported successfully`);
        } else {
          errorCount++;
          errors.push(result.error);
          console.error(`❌ ${result.error}`);
        }
      });

      // Add a small delay between batches to prevent overwhelming the database
      if (i + batchSize < sheetData.length) {
        console.log(`⏳ Waiting 100ms before next batch...`);
        await new Promise((resolve) => setTimeout(resolve, 100));
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
  const batchSize = process.argv[2] ? parseInt(process.argv[2]) : 50;

  console.log(`🚀 Starting import with batch size: ${batchSize}`);

  await connectDB();
  await importCustomersFromExcel(batchSize);
  await mongoose.connection.close();
  console.log("🔌 Database connection closed");
}

main().catch(console.error);
