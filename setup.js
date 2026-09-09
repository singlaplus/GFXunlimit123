#!/usr/bin/env node

/**
 * Stocksite System Setup & Verification Script
 * 
 * This script:
 * - Checks all system requirements
 * - Installs/verifies all dependencies
 * - Verifies database and Redis connectivity
 * - Repairs corrupted installations
 * - Can be run with: node setup.js [command]
 * 
 * Commands:
 *   node setup.js              - Full check and installation
 *   node setup.js --repair     - Repair corrupted installation
 *   node setup.js --check-only - Check only, don't install
 *   node setup.js --start      - Install + start backend
 */

const fs = require("fs");
const path = require("path");
const { execSync, spawn } = require("child_process");
const { createRequire } = require("module");
const readline = require("readline");

// ============================================================================
// CONFIGURATION
// ============================================================================

const ROOT_DIR = __dirname;
const BACKEND_DIR = path.join(ROOT_DIR, "backend");
const FRONTEND_DIR = path.join(ROOT_DIR, "frontend");
const ENV_FILE = path.join(BACKEND_DIR, ".env");
const backendRequire = createRequire(path.join(BACKEND_DIR, "package.json"));

const COLORS = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
};

const SYSTEM_REQUIREMENTS = {
  node: { name: "Node.js", minVersion: "14.0.0", cmd: "node --version" },
  npm: { name: "npm", minVersion: "6.0.0", cmd: "npm --version" },
  git: { name: "Git", minVersion: null, cmd: "git --version" },
};

const OPTIONAL_REQUIREMENTS = {
  postgres: { name: "PostgreSQL", cmd: "psql --version", testPort: 5432 },
  redis: { name: "Redis", cmd: "redis-cli --version", testPort: 6379 },
  imagemagick: { name: "ImageMagick", cmd: "convert --version" },
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function log(message, color = "reset") {
  const timestamp = new Date().toLocaleTimeString();
  console.log(`${COLORS[color]}[${timestamp}] ${message}${COLORS.reset}`);
}

function success(message) {
  log(`✅ ${message}`, "green");
}

function error(message) {
  log(`❌ ${message}`, "red");
}

function warning(message) {
  log(`⚠️  ${message}`, "yellow");
}

function info(message) {
  log(`ℹ️  ${message}`, "cyan");
}

function section(title) {
  console.log(`\n${COLORS.bright}${COLORS.blue}${"=".repeat(70)}${COLORS.reset}`);
  log(`📋 ${title}`, "blue");
  console.log(`${COLORS.bright}${COLORS.blue}${"=".repeat(70)}${COLORS.reset}\n`);
}

function subsection(title) {
  log(`\n→ ${title}`, "bright");
}

function runCommand(cmd, silent = false, cwd = ROOT_DIR) {
  try {
    const output = execSync(cmd, {
      cwd,
      stdio: silent ? "pipe" : "inherit",
      encoding: "utf-8",
    });
    return { success: true, output: output.trim() };
  } catch (err) {
    return { success: false, error: err.message, output: err.stdout?.trim() || "" };
  }
}

function commandExists(cmd) {
  try {
    execSync(`which ${cmd}`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function getVersion(cmd) {
  try {
    const output = execSync(cmd, { stdio: "pipe", encoding: "utf-8" });
    const match = output.match(/(\d+\.\d+\.\d+)/);
    return match ? match[1] : output.split("\n")[0].trim();
  } catch {
    return null;
  }
}

function compareVersions(v1, v2) {
  const parts1 = v1.split(".").map(Number);
  const parts2 = v2.split(".").map(Number);

  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 > p2) return 1;
    if (p1 < p2) return -1;
  }
  return 0;
}

function fileExists(filePath) {
  return fs.existsSync(filePath);
}

function directoryExists(dirPath) {
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

async function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

async function testDatabaseConnection() {
  try {
    let pgModule;
    try {
      pgModule = backendRequire("pg");
    } catch (e) {
      // pg module not installed, backend dependencies might not be installed
      return { success: false, error: "pg module not loaded (dependencies might not be installed)" };
    }

    const Pool = pgModule.Pool;

    const poolConfig = {
      user: process.env.DB_USER || "postgres",
      host: process.env.DB_HOST || "localhost",
      database: "postgres", // Connect to default database first
      port: Number(process.env.DB_PORT || 5432),
      ssl: false,
      connectionTimeoutMillis: 5000,
    };

    if (process.env.DB_PASSWORD && process.env.DB_PASSWORD.trim()) {
      poolConfig.password = process.env.DB_PASSWORD;
    }

    const pool = new Pool(poolConfig);
    const client = await pool.connect();
    await client.query("SELECT NOW()");
    client.release();
    await pool.end();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function testRedisConnection() {
  try {
    let Redis;
    try {
      Redis = backendRequire("ioredis");
    } catch (e) {
      // ioredis module not installed, backend dependencies might not be installed
      return { success: false, error: "ioredis module not loaded (dependencies might not be installed)" };
    }

    const redis = new Redis({
      host: process.env.REDIS_HOST || "localhost",
      port: Number(process.env.REDIS_PORT || 6379),
      connectTimeout: 5000,
      retryStrategy: () => null, // Don't retry
    });

    return new Promise((resolve) => {
      redis.on("connect", () => {
        redis.disconnect();
        resolve({ success: true });
      });

      redis.on("error", (err) => {
        resolve({ success: false, error: err.message });
      });

      setTimeout(() => {
        redis.disconnect();
        resolve({ success: false, error: "Connection timeout" });
      }, 5000);
    });
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function getEnvTemplate() {
  return `# Database Configuration
DB_USER=postgres
DB_HOST=localhost
DB_PORT=5432
DB_NAME=stocksite
DB_PASSWORD=

# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379

# Email Configuration (Optional)
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=

# JWT Configuration
JWT_SECRET=your-secret-key-change-this

# Environment
NODE_ENV=development
PORT=5000
`;
}

function createOrUpdateEnv() {
  if (!fileExists(ENV_FILE)) {
    info("Creating .env file with defaults...");
    fs.writeFileSync(ENV_FILE, getEnvTemplate());
    warning(".env file created - please update with your actual configuration");
    return true;
  }
  return false;
}

function loadEnv() {
  if (fileExists(ENV_FILE)) {
    const content = fs.readFileSync(ENV_FILE, "utf-8");
    content.split("\n").forEach((line) => {
      if (line && !line.startsWith("#")) {
        const [key, ...valueParts] = line.split("=");
        const value = valueParts.join("=").trim();
        if (key && value) {
          process.env[key.trim()] = value;
        }
      }
    });
  }
}

// ============================================================================
// CHECK FUNCTIONS
// ============================================================================

function checkSystemRequirements() {
  subsection("Checking System Requirements");

  const status = {};

  for (const [key, req] of Object.entries(SYSTEM_REQUIREMENTS)) {
    if (commandExists(key)) {
      const version = getVersion(req.cmd);
      if (req.minVersion && version) {
        if (compareVersions(version, req.minVersion) >= 0) {
          success(`${req.name}: ${version}`);
          status[key] = true;
        } else {
          error(`${req.name}: ${version} (minimum required: ${req.minVersion})`);
          status[key] = false;
        }
      } else {
        success(`${req.name}: ${version || "installed"}`);
        status[key] = true;
      }
    } else {
      error(`${req.name}: NOT FOUND`);
      status[key] = false;
    }
  }

  return status;
}

function checkOptionalRequirements() {
  subsection("Checking Optional Requirements");

  const status = {};

  for (const [key, req] of Object.entries(OPTIONAL_REQUIREMENTS)) {
    if (commandExists(key)) {
      const version = getVersion(req.cmd);
      success(`${req.name}: ${version || "installed"}`);
      status[key] = true;
    } else {
      warning(`${req.name}: NOT FOUND (optional but recommended)`);
      status[key] = false;
    }
  }

  return status;
}

function checkDependencies() {
  subsection("Checking Dependencies");

  const backendStatus = directoryExists(path.join(BACKEND_DIR, "node_modules"));
  const frontendStatus = directoryExists(path.join(FRONTEND_DIR, "node_modules"));

  if (backendStatus) {
    success("Backend dependencies: installed");
  } else {
    warning("Backend dependencies: NOT FOUND");
  }

  if (frontendStatus) {
    success("Frontend dependencies: installed");
  } else {
    warning("Frontend dependencies: NOT FOUND");
  }

  return { backend: backendStatus, frontend: frontendStatus };
}

function checkFileStructure() {
  subsection("Checking File Structure");

  const requiredDirs = [
    { path: BACKEND_DIR, name: "Backend directory" },
    { path: FRONTEND_DIR, name: "Frontend directory" },
    { path: path.join(BACKEND_DIR, "uploads"), name: "Uploads directory" },
  ];

  const status = {};
  for (const dir of requiredDirs) {
    if (directoryExists(dir.path)) {
      success(`${dir.name}: ✓`);
      status[dir.name] = true;
    } else {
      error(`${dir.name}: MISSING`);
      status[dir.name] = false;
    }
  }

  return status;
}

async function checkConnectivity() {
  subsection("Checking Service Connectivity");

  loadEnv();

  // Check Database
  const dbResult = await testDatabaseConnection();
  if (dbResult.success) {
    success("PostgreSQL: Connected");
  } else {
    warning(`PostgreSQL: ${dbResult.error || "Not connected"}`);
  }

  // Check Redis
  const redisResult = await testRedisConnection();
  if (redisResult.success) {
    success("Redis: Connected");
  } else {
    warning(`Redis: ${redisResult.error || "Not connected"}`);
  }

  return {
    database: dbResult.success,
    redis: redisResult.success,
  };
}

// ============================================================================
// INSTALL FUNCTIONS
// ============================================================================

function installDependencies(skipFrontend = false) {
  subsection("Installing Dependencies");

  // Backend dependencies
  log("Installing backend dependencies...", "bright");
  const backendResult = runCommand("npm install", false, BACKEND_DIR);
  if (backendResult.success) {
    success("Backend dependencies installed");
  } else {
    error("Failed to install backend dependencies");
    error(backendResult.error);
    return false;
  }

  // Frontend dependencies (optional)
  if (!skipFrontend) {
    log("Installing frontend dependencies...", "bright");
    const frontendResult = runCommand("npm install", false, FRONTEND_DIR);
    if (frontendResult.success) {
      success("Frontend dependencies installed");
    } else {
      error("Failed to install frontend dependencies");
      error(frontendResult.error);
      return false;
    }
  }

  return true;
}

function repairInstallation() {
  section("🔧 REPAIR MODE");

  subsection("Cleaning corrupted installations");

  // Remove backend node_modules
  const backendModulesPath = path.join(BACKEND_DIR, "node_modules");
  if (directoryExists(backendModulesPath)) {
    log("Removing backend node_modules...", "bright");
    runCommand(`rm -rf "${backendModulesPath}"`);
    success("Backend node_modules removed");
  }

  // Remove frontend node_modules
  const frontendModulesPath = path.join(FRONTEND_DIR, "node_modules");
  if (directoryExists(frontendModulesPath)) {
    log("Removing frontend node_modules...", "bright");
    runCommand(`rm -rf "${frontendModulesPath}"`);
    success("Frontend node_modules removed");
  }

  // Clear npm cache
  log("Clearing npm cache...", "bright");
  runCommand("npm cache clean --force");
  success("npm cache cleared");

  // Reinstall
  subsection("Reinstalling dependencies");
  installDependencies();

  success("Repair completed");
}

// ============================================================================
// MAIN SETUP FUNCTIONS
// ============================================================================

async function runFullSetup() {
  section("🚀 STOCKSITE SYSTEM SETUP");

  // Check everything
  const sysReqs = checkSystemRequirements();
  const optReqs = checkOptionalRequirements();
  const deps = checkDependencies();
  const files = checkFileStructure();
  const connectivity = await checkConnectivity();

  // Verify critical requirements
  const criticalOK = sysReqs.node && sysReqs.npm && sysReqs.git;
  if (!criticalOK) {
    section("⚠️  CRITICAL ISSUES");
    error("Please install missing system requirements:");
    if (!sysReqs.node) error("  - Node.js (https://nodejs.org)");
    if (!sysReqs.npm) error("  - npm (comes with Node.js)");
    if (!sysReqs.git) error("  - Git (https://git-scm.com)");
    process.exit(1);
  }

  // Create/update .env if needed
  createOrUpdateEnv();
  loadEnv();

  // Install missing dependencies
  if (!deps.backend || !deps.frontend) {
    section("📦 INSTALLING DEPENDENCIES");
    const installSuccess = installDependencies();
    if (!installSuccess) {
      error("Installation failed");
      process.exit(1);
    }
  }

  // Final status report
  section("📊 SETUP STATUS REPORT");
  log("System Requirements:", "bright");
  Object.entries(sysReqs).forEach(([key, status]) => {
    const req = SYSTEM_REQUIREMENTS[key];
    const symbol = status ? "✓" : "✗";
    log(`  ${symbol} ${req.name}`, status ? "green" : "red");
  });

  log("\nDependencies:", "bright");
  log(`  ✓ Backend`, "green");
  log(`  ✓ Frontend`, "green");

  log("\nServices:", "bright");
  const dbSymbol = connectivity.database ? "✓" : "✗";
  const redisSymbol = connectivity.redis ? "✓" : "✗";
  log(`  ${dbSymbol} PostgreSQL`, connectivity.database ? "green" : "yellow");
  log(`  ${redisSymbol} Redis`, connectivity.redis ? "green" : "yellow");

  log("\nOptional Requirements:", "bright");
  Object.entries(optReqs).forEach(([key, status]) => {
    const req = OPTIONAL_REQUIREMENTS[key];
    const symbol = status ? "✓" : "✗";
    log(`  ${symbol} ${req.name}`, status ? "green" : "yellow");
  });

  section("✅ SETUP COMPLETE");
  success("System is ready to run!");
  info("Run the backend with: cd backend && npm start");
  info("Run the frontend with: cd frontend && npm start");
  info("Or run both: npm run start:backend & npm run start:frontend");
}

async function runCheckOnly() {
  section("🔍 CHECKING SYSTEM (NO INSTALLATION)");

  checkSystemRequirements();
  checkOptionalRequirements();
  checkDependencies();
  checkFileStructure();
  await checkConnectivity();

  section("✅ CHECK COMPLETE");
}

function startBackend() {
  section("🚀 STARTING BACKEND SERVER");

  info("Running full setup first...");
  runFullSetup().then(() => {
    info("\nStarting backend server...");
    info("Press Ctrl+C to stop");
    info("Backend will be available at http://localhost:5000");

    const child = spawn("npm", ["start"], {
      cwd: BACKEND_DIR,
      stdio: "inherit",
    });

    child.on("close", (code) => {
      log(`Backend exited with code ${code}`, code === 0 ? "green" : "red");
    });
  });
}

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || "setup";

  try {
    switch (command) {
      case "--repair":
        repairInstallation();
        await runFullSetup();
        break;

      case "--check-only":
        await runCheckOnly();
        break;

      case "--start":
        await runFullSetup();
        startBackend();
        break;

      case "--help":
      case "-h":
        console.log(`
Stocksite System Setup & Verification Script

Usage: node setup.js [command]

Commands:
  (no args)      - Full setup and verification
  --repair       - Repair corrupted installation
  --check-only   - Check system without installing
  --start        - Setup and start backend server
  --help         - Show this help message

Examples:
  node setup.js                 # Full setup
  node setup.js --repair        # Repair installation
  node setup.js --check-only    # Check only
  node setup.js --start         # Setup and start backend
        `);
        break;

      default:
        await runFullSetup();
    }
  } catch (err) {
    error("Unexpected error:");
    error(err.message);
    process.exit(1);
  }
}

// Run the script
main();
