require("dotenv").config();
const mongoose = require("mongoose");
const AppType = require("./src/models/app_type_model"); 

const OLD_DOMAIN = "http://api-uat-loyalty.xyvin.com";
const NEW_DOMAIN = "https://khedmahloyalty.oifcoman.com:3737";

async function replaceImageUrls() {
  try {
    // Connect to MongoDB

    // Find all merchant offers that have the old domain in posterImage
    const offers = await AppType.find({
      icon: { $regex: OLD_DOMAIN },
    });

    console.log(`Found ${offers.length} merchant offers to update`);

    if (offers.length === 0) {
      console.log("No offers to update. Exiting...");
      await mongoose.connection.close();
      return;
    }

    let updatedCount = 0;

    // Update each offer
    for (const offer of offers) {
      const oldUrl = offer.icon;   
      const newUrl = oldUrl.replace(OLD_DOMAIN, NEW_DOMAIN);

      offer.icon = newUrl;
      await offer.save();

      updatedCount++;
      console.log(`Updated offer ${offer._id}: ${oldUrl} -> ${newUrl}`);
    }

    console.log(`\n✅ Successfully updated ${updatedCount} merchant offers!`);

    // Close connection
    await mongoose.connection.close();
    console.log("MongoDB connection closed.");
  } catch (error) {
    console.error("Error updating image URLs:", error);
    process.exit(1);
  }
}

// Run the function
module.exports = replaceImageUrls;



