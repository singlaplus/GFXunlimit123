const path = require("path");
const { Pool } = require("pg");
require("dotenv").config({ path: path.resolve(__dirname, ".env") });

const poolConfig = {
  user: process.env.DB_USER || "postgres",
  host: process.env.DB_HOST || "localhost",
  database: process.env.DB_NAME || "stocksite",
  port: Number(process.env.DB_PORT || 5432),
  ssl: false,
  connectionTimeoutMillis: Number(process.env.DB_CONNECTION_TIMEOUT_MS || 10000),
  statement_timeout: Number(process.env.DB_STATEMENT_TIMEOUT_MS || 15000),
};

// Use the configured local database credential when one is provided.
const configuredPassword = process.env.DB_PASSWORD?.trim();
if (configuredPassword) {
  poolConfig.password = configuredPassword;
}

const pool = new Pool(poolConfig);
pool.connect()
  .then(client => {
    console.log("✅ PostgreSQL connected successfully");
    client.release();
  })
  .catch(err => {
    console.log("❌ PostgreSQL connection error:");
    console.log(err.message);
  });
module.exports = pool;
