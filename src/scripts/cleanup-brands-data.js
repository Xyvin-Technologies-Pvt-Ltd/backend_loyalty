/**
 * Data Cleanup Script for iOS 26 Compatibility
 * Removes control characters, null bytes, and invalid data from brands and categories
 * Run this script to fix corrupted data that causes white screens on iOS 26
 */

const mongoose = require("mongoose");
require("dotenv").config();

const CouponBrand = require("../models/coupon_brand_model");
const CouponCategory = require("../models/coupon_category_model");
const CouponCode = require("../models/merchant_offers.model");

/**
 * Sanitize string by removing control characters
 */
const sanitizeString = (str) => {
    if (!str || typeof str !== "string") {
        return "";
    }

    return str
        .replace(/\0/g, "") // Null bytes
        .replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F-\x9F]/g, "") // Control characters
        .trim();
};

/**
 * Sanitize and validate URL
 */
const sanitizeUrl = (url) => {
    if (!url || typeof url !== "string") {
        return null;
    }

    let cleaned = url
        .replace(/\0/g, "")
        .replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F-\x9F]/g, "")
        .trim();

    if (!cleaned) {
        return null;
    }

    // Check if it's a valid URL
    if (!cleaned.startsWith("http://") && !cleaned.startsWith("https://")) {
        return null;
    }

    // Check for whitespace
    if (cleaned.includes(" ") || cleaned.includes("\n") || cleaned.includes("\r")) {
        return null;
    }

    return cleaned;
};

/**
 * Clean up brands data
 */
const cleanupBrands = async () => {
    console.log("\n🧹 Starting brands cleanup...");

    const brands = await CouponBrand.find({});
    let fixedCount = 0;
    let invalidCount = 0;

    for (const brand of brands) {
        let needsUpdate = false;
        const updates = {};

        // Check and fix title.en
        if (!brand.title?.en || brand.title.en.trim() === "") {
            updates["title.en"] = "Untitled Brand";
            needsUpdate = true;
            console.log(`  ⚠️  Missing title.en for brand ${brand._id}`);
        } else {
            const cleaned = sanitizeString(brand.title.en);
            if (cleaned !== brand.title.en) {
                updates["title.en"] = cleaned;
                needsUpdate = true;
                console.log(`  🧼 Cleaned title.en for brand ${brand._id}`);
            }
        }

        // Check and fix title.ar
        if (!brand.title?.ar || brand.title.ar.trim() === "") {
            updates["title.ar"] = "علامة تجارية بدون عنوان";
            needsUpdate = true;
        } else {
            const cleaned = sanitizeString(brand.title.ar);
            if (cleaned !== brand.title.ar) {
                updates["title.ar"] = cleaned;
                needsUpdate = true;
            }
        }

        // Fix descriptions
        if (brand.description?.en) {
            const cleaned = sanitizeString(brand.description.en);
            if (cleaned !== brand.description.en) {
                updates["description.en"] = cleaned;
                needsUpdate = true;
            }
        }

        if (brand.description?.ar) {
            const cleaned = sanitizeString(brand.description.ar);
            if (cleaned !== brand.description.ar) {
                updates["description.ar"] = cleaned;
                needsUpdate = true;
            }
        }

        // Fix/validate images
        if (brand.image) {
            const cleaned = sanitizeUrl(brand.image);
            if (cleaned === null) {
                updates.image = null;
                needsUpdate = true;
                invalidCount++;
                console.log(`  ❌ Invalid image URL for brand ${brand._id}: ${brand.image.substring(0, 50)}...`);
            } else if (cleaned !== brand.image) {
                updates.image = cleaned;
                needsUpdate = true;
                console.log(`  🧼 Cleaned image URL for brand ${brand._id}`);
            }
        }

        if (needsUpdate) {
            await CouponBrand.findByIdAndUpdate(brand._id, updates);
            fixedCount++;
        }
    }

    console.log(`✅ Brands cleanup complete!`);
    console.log(`   - Total brands: ${brands.length}`);
    console.log(`   - Fixed: ${fixedCount}`);
    console.log(`   - Invalid images removed: ${invalidCount}`);
};

/**
 * Clean up categories data
 */
const cleanupCategories = async () => {
    console.log("\n🧹 Starting categories cleanup...");

    const categories = await CouponCategory.find({});
    let fixedCount = 0;
    let invalidCount = 0;

    for (const category of categories) {
        let needsUpdate = false;
        const updates = {};

        // Check and fix title.en
        if (!category.title?.en || category.title.en.trim() === "") {
            updates["title.en"] = "Untitled Category";
            needsUpdate = true;
            console.log(`  ⚠️  Missing title.en for category ${category._id}`);
        } else {
            const cleaned = sanitizeString(category.title.en);
            if (cleaned !== category.title.en) {
                updates["title.en"] = cleaned;
                needsUpdate = true;
            }
        }

        // Check and fix title.ar
        if (!category.title?.ar || category.title.ar.trim() === "") {
            updates["title.ar"] = "فئة بدون عنوان";
            needsUpdate = true;
        } else {
            const cleaned = sanitizeString(category.title.ar);
            if (cleaned !== category.title.ar) {
                updates["title.ar"] = cleaned;
                needsUpdate = true;
            }
        }

        // Fix descriptions
        if (category.description?.en) {
            const cleaned = sanitizeString(category.description.en);
            if (cleaned !== category.description.en) {
                updates["description.en"] = cleaned;
                needsUpdate = true;
            }
        }

        if (category.description?.ar) {
            const cleaned = sanitizeString(category.description.ar);
            if (cleaned !== category.description.ar) {
                updates["description.ar"] = cleaned;
                needsUpdate = true;
            }
        }

        // Fix/validate images
        if (category.image) {
            const cleaned = sanitizeUrl(category.image);
            if (cleaned === null) {
                updates.image = null;
                needsUpdate = true;
                invalidCount++;
                console.log(`  ❌ Invalid image URL for category ${category._id}`);
            } else if (cleaned !== category.image) {
                updates.image = cleaned;
                needsUpdate = true;
            }
        }

        if (needsUpdate) {
            await CouponCategory.findByIdAndUpdate(category._id, updates);
            fixedCount++;
        }
    }

    console.log(`✅ Categories cleanup complete!`);
    console.log(`   - Total categories: ${categories.length}`);
    console.log(`   - Fixed: ${fixedCount}`);
    console.log(`   - Invalid images removed: ${invalidCount}`);
};

/**
 * Find problematic data
 */
const findProblematicData = async () => {
    console.log("\n🔍 Scanning for problematic data...\n");

    // Check brands
    const brandsWithIssues = await CouponBrand.find({
        $or: [
            { "title.en": { $in: [null, ""] } },
            { "title.en": /[\x00-\x08\x0B-\x0C\x0E-\x1F]/ },
            { "title.ar": { $in: [null, ""] } },
            { image: /[\x00-\x08\x0B-\x0C\x0E-\x1F]/ },
        ],
    });

    if (brandsWithIssues.length > 0) {
        console.log(`⚠️  Found ${brandsWithIssues.length} brands with issues:`);
        brandsWithIssues.forEach((brand) => {
            console.log(`   - ${brand._id}: ${brand.title?.en || "NO TITLE"}`);
        });
    } else {
        console.log(`✅ No problematic brands found`);
    }

    // Check categories
    const categoriesWithIssues = await CouponCategory.find({
        $or: [
            { "title.en": { $in: [null, ""] } },
            { "title.en": /[\x00-\x08\x0B-\x0C\x0E-\x1F]/ },
            { "title.ar": { $in: [null, ""] } },
            { image: /[\x00-\x08\x0B-\x0C\x0E-\x1F]/ },
        ],
    });

    if (categoriesWithIssues.length > 0) {
        console.log(`\n⚠️  Found ${categoriesWithIssues.length} categories with issues:`);
        categoriesWithIssues.forEach((category) => {
            console.log(`   - ${category._id}: ${category.title?.en || "NO TITLE"}`);
        });
    } else {
        console.log(`✅ No problematic categories found`);
    }
};

/**
 * Main cleanup function
 */
const runCleanup = async () => {
    try {
        console.log("🚀 iOS 26 Data Cleanup Script");
        console.log("=".repeat(50));

        // Connect to MongoDB
        await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
        console.log("✅ Connected to MongoDB");

        // Find issues first
        await findProblematicData();

        // Ask for confirmation
        console.log("\n⚠️  This will modify your database!");
        console.log("Press Ctrl+C to cancel, or wait 5 seconds to continue...\n");

        await new Promise((resolve) => setTimeout(resolve, 5000));

        // Run cleanup
        await cleanupBrands();
        await cleanupCategories();

        console.log("\n" + "=".repeat(50));
        console.log("🎉 Cleanup completed successfully!");
        console.log("\n✅ Your data is now iOS 26 compatible");
        console.log("   - All control characters removed");
        console.log("   - Invalid URLs cleaned");
        console.log("   - Missing titles filled with defaults");

        process.exit(0);
    } catch (error) {
        console.error("\n❌ Cleanup failed:", error.message);
        console.error(error.stack);
        process.exit(1);
    }
};

// Run the cleanup
runCleanup();

