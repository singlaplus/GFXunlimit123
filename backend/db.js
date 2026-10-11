const path = require("path");
const { Pool } = require("pg");
const { buildPoolConfig } = require("./dbPoolConfig");
require("dotenv").config({ path: path.resolve(__dirname, ".env") });

const poolConfig = buildPoolConfig();

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
module.exports.buildPoolConfig = buildPoolConfig;
