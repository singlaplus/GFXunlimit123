const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { check, git } = require('./diagnostics');
const checkpoints = require('./checkpoint');
const { run, describe } = require('./platform');
const { applyConfiguredRepairs } = require('./repair');

const AANAV_ROOT = path.resolve(__dirname, '..');
const PROJECT_ROOT = path.resolve(AANAV_ROOT, '..');
const CONFIG_FILE = path.join(AANAV_ROOT, 'config', 'aanav.config.json');

function config() {
  const data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  data.projectRoot = PROJECT_ROOT;
  return data;
}
function log(command, action, status, detail = '', checkpoint = '') {
  checkpoints.ensureDirectories(AANAV_ROOT);
  const file = path.join(AANAV_ROOT, 'logs', `${command}-${new Date().toISOString().slice(0, 10)}.log`);
  const info = git(PROJECT_ROOT);
  fs.appendFileSync(file, `[${new Date().toISOString()}] command=${command} action=${action} result=${status} checkpoint=${checkpoint} git=${info.commit} platform=${process.platform} ${detail}\n`);
}
function report(command, payload) {
  checkpoints.ensureDirectories(AANAV_ROOT);
  const file = path.join(AANAV_ROOT, 'reports', `${command}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
  return file;
}
function printChecks(data) {
  console.log('========================================');
  console.log('        GFX-AANAV FULL CHECK');
  console.log('========================================\n');
  for (const item of data.checks) console.log(`[${item.status}] ${item.name}${item.detail ? ` - ${item.detail}` : ''}`);
  console.log('\n========================================');
  console.log(`RESULT: ${data.result}`);
  console.log('========================================');
}
async function runCheck() {
  const data = await check(config(), PROJECT_ROOT); const file = report('check', data); printChecks(data); log('check', 'full validation', data.result, `report=${file}`); return data;
}
async function start() {
  const data = await runCheck();
  if (data.result !== 'PASS') { console.log('\nSTART BLOCKED: the current project failed critical checks. No checkpoint was created.'); return 1; }
  const file = checkpoints.createDevelopmentStart(AANAV_ROOT, config(), data); log('start', 'development checkpoint created', 'PASS', `file=${file}`, path.basename(file, '.json')); console.log(`Development-start checkpoint created: ${path.basename(file, '.json')}`); return 0;
}
async function save() {
  const data = await runCheck();
  if (data.result !== 'PASS') { console.log('\nSAVE BLOCKED\n\nThe current website has failed one or more critical checks.\nFix the problem and run the check again.'); log('save', 'stable save', 'BLOCKED', 'critical checks failed'); return 1; }
  const id = `AANAV-${new Date().toISOString().slice(0, 10)}-${String(checkpoints.listOfficial(AANAV_ROOT).length + 1).padStart(3, '0')}`;
  const database = checkpoints.databaseBackup(AANAV_ROOT, PROJECT_ROOT, config(), id);
  if (database.status === 'FAILED' || (config().database.required && database.status !== 'AVAILABLE')) { console.log(`\nSAVE BLOCKED: database backup failed.\n${database.detail || 'PostgreSQL protection is mandatory.'}`); log('save', 'database backup', 'BLOCKED', database.detail || 'mandatory backup unavailable'); return 1; }
  const staged = run('git', ['add', '-A'], { cwd: PROJECT_ROOT });
  if (!staged.ok) { console.log(`SAVE BLOCKED: could not stage Git changes. ${staged.stderr}`); return 1; }
  const commit = run('git', ['commit', '-m', `GFX-Aanav stable checkpoint ${id}`], { cwd: PROJECT_ROOT, timeout: 300000 });
  const remaining = run('git', ['status', '--porcelain'], { cwd: PROJECT_ROOT });
  if (!commit.ok && remaining.stdout) { console.log(`SAVE BLOCKED: Git commit failed. ${commit.stderr || commit.stdout}`); return 1; }
  const info = git(PROJECT_ROOT); const tag = `aanav-stable-${id.slice(6)}`; const tagged = run('git', ['tag', '-a', tag, '-m', `GFX-Aanav stable checkpoint ${id}`], { cwd: PROJECT_ROOT });
  if (!tagged.ok) { console.log(`SAVE BLOCKED: Git tag failed. ${tagged.stderr || tagged.stdout}`); return 1; }
  const file = checkpoints.createStable(AANAV_ROOT, config(), data, database);
  const saveReport = report('save', { command: 'save', createdAt: new Date().toISOString(), checkpointId: id, git: info, tag, database, checks: data });
  log('save', 'official stable checkpoint created', 'PASS', `database=${database.path} tag=${tag} report=${saveReport}`, id);
  console.log(`Stable checkpoint created: ${id}\nGit tag: ${tag}\nDatabase backup: ${database.path || database.status}\nReport: ${saveReport}`); return 0;
}
async function repair() {
  const backup = checkpoints.emergencyBackup(AANAV_ROOT, PROJECT_ROOT, 'repair-emergency'); const stable = checkpoints.latestOfficial(AANAV_ROOT); const cfg = config(); const repairActions = applyConfiguredRepairs(PROJECT_ROOT, cfg);
  const data = await runCheck(); let comparison = 'No official stable checkpoint exists.';
  if (stable) comparison = run('git', ['diff', '--name-status', stable.gitCommit], { cwd: PROJECT_ROOT, timeout: 120000 }).stdout;
  const file = report('repair', { command: 'repair', createdAt: new Date().toISOString(), backup, stable, comparison, check: data, repairActions, action: repairActions.length ? 'safe-local-repair-and-diagnosis' : 'diagnose-only', note: 'No reset, deletion, dependency replacement, or uncertain application repair was attempted.' });
  log('repair', 'emergency backup and diagnosis', data.result, `backup=${backup.path} report=${file}`, stable && stable.checkpointId); console.log(`Repair diagnosis complete.\nEmergency backup: ${backup.path}\nReport: ${file}\nNo destructive repair was performed.`); return data.result === 'PASS' ? 0 : 1;
}
async function rollback(args = []) {
  const stable = checkpoints.latestOfficial(AANAV_ROOT); if (!stable) { console.log('ROLLBACK BLOCKED: no official stable checkpoint exists.'); return 1; }
  const backup = checkpoints.emergencyBackup(AANAV_ROOT, PROJECT_ROOT, 'rollback-emergency'); console.log(`WARNING\n\nYou are about to return to:\n${stable.checkpointId}\n\nCurrent development will be removed from the active project.\nA backup has been created at:\n${backup.path}\n\nContinue? [Y/N]`);
  let answer = args[0] || '';
  if (!answer) {
    const input = readline.createInterface({ input: process.stdin, output: process.stdout });
    answer = await new Promise(resolve => input.question('Continue? [Y/N] ', value => { input.close(); resolve(value.trim()); }));
  }
  if (!/^y(es)?$/i.test(answer)) { console.log('Rollback cancelled. Current development was not changed.'); return 0; }
  const reset = run('git', ['reset', '--hard', stable.gitCommit], { cwd: PROJECT_ROOT, timeout: 300000 }); if (!reset.ok) { console.log(`Rollback failed: ${reset.stderr}`); return 1; }
  const clean = run('git', ['clean', '-fd', '-e', 'GFX-Aanav/'], { cwd: PROJECT_ROOT, timeout: 300000 }); if (!clean.ok) { console.log(`Rollback cleanup failed: ${clean.stderr}`); return 1; }
  const rollbackReport = report('rollback', { command: 'rollback', createdAt: new Date().toISOString(), checkpointId: stable.checkpointId, backup, result: 'PASS', databaseRestore: 'not performed', originalAssets: 'preserved' });
  log('rollback', 'source rollback completed', 'PASS', `backup=${backup.path} report=${rollbackReport}`, stable.checkpointId); console.log(`Rollback completed to ${stable.checkpointId}. Original assets were not deleted.\nReport: ${rollbackReport}`); return 0;
}
function status() {
  const stable = checkpoints.latestOfficial(AANAV_ROOT); const info = git(PROJECT_ROOT); const last = fs.readdirSync(path.join(AANAV_ROOT, 'reports')).filter(file => file.startsWith('check-')).sort().reverse()[0]; const lastData = last ? JSON.parse(fs.readFileSync(path.join(AANAV_ROOT, 'reports', last), 'utf8')) : null; const changed = stable ? run('git', ['diff', '--name-only', stable.gitCommit], { cwd: PROJECT_ROOT }).stdout.split(/\r?\n/).filter(Boolean) : info.status.split(/\r?\n/).filter(Boolean);
  console.log(`========================================\n          GFX-AANAV STATUS\n========================================\n\nProject:\n${PROJECT_ROOT}\n\nOperating System:\n${describe().platform}\n\nLatest Stable Checkpoint:\n${stable ? stable.checkpointId : 'NONE'}\n\nStable Git Commit:\n${stable ? stable.gitCommit : 'NONE'}\n\nCurrent Git Commit:\n${info.commit}\n\nCurrent Branch:\n${info.branch}\n\nCurrent State:\n${changed.length ? 'MODIFIED' : 'CLEAN'}\n\nFiles Changed:\n${changed.length}\n\nLast Check:\n${lastData ? lastData.result : 'NOT RUN'}\n\nDatabase Backup:\n${stable && stable.databaseBackup && stable.databaseBackup.status === 'AVAILABLE' ? 'AVAILABLE' : 'NOT AVAILABLE'}\n\n========================================`);
  return 0;
}
module.exports = { start, runCheck, save, repair, rollback, status, AANAV_ROOT, PROJECT_ROOT };
