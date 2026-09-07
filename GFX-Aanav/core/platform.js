const os = require('os');
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

function commandName(name) {
  return process.platform === 'win32' && name === 'npm' ? 'npm.cmd' : name;
}

function run(file, args = [], options = {}) {
  const result = spawnSync(commandName(file), args, {
    cwd: options.cwd,
    env: { ...process.env, ...(options.env || {}) },
    encoding: 'utf8',
    timeout: options.timeout || 300000,
    windowsHide: true,
    shell: false,
    input: options.input,
  });
  return {
    ok: result.status === 0,
    code: result.status == null ? 1 : result.status,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
    error: result.error ? result.error.message : '',
  };
}

function which(name) {
  const probe = process.platform === 'win32' ? 'where.exe' : 'which';
  const result = run(probe, [name], { timeout: 10000 });
  return result.ok ? result.stdout.split(/\r?\n/)[0].trim() : null;
}

function tool(name, args = ['--version']) {
  const executable = which(name);
  if (!executable) return { status: 'NOT AVAILABLE', executable: null, version: null, detail: `${name} was not found` };
  const result = run(executable, args, { timeout: 30000 });
  return { status: result.ok ? 'PASS' : 'FAIL', executable, version: (result.stdout || result.stderr).split(/\r?\n/)[0], detail: result.ok ? '' : (result.error || result.stderr) };
}

function resolvePath(projectRoot, value) {
  if (!value) return null;
  return path.isAbsolute(value) ? value : path.resolve(projectRoot, value);
}

function packageManager() {
  return which('npm') ? 'npm' : null;
}

function readEnv(projectRoot, names) {
  const result = {};
  for (const name of names) {
    if (process.env[name]) { result[name] = process.env[name]; continue; }
    for (const file of [path.join(projectRoot, 'backend', '.env'), path.join(projectRoot, '.env')]) {
      if (!fs.existsSync(file)) continue;
      const line = fs.readFileSync(file, 'utf8').split(/\r?\n/).find(item => new RegExp(`^\\s*${name}\\s*=`).test(item));
      if (line) {
        const value = line.split('=').slice(1).join('=').trim().replace(/^['"]|['"]$/g, '');
        if (value) { result[name] = value; break; }
      }
    }
  }
  return result;
}

function describe() {
  return { platform: process.platform, release: os.release(), arch: process.arch, node: process.version, npm: packageManager() };
}

module.exports = { run, which, tool, resolvePath, readEnv, describe, commandName };
