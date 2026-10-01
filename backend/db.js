const path = require("path");
const { Pool } = require("pg");
require("dotenv").config({ path: path.resolve(__dirname, ".env") });

function buildPoolConfig(env = process.env) {
  const poolMax = Number(env.DB_POOL_MAX ?? 4);
  const idleTimeoutMillis = Number(env.DB_IDLE_TIMEOUT_MS ?? 15000);
  const connectionTimeoutMillis = Number(env.DB_CONNECTION_TIMEOUT_MS ?? 10000);
  const statementTimeout = Number(env.DB_STATEMENT_TIMEOUT_MS ?? 15000);

  return {
    user: env.DB_USER || "postgres",
    host: env.DB_HOST || "localhost",
    database: env.DB_NAME || "stocksite",
    port: Number(env.DB_PORT || 5432),
    ssl: false,
    max: Number.isFinite(poolMax) && poolMax > 0 ? poolMax : 4,
    idleTimeoutMillis: Number.isFinite(idleTimeoutMillis) && idleTimeoutMillis > 0 ? idleTimeoutMillis : 15000,
    connectionTimeoutMillis: Number.isFinite(connectionTimeoutMillis) && connectionTimeoutMillis > 0 ? connectionTimeoutMillis : 10000,
    statement_timeout: Number.isFinite(statementTimeout) && statementTimeout > 0 ? statementTimeout : 15000,
  };
}

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
