const multer = require("multer");
const path = require("path");
const fs = require("fs");

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

// Configure multer for file upload
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadPath = getUploadPath();

    // Ensure directory exists
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
      console.log(`📁 Created upload directory: ${uploadPath}`);
    }

    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    // Generate unique filename with timestamp and random suffix
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const fileExtension = path.extname(file.originalname);
    const filename = file.fieldname + "-" + uniqueSuffix + fileExtension;

    cb(null, filename);
  },
});

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

// Configure multer
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // Increased to 50MB limit (matching Express body parser)
    fieldSize: 50 * 1024 * 1024, // Field size limit
  },
  fileFilter: fileFilter,
});

// Multiple upload configurations for flexibility
const uploadSingle = upload.single("photo"); // Primary field name
const uploadSingleFile = upload.single("file"); // Alternative field name
const uploadMultiple = upload.array("photos", 10); // Increased to max 10 files

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

          // Handle successful upload with 'file' field
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
        // Handle successful upload with 'photo' field
        handleSuccessfulUpload(req, res, "photo");
      }
    });
  },

  // Multiple photos upload
  uploadMultiplePhotos: (req, res) => {
    uploadMultiple(req, res, (err) => {
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

      // Files uploaded successfully
      const uploadedFiles = req.files.map((file) => {
        console.log(`✅ File uploaded: ${file.filename}`);
        return {
          filename: file.filename,
          originalName: file.originalname,
          size: file.size,
          mimetype: file.mimetype,
          url: `/uploads/${file.filename}`,
          path: file.path,
        };
      });

      console.log(`✅ ${uploadedFiles.length} files uploaded successfully`);

      res.status(200).json({
        success: true,
        message: `${uploadedFiles.length} files uploaded successfully`,
        data: {
          files: uploadedFiles,
          count: uploadedFiles.length,
          uploadedAt: new Date().toISOString(),
        },
      });
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

// Helper function to handle successful uploads
function handleSuccessfulUpload(req, res, fieldUsed) {
  const uploadPath = getUploadPath();
  console.log(
    `📤 Single photo upload attempt with field "${fieldUsed}":`,
    req.file ? "File received" : "No file"
  );
  console.log(`📁 Upload directory: ${uploadPath}`);

  if (!req.file) {
    console.log("❌ No file uploaded");
    return res.status(400).json({
      success: false,
      message: "No file uploaded",
      error: "NO_FILE",
      hint: `File was expected in field "${fieldUsed}"`,
    });
  }

  // File uploaded successfully
  //find server adddress and add server address to the url
  let serverAddress = ''
  if(process.env.IMAGE_SERVER_ENV === 'UAT'){
    serverAddress = 'http://http://141.105.172.45:7733'
  }else {
    serverAddress = 'https://khedmahloyalty.oifcoman.com:3737'
  }

  const fileUrl = serverAddress + `/uploads/${req.file.filename}`;
  console.log(fileUrl);

  res.status(200).json({
    success: true,
    message: "File uploaded successfully",
    data: {
      url: fileUrl,
    },
  });
}

module.exports = uploadController;
