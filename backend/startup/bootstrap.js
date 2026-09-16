const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const readline = require('readline');

const BACKEND_DIR = path.resolve(__dirname, '..');
const STARTUP_LOG_DIR = path.join(BACKEND_DIR, 'startup');
const STARTUP_LOG_FILE = path.join(STARTUP_LOG_DIR, 'bootstrap.log');

const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[36m',
};

function colorize(text, color) {
  return `${color}${text}${COLORS.reset}`;
}

const WINDOWS_TOOL_PATHS = {
  ghostscript: [
    'C:\\Program Files\\gs\\gs10.01.2\\bin\\gswin64c.exe',
    'C:\\Program Files\\gs\\gs10.00.0\\bin\\gswin64c.exe',
    'C:\\Program Files (x86)\\gs\\gs10.01.2\\bin\\gswin64c.exe',
    'C:\\Program Files (x86)\\gs\\gs10.00.0\\bin\\gswin64c.exe',
  ],
  imagemagick: [
    'C:\\Program Files\\ImageMagick-7.1.1-Q16-HDRI\\magick.exe',
    'C:\\Program Files\\ImageMagick-7.1.0-Q16-HDRI\\magick.exe',
    'C:\\Program Files (x86)\\ImageMagick-7.1.1-Q16-HDRI\\magick.exe',
    'C:\\Program Files (x86)\\ImageMagick-7.1.0-Q16-HDRI\\magick.exe',
  ],
};

const PLATFORM_INSTALL_COMMANDS = {
  darwin: {
    ghostscript: 'brew install ghostscript',
    imagemagick: 'brew install imagemagick',
    postgresql: 'brew install postgresql@15',
    redis: 'brew install redis',
  },
  linux: {
    ghostscript: 'sudo apt-get install -y ghostscript',
    imagemagick: 'sudo apt-get install -y imagemagick',
    postgresql: 'sudo apt-get install -y postgresql postgresql-contrib',
    redis: 'sudo apt-get install -y redis-server',
  },
  win32: {
    ghostscript: 'winget install --id ArtifexSoftware.GhostScript -e',
    imagemagick: 'winget install --id ImageMagick.ImageMagick -e',
    postgresql: 'winget install --id PostgreSQL.PostgreSQL -e',
    redis: 'winget install --id Microsoft.OpenJDK.17 -e && winget install --id tporadowski.redis -e',
  },
};

function ensureLogDirectory() {
  try {
    fs.mkdirSync(STARTUP_LOG_DIR, { recursive: true });
  } catch (error) {
    // Ignore directory creation errors during bootstrap initialization.
  }
}

function appendLog(message) {
  ensureLogDirectory();
  const timestamp = new Date().toISOString();
  fs.appendFileSync(STARTUP_LOG_FILE, `[${timestamp}] ${message}\n`, 'utf8');
}

function logCommandResult(label, result) {
  if (result.stdout) {
    appendLog(`${label} stdout:\n${result.stdout.trim()}`);
  }
  if (result.stderr) {
    appendLog(`${label} stderr:\n${result.stderr.trim()}`);
  }
  if (result.error) {
    appendLog(`${label} error:\n${result.error.message}`);
  }
}

function runCommand(command, args, options = {}) {
  const commandString = [command, ...args].join(' ');
  appendLog(`Running command: ${commandString}`);

  const result = spawnSync(command, args, {
    cwd: options.cwd || BACKEND_DIR,
    encoding: 'utf8',
    shell: process.platform === 'win32' && !options.directShell,
    windowsHide: true,
    stdio: options.stdio || 'pipe',
    env: { ...process.env, ...(options.env || {}) },
  });

  const stdout = (result.stdout || '').trim();
  const stderr = (result.stderr || '').trim();
  const output = { status: result.status, stdout, stderr, error: result.error, ok: result.status === 0 };

  if (options.stdio === 'inherit') {
    if (stdout) console.log(stdout);
    if (stderr) console.warn(stderr);
    if (result.error) console.error(result.error.message);
    appendLog(`${commandString} exited with ${result.status ?? 'unknown'}`);
    return output;
  }

  logCommandResult(commandString, output);
  return output;
}

function detectNodeModules() {
  const nodeModulesPath = path.join(BACKEND_DIR, 'node_modules');
  return fs.existsSync(nodeModulesPath);
}

function detectCommand(command, args = []) {
  const result = runCommand(command, args);
  if (result.ok) {
    return { detected: true, version: result.stdout || 'unknown' };
  }
  return { detected: false, version: null };
}

function detectPathTool(toolName, args = [], candidates = []) {
  const whereCommand = process.platform === 'win32' ? 'where.exe' : 'which';
  const whereResult = runCommand(whereCommand, [toolName], { directShell: true });
  if (whereResult.ok && whereResult.stdout) {
    const executablePath = whereResult.stdout.split(/\r?\n/).find(Boolean);
    if (executablePath) {
      const versionResult = runCommand(executablePath, args);
      if (versionResult.ok) {
        return { detected: true, executable: executablePath, version: versionResult.stdout || 'unknown' };
      }
    }
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      const versionResult = runCommand('"' + candidate + '"', args);
      if (versionResult.ok) {
        return { detected: true, executable: candidate, version: versionResult.stdout || 'unknown' };
      }
    }
  }

  return { detected: false, executable: null, version: null };
}

function detectTool(toolName, versionArgs = []) {
  const whereCmd = process.platform === 'win32' ? 'where.exe' : 'which';
  const result = runCommand(whereCmd, [toolName]);
  
  if (result.ok && result.stdout) {
    const executable = result.stdout.trim().split('\n')[0];
    const version = runCommand(executable, versionArgs);
    return { 
      detected: true, 
      executable, 
      version: (version.stdout || version.stderr || 'unknown').split('\n')[0].trim() 
    };
  }
  return { detected: false, executable: null, version: null };
}

function detectGhostscript() {
  if (process.platform === 'win32') {
    return detectPathTool('gswin64c', ['-version'], WINDOWS_TOOL_PATHS.ghostscript);
  }
  
  const gs = detectTool('gs', ['--version']);
  if (gs.detected) return gs;
  
  // Try gswin64c on Windows-like systems
  return { detected: false, executable: null, version: null };
}

function detectImageMagick() {
  const magick = detectTool('magick', ['-version']);
  if (magick.detected) return magick;
  
  // Try convert as fallback
  const convert = detectTool('convert', ['-version']);
  if (convert.detected) return convert;
  
  if (process.platform === 'win32') {
    return detectPathTool('magick', ['-version'], WINDOWS_TOOL_PATHS.imagemagick);
  }
  
  return { detected: false, executable: null, version: null };
}

function detectPostgreSQL() {
  if (process.platform === 'win32') {
    const result = detectTool('psql', ['--version']);
    if (result.detected) return result;
  }
  
  return detectTool('psql', ['--version']);
}

function detectRedis() {
  return detectTool('redis-cli', ['--version']);
}

function detectNodeDependency(moduleName) {
  try {
    const resolved = require.resolve(moduleName, { paths: [BACKEND_DIR] });
    const packageJsonPath = path.join(path.dirname(resolved), '..', 'package.json');
    let version = 'unknown';
    if (fs.existsSync(packageJsonPath)) {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      version = pkg.version || version;
    }
    return { detected: true, version, resolved };
  } catch (error) {
    return { detected: false, version: null, resolved: null };
  }
}

function canUseWinget() {
  const result = runCommand('where.exe', ['winget']);
  if (result.ok && result.stdout) {
    return true;
  }
  return false;
}

function canUseChocolatey() {
  const result = runCommand('where.exe', ['choco']);
  if (result.ok && result.stdout) {
    return true;
  }
  return false;
}

function validateWindowsTool(toolKey, label) {
  const detected = toolKey === 'ghostscript' ? detectGhostscript() : detectImageMagick();
  if (!detected.detected) {
    throw new Error(`${label} is still missing from PATH or installed locations after installation.`);
  }
  return detected;
}

function installWindowsTool(toolKey, action) {
  const packageMap = {
    'install-ghostscript': { id: 'ArtifexSoftware.GhostScript', label: 'Ghostscript', binary: 'gswin64c' },
    'install-imagemagick': { id: 'ImageMagick.ImageMagick', label: 'ImageMagick', binary: 'magick' },
  };

  const config = packageMap[action.type];
  if (!config) {
    return false;
  }

  const candidates = [
    { command: 'winget', args: ['install', '--id', config.id, '--exact', '--accept-source-agreements', '--accept-package-agreements', '--silent'], label: `winget install ${config.label}` },
    { command: 'choco', args: ['install', config.label.toLowerCase() === 'ghostscript' ? 'ghostscript' : 'imagemagick', '-y', '--no-progress'], label: `choco install ${config.label}` },
  ];

  for (const candidate of candidates) {
    const hasTool = runCommand('where.exe', [candidate.command], { directShell: true });
    if (!hasTool.ok && candidate.command === 'winget') {
      continue;
    }

    if (!hasTool.ok && candidate.command === 'choco') {
      continue;
    }

    console.log(`[bootstrap] Installing ${config.label} using ${candidate.command}...`);
    const result = runCommand(candidate.command, candidate.args, { stdio: 'pipe' });
    if (result.ok) {
      const validated = validateWindowsTool(toolKey, config.label);
      if (validated.detected) {
        appendLog(`${config.label} validated successfully at ${validated.executable}`);
        return true;
      }
    }

    appendLog(`${config.label} installation via ${candidate.command} did not validate successfully.`);
  }

  throw new Error(`Failed to install or validate ${config.label} on Windows.`);
}

function buildStartupPlan({
  platform = process.platform,
  nodeModulesPresent = detectNodeModules(),
  ghostscriptDetected = detectGhostscript().detected,
  imagemagickDetected = detectImageMagick().detected,
  postgresqlDetected = detectPostgreSQL().detected,
  redisDetected = detectRedis().detected,
  sharpDetected = detectNodeDependency('sharp').detected,
  psdLibraryDetected = (detectNodeDependency('psd.js').detected || detectNodeDependency('psd-parser').detected),
} = {}) {
  const actions = [];

  if (!nodeModulesPresent) {
    actions.push({
      type: 'npm-install',
      command: 'npm install',
      reason: 'Backend dependencies are not installed yet.',
    });
  }

  if (!sharpDetected) {
    actions.push({
      type: 'npm-install-sharp',
      command: 'npm install sharp',
      reason: 'Sharp is required for image processing and thumbnails.',
    });
  }

  if (!psdLibraryDetected) {
    actions.push({
      type: 'npm-install-psd',
      command: 'npm install psd.js',
      reason: 'PSD files need a processor library for thumbnail generation.',
    });
  }

  if (!ghostscriptDetected && platform !== 'win32') {
    actions.push({
      type: 'install-ghostscript',
      command: PLATFORM_INSTALL_COMMANDS[platform]?.ghostscript,
      reason: 'Ghostscript is required for EPS/AI file processing.',
    });
  } else if (!ghostscriptDetected && platform === 'win32') {
    actions.push({
      type: 'install-ghostscript',
      command: 'winget install --id ArtifexSoftware.GhostScript -e',
      reason: 'Ghostscript is required for EPS/AI processing on Windows.',
    });
  }

  if (!imagemagickDetected) {
    actions.push({
      type: 'install-imagemagick',
      command: PLATFORM_INSTALL_COMMANDS[platform]?.imagemagick,
      reason: 'ImageMagick provides image conversion and fallback processing.',
    });
  }

  if (!postgresqlDetected && process.env.SKIP_DB_CHECK !== 'true') {
    actions.push({
      type: 'install-postgresql',
      command: PLATFORM_INSTALL_COMMANDS[platform]?.postgresql,
      reason: 'PostgreSQL is required for the database.',
    });
  }

  if (!redisDetected && process.env.SKIP_REDIS_CHECK !== 'true') {
    actions.push({
      type: 'install-redis',
      command: PLATFORM_INSTALL_COMMANDS[platform]?.redis,
      reason: 'Redis is required for job queuing and caching.',
    });
  }

  actions.push({
    type: 'start-server',
    command: 'node server.js',
    reason: 'Launch backend after dependencies and tools pass validation.',
  });

  const ready = actions.every((action) => action.type === 'start-server');

  return {
    platform,
    nodeModulesPresent,
    ghostscriptDetected,
    imagemagickDetected,
    postgresqlDetected,
    redisDetected,
    sharpDetected,
    psdLibraryDetected,
    actions,
    ready,
  };
}

function ensureToolInstall(action, platform) {
  const toolType = action.type;
  
  if (toolType === 'install-ghostscript') {
    return installSystemTool('ghostscript', platform);
  }
  
  if (toolType === 'install-imagemagick') {
    return installSystemTool('imagemagick', platform);
  }
  
  if (toolType === 'install-postgresql') {
    return installSystemTool('postgresql', platform);
  }
  
  if (toolType === 'install-redis') {
    return installSystemTool('redis', platform);
  }
  
  return true;
}

function installSystemTool(toolName, platform) {
  const command = PLATFORM_INSTALL_COMMANDS[platform]?.[toolName];
  
  if (!command) {
    console.warn(colorize(`[bootstrap] No installation command available for ${toolName} on ${platform}`, COLORS.yellow));
    return false;
  }
  
  console.log(colorize(`[bootstrap] Installing ${toolName}...`, COLORS.blue));
  console.log(colorize(`[bootstrap] Command: ${command}`, COLORS.blue));
  
  const args = command.split(' ');
  const cmd = args.shift();
  
  const result = runCommand(cmd, args, { stdio: 'inherit' });
  
  if (!result.ok) {
    console.warn(colorize(`[bootstrap] Installation of ${toolName} may have failed. Please check manually.`, COLORS.yellow));
    return false;
  }
  
  appendLog(`${toolName} installed successfully.`);
  return true;
}

function ensureNodeDependencies(action) {
  if (action.type === 'npm-install') {
    console.log(colorize('[bootstrap] Installing backend node modules...', COLORS.blue));
    const result = runCommand('npm', ['install'], { stdio: 'inherit' });
    if (!result.ok) {
      console.error(colorize('[bootstrap] npm install failed', COLORS.red));
      return false;
    }
    console.log(colorize('[bootstrap] ✓ npm install completed', COLORS.green));
    return result.ok;
  }

  if (action.type === 'npm-install-sharp') {
    console.log(colorize('[bootstrap] Installing Sharp...', COLORS.blue));
    const result = runCommand('npm', ['install', 'sharp'], { stdio: 'inherit' });
    if (!result.ok) {
      console.error(colorize('[bootstrap] Sharp installation failed', COLORS.red));
      return false;
    }
    console.log(colorize('[bootstrap] ✓ Sharp installed', COLORS.green));
    return result.ok;
  }

  if (action.type === 'npm-install-psd') {
    console.log(colorize('[bootstrap] Installing PSD processor dependency...', COLORS.blue));
    const result = runCommand('npm', ['install', 'psd.js'], { stdio: 'inherit' });
    if (!result.ok) {
      console.error(colorize('[bootstrap] PSD library installation failed', COLORS.red));
      return false;
    }
    console.log(colorize('[bootstrap] ✓ PSD library installed', COLORS.green));
    return result.ok;
  }

  return true;
}

function startBackendServer() {
  const serverProcess = spawn(process.execPath, ['server.js'], {
    cwd: BACKEND_DIR,
    env: { ...process.env, PORT: process.env.PORT || '5000' },
    stdio: 'inherit',
  });

  serverProcess.on('exit', (code) => {
    process.exit(code || 0);
  });

  serverProcess.on('error', (error) => {
    console.error('[bootstrap] Failed to launch backend server:', error.message);
    appendLog(`[bootstrap] Failed to launch backend server: ${error.message}`);
    process.exit(1);
  });
}

async function runStartupChecks() {
  appendLog('Starting backend pre-flight checks...');
  console.log(colorize('\n========================================', COLORS.bright));
  console.log(colorize('  BACKEND DEPENDENCY CHECKER', COLORS.bright));
  console.log(colorize('========================================\n', COLORS.bright));

  const plan = buildStartupPlan();
  
  console.log(colorize('Platform Detected:', COLORS.blue), plan.platform);
  console.log(colorize('\nDependency Status:', COLORS.blue));
  console.log(`  ${plan.nodeModulesPresent ? '✓' : '✗'} Node Modules: ${plan.nodeModulesPresent ? 'installed' : 'not installed'}`);
  console.log(`  ${plan.sharpDetected ? '✓' : '✗'} Sharp: ${plan.sharpDetected ? 'installed' : 'not installed'}`);
  console.log(`  ${plan.psdLibraryDetected ? '✓' : '✗'} PSD Library: ${plan.psdLibraryDetected ? 'installed' : 'not installed'}`);
  console.log(`  ${plan.ghostscriptDetected ? '✓' : '✗'} Ghostscript: ${plan.ghostscriptDetected ? 'installed' : 'not installed'}`);
  console.log(`  ${plan.imagemagickDetected ? '✓' : '✗'} ImageMagick: ${plan.imagemagickDetected ? 'installed' : 'not installed'}`);
  console.log(`  ${plan.postgresqlDetected ? '✓' : '✗'} PostgreSQL: ${plan.postgresqlDetected ? 'installed' : 'not installed'}`);
  console.log(`  ${plan.redisDetected ? '✓' : '✗'} Redis: ${plan.redisDetected ? 'installed' : 'not installed'}`);

  if (plan.actions.length === 1 && plan.actions[0].type === 'start-server') {
    console.log(colorize('\n✓ All dependencies are installed!', COLORS.green));
    console.log(colorize('Starting server...\n', COLORS.blue));
    appendLog('All dependencies verified. Starting server.');
    startBackendServer();
    return;
  }

  console.log(colorize('\nRequired Actions:', COLORS.yellow));
  let actionCount = 1;
  for (const action of plan.actions) {
    if (action.type === 'start-server') continue;
    console.log(`  ${actionCount}. ${action.type}`);
    console.log(`     Reason: ${action.reason}`);
    actionCount++;
  }

  console.log(colorize('\nInstalling missing dependencies...', COLORS.blue));

  for (const action of plan.actions) {
    if (action.type === 'start-server') {
      continue;
    }

    try {
      if (action.type.startsWith('npm-install')) {
        const ok = ensureNodeDependencies(action);
        if (!ok) {
          throw new Error(`Failed to install npm package: ${action.type}`);
        }
      } else {
        const ok = ensureToolInstall(action, plan.platform);
        if (!ok) {
          console.warn(colorize(`[bootstrap] Warning: ${action.type} installation may have failed. Attempting to continue...`, COLORS.yellow));
        }
      }
    } catch (error) {
      console.error(colorize(`[bootstrap] Error during ${action.type}: ${error.message}`, COLORS.red));
      appendLog(`[bootstrap] Error during ${action.type}: ${error.message}`);
    }
  }

  console.log(colorize('\nBackend requirements configured. Starting server...', COLORS.green));
  appendLog('Backend requirements configured. Starting server.');
  startBackendServer();
}

if (require.main === module) {
  runStartupChecks().catch((error) => {
    console.error('[bootstrap] Startup failed:', error.message || error);
    appendLog(`[bootstrap] Startup failed: ${error.message || error}`);
    process.exit(1);
  });
}

module.exports = {
  BACKEND_DIR,
  STARTUP_LOG_FILE,
  buildStartupPlan,
  runStartupChecks,
  detectGhostscript,
  detectImageMagick,
  detectPostgreSQL,
  detectRedis,
  detectNodeDependency,
  detectNodeModules,
  canUseWinget,
  canUseChocolatey,
};
