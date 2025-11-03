const jwt = require("jsonwebtoken");
const response_handler = require("../../helpers/response_handler");
const Admin = require("../../models/admin_model");
const key_protect = require("./key_protect");


const protect = async (req, res, next) => {
  // Call key_protect first
  key_protect(req, res, async (err) => {
    if (err) return; // If key_protect fails, it will already send a response

    try {
      //? Check for authorization header and extract token
      const authHeader = req.headers["authorization"];
      const jwtToken = authHeader && authHeader.split(" ")[1];
      if (!jwtToken) {
        return response_handler(res, 401, "No token provided.");
      }
      //? Verify JWT token
      const decoded = jwt.verify(jwtToken, process.env.JWT_SECRET);
      req.admin_id = decoded.admin_id;

      //? Find the user in the database
      const admin = await Admin.findById(req.admin_id);
      if (!admin) {
        return response_handler(res, 401, "Admin not found.");
      }

      req.admin = admin;
      next();
    } catch (error) {
      if (error.name === "JsonWebTokenError") {
        return response_handler(res, 403, "Invalid token.");
      }
      if (error.name === "TokenExpiredError") {
        return response_handler(res, 403, "Token has expired.");
      }
      return response_handler(res, 500, "Failed to authenticate token.");
    }
  });
};

module.exports = { protect };
