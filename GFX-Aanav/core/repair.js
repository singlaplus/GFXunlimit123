const fs = require('fs');
const path = require('path');
const { run, resolvePath, commandName } = require('./platform');

function configuredDirectories(config) {
  return [...new Set(Object.values(config.storage || {}).filter(Boolean))];
}

function createMissingDirectories(projectRoot, config) {
  const actions = [];
  for (const relativePath of configuredDirectories(config)) {
    const target = resolvePath(projectRoot, relativePath);
    if (!target) continue;
    if (fs.existsSync(target)) actions.push({ type: 'directory', path: target, action: 'verified', result: 'PASS' });
    else {
      fs.mkdirSync(target, { recursive: true });
      actions.push({ type: 'directory', path: target, action: 'created', result: 'PASS' });
    }
  }
  return actions;
}

function runApprovedCommands(projectRoot, config) {
  const policy = config.repair || {};
  const actions = [];
  for (const definition of policy.approvedCommands || []) {
    if (!definition || definition.enabled !== true || definition.automatic !== true) {
      actions.push({ type: 'command', command: definition && definition.command, result: 'SKIPPED', reason: 'Command is not explicitly enabled for automatic repair' });
      continue;
    }
    if (!definition.safe) {
      actions.push({ type: 'command', command: definition.command, result: 'SKIPPED', reason: 'Command is not marked safe' });
      continue;
    }
    if (policy.requiredConfirmationForCommands !== false) {
      actions.push({ type: 'command', command: definition.command, result: 'SKIPPED', reason: 'Configuration requires explicit confirmation before custom commands' });
      continue;
    }
    const cwd = resolvePath(projectRoot, definition.cwd || '.');
    const executable = commandName(definition.command);
    const args = Array.isArray(definition.args) ? definition.args.map(String) : [];
    const timeout = Math.min(Number(definition.timeoutSeconds || policy.maxCommandTimeoutSeconds || 300), 1800) * 1000;
    const output = run(executable, args, { cwd, timeout });
    actions.push({ type: 'command', command: [definition.command, ...args].join(' '), cwd, result: output.ok ? 'PASS' : 'FAIL', detail: output.ok ? output.stdout.slice(-1000) : (output.stderr || output.error).slice(-2000) });
  }
  return actions;
}

function applyConfiguredRepairs(projectRoot, config) {
  const policy = config.repair || {};
  if (policy.enabled === false) return [{ type: 'policy', result: 'SKIPPED', reason: 'Repair disabled in configuration' }];
  const actions = [];
  if (policy.createMissingDirectories !== false) actions.push(...createMissingDirectories(projectRoot, config));
  if (policy.installMissingDependencies === true) {
    actions.push({ type: 'dependencies', result: 'SKIPPED', reason: 'Dependency installation requires an explicit approved command' });
  }
  actions.push(...runApprovedCommands(projectRoot, config));
  if (policy.restartBackend === true && policy.restartOnlyAanavOwnedProcesses !== false) {
    actions.push({ type: 'backend-restart', result: 'SKIPPED', reason: 'No Aanav-owned persistent backend process exists to restart' });
  }
  return actions;
}

module.exports = { applyConfiguredRepairs, createMissingDirectories, runApprovedCommands };