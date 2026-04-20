const multer = require("multer");
const path = require("path");
const fs = require("fs");
const fsp = require("fs").promises;
const { processImageToWebp } = require("../../helpers/image-processor");

// Get the appropriate upload path based on environment
function getUploadPath() {
  // Check if running in Docker container
  const isDocker = process.env.NODE_ENV !== "development";

  if (isDocker) {
    // Docker container path (will be mounted as volume in production)
    return "/app/uploads";
  } else {
    // Local development path (relative to project root)
    const localPath = path.join(process.cwd(), "uploads");
    console.log(`🏠 Local development detected, using: ${localPath}`);
    return localPath;
  }
}

function ensureUploadDir() {
  const uploadPath = getUploadPath();
  if (!fs.existsSync(uploadPath)) {
    fs.mkdirSync(uploadPath, { recursive: true });
    console.log(`📁 Created upload directory: ${uploadPath}`);
  }
  return uploadPath;
}

function buildUniqueFilename(fieldname, extension = "webp") {
  const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
  return `${fieldname}-${uniqueSuffix}.${extension}`;
}

function resolveServerAddress() {
  return (
    process.env.IMAGE_SERVER_URL ||
    (process.env.IMAGE_SERVER_ENV === "UAT"
      ? "http://141.105.172.45:7733"
      : "https://khedmahloyalty.oifcoman.com:3737")
  );
}

// File filter for images only
const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/gif",
    "image/webp",
  ];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(
      new Error(
        `Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed. Received: ${file.mimetype}`
      ),
      false
    );
  }
};

// Configure multer with memoryStorage so we can compress before writing to disk
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit for incoming raw upload
    fieldSize: 50 * 1024 * 1024,
  },
  fileFilter: fileFilter,
});

// Multiple upload configurations for flexibility
const uploadSingle = upload.single("photo"); // Primary field name
const uploadSingleFile = upload.single("file"); // Alternative field name
const uploadMultiple = upload.array("photos", 10); // Max 10 files

// Compress an in-memory uploaded file and persist it as .webp on disk.
// Returns the metadata the response needs.
async function compressAndSave(file, uploadPath) {
  const processed = await processImageToWebp(file.buffer);
  const filename = buildUniqueFilename(file.fieldname || "photo", processed.extension);
  const filePath = path.join(uploadPath, filename);
  await fsp.writeFile(filePath, processed.buffer);

  return {
    filename,
    path: filePath,
    size: processed.size,
    mimetype: processed.mimetype,
    originalName: file.originalname,
    originalMimetype: file.mimetype,
    originalSize: file.size,
  };
}

// Upload controller functions
const uploadController = {
  // Single photo upload with flexible field names
  uploadSinglePhoto: (req, res) => {
    // Try 'photo' field first
    uploadSingle(req, res, (err) => {
      if (err && err.code === "UNEXPECTED_FIELD") {
        console.log('📋 Field "photo" not found, trying "file" field...');

        // Try 'file' field as fallback
        uploadSingleFile(req, res, (err2) => {
          if (err2) {
            console.error(
              "❌ Upload error with both field names:",
              err2.message
            );
            return res.status(400).json({
              success: false,
              message: `Upload failed. Please use field name "photo" or "file" in your form data. Error: ${err2.message}`,
              error: "FIELD_NAME_ERROR",
              hint: 'In Postman: Body → form-data → Key should be "photo" or "file" → Type: File',
            });
          }

          handleSuccessfulUpload(req, res, "file");
        });
      } else if (err) {
        console.error("❌ Upload error:", err.message);
        return res.status(400).json({
          success: false,
          message: err.message,
          error: "UPLOAD_ERROR",
        });
      } else {
        handleSuccessfulUpload(req, res, "photo");
      }
    });
  },

  // Multiple photos upload
  uploadMultiplePhotos: (req, res) => {
    uploadMultiple(req, res, async (err) => {
      console.log(
        "📤 Multiple photos upload attempt:",
        req.files ? `${req.files.length} files` : "No files"
      );

      if (err) {
        console.error("❌ Upload error:", err.message);
        return res.status(400).json({
          success: false,
          message: err.message,
          error: "UPLOAD_ERROR",
          hint: 'For multiple files, use field name "photos" and select multiple files',
        });
      }

      if (!req.files || req.files.length === 0) {
        console.log("❌ No files uploaded");
        return res.status(400).json({
          success: false,
          message: "No files uploaded",
          error: "NO_FILES",
          hint: 'In Postman: Body → form-data → Key: "photos" → Type: File → Select multiple files',
        });
      }

      try {
        const uploadPath = ensureUploadDir();
        const serverAddress = resolveServerAddress();

        const processedFiles = await Promise.all(
          req.files.map((file) => compressAndSave(file, uploadPath))
        );

        const uploadedFiles = processedFiles.map((info) => {
          console.log(
            `✅ File compressed & saved: ${info.filename} (${info.originalSize} → ${info.size} bytes)`
          );
          return {
            filename: info.filename,
            originalName: info.originalName,
            size: info.size,
            mimetype: info.mimetype,
            url: `${serverAddress}/uploads/${info.filename}`,
            path: info.path,
          };
        });

        console.log(
          `✅ ${uploadedFiles.length} files uploaded successfully (compressed to webp)`
        );

        res.status(200).json({
          success: true,
          message: `${uploadedFiles.length} files uploaded successfully`,
          data: {
            files: uploadedFiles,
            count: uploadedFiles.length,
            uploadedAt: new Date().toISOString(),
          },
        });
      } catch (processingError) {
        console.error(
          "❌ Image processing/save error:",
          processingError.message
        );
        return res.status(400).json({
          success: false,
          message: `Image processing failed: ${processingError.message}`,
          error: "IMAGE_PROCESSING_ERROR",
        });
      }
    });
  },

  // Get upload status and directory info
  getUploadInfo: (req, res) => {
    try {
      const uploadPath = getUploadPath();
      const isDocker =
        fs.existsSync("/.dockerenv") || process.env.NODE_ENV !== "development";
      const exists = fs.existsSync(uploadPath);

      let fileCount = 0;
      let totalSize = 0;
      let files = [];

      if (exists) {
        files = fs.readdirSync(uploadPath);
        fileCount = files.length;

        files.forEach((file) => {
          const filePath = path.join(uploadPath, file);
          const stats = fs.statSync(filePath);
          totalSize += stats.size;
        });
      }

      res.status(200).json({
        success: true,
        data: {
          environment: isDocker ? "Docker Container" : "Local Development",
          uploadPath,
          directoryExists: exists,
          fileCount,
          totalSize: `${(totalSize / (1024 * 1024)).toFixed(2)} MB`,
          maxFileSize: "50 MB",
          allowedTypes: [
            "image/jpeg",
            "image/jpg",
            "image/png",
            "image/gif",
            "image/webp",
          ],
          storedAs: "image/webp (compressed)",
          maxFiles: 10,
          acceptedFieldNames: {
            single: ["photo", "file"],
            multiple: ["photos"],
          },
          recentFiles: files.slice(-5), // Show last 5 files
        },
      });
    } catch (error) {
      console.error("❌ Error getting upload info:", error);
      res.status(500).json({
        success: false,
        message: "Error retrieving upload information",
        error: error.message,
      });
    }
  },
};

// Helper function to handle successful single uploads
async function handleSuccessfulUpload(req, res, fieldUsed) {
  console.log(
    `📤 Single photo upload attempt with field "${fieldUsed}":`,
    req.file ? "File received" : "No file"
  );

  if (!req.file) {
    console.log("❌ No file uploaded");
    return res.status(400).json({
      success: false,
      message: "No file uploaded",
      error: "NO_FILE",
      hint: `File was expected in field "${fieldUsed}"`,
    });
  }

  try {
    const uploadPath = ensureUploadDir();
    console.log(`📁 Upload directory: ${uploadPath}`);

    const info = await compressAndSave(req.file, uploadPath);
    const serverAddress = resolveServerAddress();
    const fileUrl = `${serverAddress}/uploads/${info.filename}`;

    console.log(
      `✅ Compressed & saved: ${info.filename} (${info.originalSize} → ${info.size} bytes) ${fileUrl}`
    );

    return res.status(200).json({
      success: true,
      message: "File uploaded successfully",
      data: {
        url: fileUrl,
      },
    });
  } catch (processingError) {
    console.error("❌ Image processing/save error:", processingError.message);
    return res.status(400).json({
      success: false,
      message: `Image processing failed: ${processingError.message}`,
      error: "IMAGE_PROCESSING_ERROR",
    });
  }
}

module.exports = uploadController;
