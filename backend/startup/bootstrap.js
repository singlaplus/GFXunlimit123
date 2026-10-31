const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const readline = require('readline');
const { getWindowsToolPaths } = require('../services/windowsToolPaths');

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
    shell: options.shell === true,
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
  const isExplicitPath = path.isAbsolute(toolName) || path.win32.isAbsolute(toolName)
    || toolName.includes('/') || toolName.includes('\\');
  if (isExplicitPath) {
    const versionResult = runCommand(toolName, args);
    if (versionResult.ok) {
      return { detected: true, executable: toolName, version: versionResult.stdout || 'unknown' };
    }
  } else {
    const whereCommand = process.platform === 'win32' ? 'where.exe' : 'which';
    const whereResult = runCommand(whereCommand, [toolName]);
    if (whereResult.ok && whereResult.stdout) {
      const executablePath = whereResult.stdout.split(/\r?\n/).find(Boolean);
      if (executablePath) {
        const versionResult = runCommand(executablePath, args);
        if (versionResult.ok) {
          return { detected: true, executable: executablePath, version: versionResult.stdout || 'unknown' };
        }
      }
    }
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      const versionResult = runCommand(candidate, args);
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
    if (version.ok) {
      return {
        detected: true,
        executable,
        version: (version.stdout || version.stderr || 'unknown').split('\n')[0].trim(),
      };
    }
  }
  return { detected: false, executable: null, version: null };
}

function detectGhostscript() {
  if (process.platform === 'win32') {
    const configuredPath = process.env.GHOSTSCRIPT_PATH;
    const configuredResult = configuredPath
      ? detectPathTool(configuredPath, ['-version'])
      : { detected: false };
    if (configuredResult.detected) return configuredResult;
    const candidates = getWindowsToolPaths('ghostscript');
    candidates.push(...candidates.map((file) => file.replace(/gswin64c\.exe$/i, 'gswin32c.exe')));
    return detectPathTool('gswin64c', ['-version'], candidates);
  }
  
  const gs = detectTool('gs', ['--version']);
  if (gs.detected) return gs;
  
  return { detected: false, executable: null, version: null };
}

function detectImageMagick() {
  if (process.platform === 'win32') {
    const configuredPath = process.env.IMAGEMAGICK_PATH;
    const configuredResult = configuredPath
      ? detectPathTool(configuredPath, ['-version'])
      : { detected: false };
    if (configuredResult.detected) return configuredResult;
    return detectPathTool('magick', ['-version'], getWindowsToolPaths('imagemagick'));
  }

  const magick = detectTool('magick', ['-version']);
  if (magick.detected) return magick;

  // ImageMagick 6 provides `convert` instead of `magick`.
  const convert = detectTool('convert', ['-version']);
  if (convert.detected) return convert;
  
  return { detected: false, executable: null, version: null };
}

function detectPostgreSQL() {
  const candidates = process.platform === 'win32'
    ? getWindowsToolPaths('postgresql')
    : [];
  return detectPathTool('psql', ['--version'], candidates);
}

function detectRedis() {
  const candidates = process.platform === 'win32'
    ? getWindowsToolPaths('redis')
    : [];
  return detectPathTool('redis-cli', ['--version'], candidates);
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

function installWindowsTool(toolName) {
  const packageMap = {
    ghostscript: {
      id: 'ArtifexSoftware.GhostScript',
      label: 'Ghostscript',
      chocolateyPackage: 'ghostscript',
    },
    imagemagick: {
      id: 'ImageMagick.ImageMagick',
      label: 'ImageMagick',
      chocolateyPackage: 'imagemagick',
    },
  };
  const config = packageMap[toolName];
  if (!config) return false;

  const candidates = [
    {
      command: 'winget',
      args: [
        'install', '--id', config.id, '--exact',
        '--accept-source-agreements', '--accept-package-agreements', '--silent',
      ],
    },
    {
      command: 'choco',
      args: ['install', config.chocolateyPackage, '-y', '--no-progress'],
    },
  ];

  for (const candidate of candidates) {
    if (!runCommand('where.exe', [candidate.command]).ok) continue;

    console.log(`[bootstrap] Installing ${config.label} using ${candidate.command}...`);
    const result = runCommand(candidate.command, candidate.args, { stdio: 'inherit' });
    if (result.ok) {
      try {
        const validated = validateWindowsTool(toolName, config.label);
        appendLog(`${config.label} validated successfully at ${validated.executable}`);
        return true;
      } catch (error) {
        appendLog(`${config.label} installation via ${candidate.command} completed but validation failed: ${error.message}`);
      }
    }
    appendLog(`${config.label} installation via ${candidate.command} failed; trying the next available installer.`);
  }

  throw new Error(`Could not install ${config.label}. Install it manually or configure its executable path.`);
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

  if (!ghostscriptDetected) {
    actions.push({
      type: 'install-ghostscript',
      command: PLATFORM_INSTALL_COMMANDS[platform]?.ghostscript,
      reason: 'Ghostscript is required for EPS/AI file processing.',
    });
  }

  if (!imagemagickDetected) {
    actions.push({
      type: 'install-imagemagick',
      command: PLATFORM_INSTALL_COMMANDS[platform]?.imagemagick,
      reason: 'ImageMagick provides image conversion and fallback processing.',
    });
  }

  if (!postgresqlDetected && platform !== 'win32' && process.env.SKIP_DB_CHECK !== 'true') {
    actions.push({
      type: 'install-postgresql',
      command: PLATFORM_INSTALL_COMMANDS[platform]?.postgresql,
      reason: 'PostgreSQL command-line tools are required for database backup and restore.',
    });
  }

  if (!redisDetected && platform !== 'win32' && process.env.SKIP_REDIS_CHECK !== 'true') {
    actions.push({
      type: 'install-redis',
      command: PLATFORM_INSTALL_COMMANDS[platform]?.redis,
      reason: 'Redis is required for job queuing and caching.',
    });
  }

  const missingSystemTools = [
    !ghostscriptDetected && 'Ghostscript',
    !imagemagickDetected && 'ImageMagick',
  ].filter(Boolean);

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
    missingSystemTools,
    actions,
    ready,
  };
}

function ensureToolInstall(action, platform) {
  if (platform === 'win32') {
    if (action.type === 'install-ghostscript') return installWindowsTool('ghostscript');
    if (action.type === 'install-imagemagick') return installWindowsTool('imagemagick');
    return false;
  }

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
    const result = runCommand('npm', ['install'], {
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    if (!result.ok) {
      console.error(colorize('[bootstrap] npm install failed', COLORS.red));
      return false;
    }
    console.log(colorize('[bootstrap] ✓ npm install completed', COLORS.green));
    return result.ok;
  }

  if (action.type === 'npm-install-sharp') {
    console.log(colorize('[bootstrap] Installing Sharp...', COLORS.blue));
    const result = runCommand('npm', ['install', 'sharp'], {
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    if (!result.ok) {
      console.error(colorize('[bootstrap] Sharp installation failed', COLORS.red));
      return false;
    }
    console.log(colorize('[bootstrap] ✓ Sharp installed', COLORS.green));
    return result.ok;
  }

  if (action.type === 'npm-install-psd') {
    console.log(colorize('[bootstrap] Installing PSD processor dependency...', COLORS.blue));
    const result = runCommand('npm', ['install', 'psd.js'], {
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
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
  console.log(`  ${plan.postgresqlDetected ? '✓' : '✗'} PostgreSQL CLI: ${plan.postgresqlDetected ? 'installed' : 'not installed'}`);
  console.log(`  ${plan.redisDetected ? '✓' : '✗'} Redis CLI: ${plan.redisDetected ? 'installed' : 'not installed'}`);

  if (plan.platform === 'win32' && (!plan.postgresqlDetected || !plan.redisDetected)) {
    console.warn(colorize(
      '[bootstrap] PostgreSQL/Redis command-line clients are not detected. These checks do not determine whether the configured database/cache services are reachable; the app uses Node.js drivers and will not install another database/cache service based only on missing CLI tools.',
      COLORS.yellow
    ));
    appendLog('PostgreSQL/Redis CLI missing; not installing database/cache services based on a missing command-line client.');
  }

  if (plan.actions.length === 1 && plan.actions[0].type === 'start-server') {
    console.log(colorize('\n✓ Backend Node dependencies are installed.', COLORS.green));
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
  getWindowsToolPaths,
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
