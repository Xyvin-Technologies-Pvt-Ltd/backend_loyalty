require("dotenv").config();
const express = require("express");
const cors = require("cors");
const volleyball = require("volleyball");
const clc = require("cli-color");

//! Create an instance of the Express application
const app = express();
//* Define the PORT & API version based on environment variable
const { PORT, API_VERSION, NODE_ENV } = process.env;
//* Use volleyball for request logging
app.use(volleyball);
//* Enable Cross-Origin Resource Sharing (CORS) middleware
app.use(cors());
//* Parse JSON request bodies
app.use(express.json());
//* Set the base path for API routes
const BASE_PATH = `/api/${API_VERSION}`;

app.listen(PORT, () => {
  const port_message = clc.redBright(`✓ App is running on port: ${PORT}`);
  const env_message = clc.yellowBright(
    `✓ Environment: ${NODE_ENV || "development"}`
  );
  const status_message = clc.greenBright(
    "✓ Server is up and running smoothly 🚀"
  );

  console.log(`${port_message}\n${env_message}\n${status_message}`);
});
