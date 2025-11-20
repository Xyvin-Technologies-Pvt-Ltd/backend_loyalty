/**
 * Migration Script: Convert Image Extensions to WebP
 * 
 * This script updates all image URLs in CouponBrand documents
 * to change file extensions from png/jpg/jpeg/gif to .webp
 * 
 * Usage:
 *   node migrate-images-to-webp.js              # Dry-run mode (default)
 *   node migrate-images-to-webp.js --execute    # Actually update the database
 */

const mongoose = require('mongoose');
const clc = require('cli-color');
const { connectDatabase, disconnectDatabase } = require('./src/config/database');
const CouponBrand = require('./src/models/coupon_brand_model');

// Check if --execute flag is provided
const isDryRun = !process.argv.includes('--execute');

// Image extensions to replace
const IMAGE_EXTENSIONS = /\.(png|jpg|jpeg|gif)$/i;

/**
 * Convert image URL extension to .webp
 * @param {string} imageUrl - Original image URL
 * @returns {string|null} - Updated URL with .webp extension, or null if no change needed
 */
function convertToWebp(imageUrl) {
    if (!imageUrl || typeof imageUrl !== 'string') {
        return null;
    }

    // Check if URL already has .webp extension
    if (imageUrl.toLowerCase().endsWith('.webp')) {
        return null;
    }

    // Check if URL has an image extension to replace
    if (!IMAGE_EXTENSIONS.test(imageUrl)) {
        return null;
    }

    // Replace extension with .webp
    return imageUrl.replace(IMAGE_EXTENSIONS, '.webp');
}

/**
 * Main migration function
 */
async function migrateImagesToWebp() {
    let stats = {
        total: 0,
        updated: 0,
        skipped: 0,
        errors: 0,
        changes: []
    };

    try {
        console.log(clc.cyanBright('\n🔄 Starting Image Extension Migration...\n'));

        if (isDryRun) {
            console.log(clc.yellowBright('⚠️  DRY-RUN MODE: No changes will be made to the database\n'));
        } else {
            console.log(clc.redBright('⚠️  EXECUTE MODE: Changes will be written to the database\n'));
        }

        // Connect to database
        console.log(clc.blueBright('📡 Connecting to database...'));
        await connectDatabase();
        console.log(clc.greenBright('✅ Database connected successfully\n'));

        // Fetch all CouponBrand documents
        console.log(clc.blueBright('📋 Fetching all CouponBrand documents...'));
        const documents = await CouponBrand.find({ image: { $exists: true, $ne: null } }).lean();
        stats.total = documents.length;
        console.log(clc.greenBright(`✅ Found ${stats.total} documents with image\n`));

        if (stats.total === 0) {
            console.log(clc.yellowBright('ℹ️  No documents to process. Exiting...\n'));
            await disconnectDatabase();
            return;
        }

        // Process documents in batches
        const BATCH_SIZE = 100;
        const bulkOps = [];

        console.log(clc.blueBright(`🔄 Processing documents in batches of ${BATCH_SIZE}...\n`));

        for (let i = 0; i < documents.length; i++) {
            const doc = documents[i];
            const originalUrl = doc.image;
            const newUrl = convertToWebp(originalUrl);

            if (newUrl === null) {
                stats.skipped++;
                continue;
            }

            // Track the change
            stats.changes.push({
                id: doc._id.toString(),
                old: originalUrl,
                new: newUrl
            });

            // Add to bulk operations
            bulkOps.push({
                updateOne: {
                    filter: { _id: doc._id },
                    update: { $set: { image: newUrl } }
                }
            });

            // Execute batch when it reaches BATCH_SIZE
            if (bulkOps.length >= BATCH_SIZE) {
                if (!isDryRun) {
                    try {
                        await CouponBrand.bulkWrite(bulkOps, { ordered: false });
                        stats.updated += bulkOps.length;
                        console.log(clc.greenBright(`✅ Updated batch: ${bulkOps.length} documents`));
                    } catch (error) {
                        stats.errors += bulkOps.length;
                        console.log(clc.redBright(`❌ Error updating batch: ${error.message}`));
                    }
                } else {
                    stats.updated += bulkOps.length;
                    console.log(clc.yellowBright(`🔍 Would update batch: ${bulkOps.length} documents (dry-run)`));
                }
                bulkOps.length = 0; // Clear the array
            }
        }

        // Execute remaining operations
        if (bulkOps.length > 0) {
            if (!isDryRun) {
                try {
                    await CouponBrand.bulkWrite(bulkOps, { ordered: false });
                    stats.updated += bulkOps.length;
                    console.log(clc.greenBright(`✅ Updated final batch: ${bulkOps.length} documents`));
                } catch (error) {
                    stats.errors += bulkOps.length;
                    console.log(clc.redBright(`❌ Error updating final batch: ${error.message}`));
                }
            } else {
                stats.updated += bulkOps.length;
                console.log(clc.yellowBright(`🔍 Would update final batch: ${bulkOps.length} documents (dry-run)`));
            }
        }

        // Display summary
        console.log(clc.cyanBright('\n' + '='.repeat(60)));
        console.log(clc.cyanBright('📊 MIGRATION SUMMARY'));
        console.log(clc.cyanBright('='.repeat(60)));
        console.log(clc.white(`Total documents processed: ${stats.total}`));
        console.log(clc.greenBright(`Documents to be updated: ${stats.updated}`));
        console.log(clc.yellowBright(`Documents skipped: ${stats.skipped}`));
        if (stats.errors > 0) {
            console.log(clc.redBright(`Errors encountered: ${stats.errors}`));
        }
        console.log(clc.cyanBright('='.repeat(60) + '\n'));

        // Show sample changes (first 10)
        if (stats.changes.length > 0) {
            console.log(clc.blueBright('📝 Sample Changes (first 10):\n'));
            stats.changes.slice(0, 10).forEach((change, index) => {
                console.log(clc.white(`${index + 1}. Document ID: ${change.id}`));
                console.log(clc.redBright(`   Old: ${change.old}`));
                console.log(clc.greenBright(`   New: ${change.new}\n`));
            });

            if (stats.changes.length > 10) {
                console.log(clc.yellowBright(`   ... and ${stats.changes.length - 10} more changes\n`));
            }
        }

        if (isDryRun && stats.updated > 0) {
            console.log(clc.yellowBright('💡 To apply these changes, run: node migrate-images-to-webp.js --execute\n'));
        }

    } catch (error) {
        console.error(clc.redBright('\n❌ Migration failed:'), error);
        stats.errors++;
        throw error;
    } finally {
        // Disconnect from database
        console.log(clc.blueBright('📡 Disconnecting from database...'));
        await disconnectDatabase();
        console.log(clc.greenBright('✅ Database disconnected\n'));
    }
}

// Run the migration
if (require.main === module) {
    migrateImagesToWebp()
        .then(() => {
            console.log(clc.greenBright('✨ Migration completed successfully!\n'));
            process.exit(0);
        })
        .catch((error) => {
            console.error(clc.redBright('\n💥 Migration failed with error:'), error);
            process.exit(1);
        });
}

module.exports = { migrateImagesToWebp, convertToWebp };

