const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { run, which, tool, resolvePath, readEnv, describe } = require('./platform');

function result(name, status, detail = '', critical = false) {
  return { name, status, detail, critical };
}

function git(projectRoot) {
  const available = Boolean(which('git'));
  if (!available) return { branch: '', commit: '', status: '', available: false, detail: 'Git was not found' };
  const branch = run('git', ['branch', '--show-current'], { cwd: projectRoot });
  const commit = run('git', ['rev-parse', 'HEAD'], { cwd: projectRoot });
  const status = run('git', ['status', '--porcelain=v1'], { cwd: projectRoot });
  return { branch: branch.stdout, commit: commit.stdout, status: status.stdout, available: branch.ok && commit.ok, detail: branch.ok && commit.ok ? '' : (commit.stderr || branch.stderr) };
}

function backendProcessCount() {
  if (process.platform === 'win32') return null;
  const processes = run('ps', ['-axo', 'command='], { timeout: 10000 });
  if (!processes.ok) return null;
  return processes.stdout.split(/\r?\n/).filter(line => /node(?:\s+[^\n]*)?\sserver\.js(?:\s|$)/.test(line)).length;
}

function packageCheck(projectRoot, relativePath) {
  const file = path.join(projectRoot, relativePath, 'package.json');
  if (!fs.existsSync(file)) return result(relativePath, 'FAIL', `Missing ${file}`, true);
  try { JSON.parse(fs.readFileSync(file, 'utf8')); return result(relativePath, 'PASS', 'package.json is valid', true); }
  catch (error) { return result(relativePath, 'FAIL', error.message, true); }
}

function runNpmScript(projectRoot, relativePath, script, timeout) {
  const packageDir = path.join(projectRoot, relativePath);
  if (!fs.existsSync(path.join(packageDir, 'node_modules'))) return { ok: false, detail: 'dependencies are not installed' };
  const npm = which('npm');
  if (!npm) return { ok: false, detail: 'npm was not found' };
  const command = process.platform === 'win32' ? 'npm.cmd' : npm;
  const check = run(command, ['run', script, '--', '--watchAll=false', '--runInBand'], { cwd: packageDir, timeout });
  return { ok: check.ok, detail: check.ok ? 'completed' : (check.stderr || check.stdout || check.error).slice(-2000) };
}

function request(url, timeout = 5000) {
  return new Promise(resolve => {
    const requestObject = http.get(url, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ ok: response.statusCode >= 200 && response.statusCode < 500, statusCode: response.statusCode, body: body.slice(0, 2000) }));
    });
    requestObject.setTimeout(timeout, () => { requestObject.destroy(); resolve({ ok: false, detail: 'request timed out' }); });
    requestObject.on('error', error => resolve({ ok: false, detail: error.message }));
  });
}

async function backendHealth(config, projectRoot) {
  const url = config.backend.url;
  let health = await request(url);
  if (health.ok && health.statusCode < 500) return { ...health, temporary: false };
  const originalHealth = health;
  if (health.statusCode >= 500) return { ...health, temporary: false, original: originalHealth };
  const backendDir = resolvePath(projectRoot, config.backend.path);
  const start = config.backend.startCommand || 'node server.js';
  const parts = start.match(/(?:[^\s"]+|"[^"]*")+/g).map(value => value.replace(/^"|"$/g, ''));
  const executable = parts.shift();
  const environment = { ...process.env, ...readEnv(projectRoot, ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'REDIS_HOST', 'REDIS_PORT']) };
  const originalPort = environment.PORT || '5000';
  const temporaryPort = String(Number(originalPort) + 1);
  const temporaryUrl = new URL(url); temporaryUrl.port = temporaryPort;
  environment.PORT = temporaryPort;
  const child = spawn(executable === 'node' ? process.execPath : executable, parts, { cwd: backendDir, env: environment, stdio: 'ignore', windowsHide: true, shell: false, detached: process.platform !== 'win32' });
  try {
    for (let attempt = 0; attempt < 15; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      health = await request(temporaryUrl.toString(), 3000);
      if (health.ok && health.statusCode < 500) return { ...health, temporary: true, original: originalHealth };
    }
    return { ...health, original: originalHealth };
  } finally {
    if (!child.killed) {
      if (process.platform !== 'win32') { try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); } }
      else { run('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { timeout: 30000 }); }
    }
  }
}

async function check(config, projectRoot) {
  const checks = [];
  const environment = describe();
  const gitInfo = git(projectRoot);
  checks.push(result('Git', gitInfo.available ? 'PASS' : 'FAIL', gitInfo.available ? `${gitInfo.branch} ${gitInfo.commit.slice(0, 8)}` : gitInfo.detail, true));
  checks.push(result('Node.js', environment.node ? 'PASS' : 'FAIL', environment.node, true));
  checks.push(result('npm', environment.npm ? 'PASS' : 'FAIL', environment.npm || 'npm was not found', true));

  for (const [name, relativePath] of [['Frontend', config.frontend.path], ['Backend', config.backend.path]]) checks.push(packageCheck(projectRoot, relativePath));
  const frontend = runNpmScript(projectRoot, config.frontend.path, config.frontend.buildScript || 'build', 900000);
  checks.push(result('Frontend build', frontend.ok ? 'PASS' : 'FAIL', frontend.detail, true));
  const backendTests = runNpmScript(projectRoot, config.backend.path, config.backend.testScript || 'test', 900000);
  const health = await backendHealth(config, projectRoot);
  const healthDetail = health.ok ? `HTTP ${health.statusCode}${health.temporary ? ' on temporary port' : ''}` : `HTTP ${health.statusCode || 'unavailable'}${health.body ? `: ${health.body}` : (health.detail ? `: ${health.detail}` : '')}`;
  checks.push(result('Backend', backendTests.ok && health.ok && health.statusCode < 500 ? 'PASS' : 'FAIL', `${backendTests.detail}; health=${healthDetail}`, true));
  const processCount = backendProcessCount();
  checks.push(result('Backend process ownership', processCount === null || processCount <= 1 ? 'PASS' : 'WARNING', processCount === null ? 'process count unavailable' : `${processCount} node server.js processes detected; inspect before restarting`, false));

  for (const [label, relativePath, critical] of [['Upload storage', config.storage.uploads, true], ['Original storage', config.storage.originals, false], ['Thumbnail storage', config.storage.thumbnails, true], ['Temporary storage', config.storage.temporary, false]]) {
    const target = resolvePath(projectRoot, relativePath);
    checks.push(result(label, target && fs.existsSync(target) ? 'PASS' : 'FAIL', target || 'not configured', critical));
  }

  const env = readEnv(projectRoot, ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'REDIS_HOST', 'REDIS_PORT']);
  const dbConfigured = config.database.enabled !== false;
  if (!dbConfigured) checks.push(result('PostgreSQL', 'NOT TESTED', 'disabled in configuration', false));
  else {
    const psql = tool('psql', ['--version']);
    if (psql.status === 'NOT AVAILABLE') checks.push(result('PostgreSQL', 'NOT AVAILABLE', psql.detail, config.database.required === true));
    else {
      const db = run('psql', ['-w', '-h', env.DB_HOST || config.database.defaultHost, '-p', env.DB_PORT || String(config.database.defaultPort), '-U', env.DB_USER || config.database.defaultUser, '-d', env.DB_NAME || config.database.defaultName, '-c', 'SELECT 1;'], { cwd: projectRoot, env: env.DB_PASSWORD ? { PGPASSWORD: env.DB_PASSWORD } : {} });
      const weakCredential = env.DB_PASSWORD && ['yourpassword', 'changeme', 'change-me'].includes(env.DB_PASSWORD.toLowerCase());
      const databaseDetail = db.ok ? `connected to ${env.DB_NAME || config.database.defaultName}${weakCredential ? '; warning: configured credential is a placeholder' : ''}` : `${db.stderr || db.error}${env.DB_PASSWORD ? '' : ' DB_PASSWORD is not configured; no credential was guessed.'}`;
      checks.push(result('PostgreSQL', db.ok ? 'PASS' : 'FAIL', databaseDetail, config.database.required !== false));
    }
  }

  if (config.redis.enabled === false) checks.push(result('Redis', 'NOT TESTED', 'disabled in configuration', false));
  else {
    const redis = tool('redis-cli', ['--version']);
    if (redis.status === 'NOT AVAILABLE') checks.push(result('Redis', 'NOT AVAILABLE', redis.detail, config.redis.required === true));
    else {
      const ping = run('redis-cli', ['-h', env.REDIS_HOST || config.redis.defaultHost, '-p', env.REDIS_PORT || String(config.redis.defaultPort), 'PING'], { cwd: projectRoot });
      const redisOk = ping.ok && ping.stdout === 'PONG';
      checks.push(result('Redis', redisOk ? 'PASS' : (config.redis.required === true ? 'FAIL' : 'NOT AVAILABLE'), ping.stdout || ping.stderr, config.redis.required === true));
    }
  }

  const bull = fs.existsSync(path.join(projectRoot, 'backend', 'node_modules', 'bullmq')) && fs.existsSync(path.join(projectRoot, 'backend', 'node_modules', 'ioredis'));
  checks.push(result('BullMQ', bull ? 'PASS' : 'NOT AVAILABLE', bull ? 'BullMQ and ioredis modules found' : 'backend queue modules not installed', false));
  const pm2 = tool('pm2', ['--version']);
  const ecosystem = (config.pm2.ecosystemFiles || []).map(file => resolvePath(projectRoot, file)).find(file => fs.existsSync(file));
  checks.push(result('PM2', !ecosystem ? 'NOT TESTED' : pm2.status === 'PASS' ? 'PASS' : 'NOT AVAILABLE', !ecosystem ? 'no ecosystem configuration found' : pm2.detail, false));

  const sharp = fs.existsSync(path.join(projectRoot, 'backend', 'node_modules', 'sharp'));
  checks.push(result('Sharp', sharp ? 'PASS' : 'NOT AVAILABLE', sharp ? 'module found' : 'sharp is not installed', false));
  for (const [label, executable] of [['ImageMagick', 'magick'], ['Ghostscript', 'gs']]) { const detected = tool(executable); checks.push(result(label, detected.status, detected.detail || detected.version, false)); }

  const criticalFailed = checks.some(item => item.critical && (item.status === 'FAIL' || item.status === 'NOT AVAILABLE'));
  return { result: criticalFailed ? 'FAIL' : 'PASS', checks, git: gitInfo, environment };
}

module.exports = { check, git, result };
