# GFX-Aanav

GFX-Aanav is a cross-platform Node.js safety and recovery layer for GFXunlimit. It lives at `<PROJECT_ROOT>/GFX-Aanav`, detects the current project location from its own directory, and does not depend on `C:\stocksite`, PowerShell, CMD, bash, zsh, or a global installation.

## Requirements

Core operation requires Node.js and Git. PostgreSQL, Redis, PM2, ImageMagick, and Ghostscript are detected when configured and available. Missing optional tools are reported as `NOT AVAILABLE` and do not crash the system. In this project PostgreSQL is mandatory for stable saves; Redis is configured as optional.

## Commands

Use the portable npm commands from the project root or VS Code integrated terminal:

```text
npm run gfx-aanav-start
npm run gfx-aanav-check
npm run gfx-aanav-repair
npm run gfx-aanav-save
npm run gfx-aanav-rollback -- y
npm run gfx-aanav-status
```

The implementation is Node.js under `core/` and `commands/`. The npm scripts are the supported command interface on Windows, macOS, and Linux. PowerShell files from the earlier prototype are retained only as legacy files and are not required.

## Workflow

`start` runs the full check and creates a `DEVSTART-*` known-good checkpoint only when critical checks pass. `check` builds the frontend, runs the configured backend test script, probes the backend health URL, checks configured services and storage, and writes a JSON report. `repair` always creates an emergency Git backup and performs diagnosis only; it never runs a hard reset or deletes development work.

`save` checks first, creates a PostgreSQL custom-format dump, commits the current source state, creates an annotated `aanav-stable-*` Git tag, and writes a new `AANAV-YYYY-MM-DD-NNN` checkpoint. It never overwrites older checkpoints. `rollback` creates an emergency backup, prints a warning, and proceeds only when its explicit `y` argument is provided. It restores source Git state and preserves upload/original assets. Database restoration is intentionally separate and manual so a code rollback cannot silently destroy live data.

Repair automatically performs only deterministic, low-risk actions: it creates missing configured storage directories, captures Git patches and status before doing anything, checks the stable-to-current diff, and verifies backend startup on an alternate port only when the configured endpoint is not responding. It does not kill an existing process, reset Git, alter application source, replace dependencies, or run destructive database commands. If an existing server returns HTTP 5xx, repair reports the response and leaves that user-owned process untouched. This prevents duplicate backend workers and database connection exhaustion.

## Structure

```text
GFX-Aanav/
  core/aanav.js              orchestration and command behavior
  core/checkpoint.js         metadata, database, and emergency backups
  core/diagnostics.js        project checks and temporary health startup
  core/platform.js           OS-aware process and tool detection
  core/repair.js             repair entry module
  core/rollback.js           rollback entry module
  commands/                  npm-invoked command entry points
  config/aanav.config.json   project-relative configuration
  checkpoints/               stable and development-start metadata
  backups/                   emergency Git status and binary patches
  database/                  checkpoint-associated PostgreSQL dumps
  logs/                      dated command logs
  reports/                   check, save, repair, and rollback JSON reports
```

Checkpoints contain the checkpoint ID, UTC timestamp, platform, Node version, Git commit and branch, test results, configuration snapshot, storage configuration, database backup reference, and GFX-Aanav version. Large uploads and original assets remain in their configured locations and are not copied into each checkpoint.

## Configuration

Edit `config/aanav.config.json` for project-relative or external storage paths, backend/frontend locations, service defaults, scripts, health URL, PM2 ecosystem filenames, mandatory service policy, and repair policy. Relative paths resolve from the detected project root. Secrets are read from environment variables or the project's `.env` files and are never written to checkpoint metadata.

Repair is configurable under `repair`. Missing configured directories are created by default. Dependency installation, backend restart, and custom commands are disabled unless explicitly enabled. A custom command must be marked `enabled: true`, `automatic: true`, and `safe: true` in `approvedCommands`; commands are still executed only after the emergency backup is created. Keep `requiredConfirmationForCommands` enabled for commands that could change application state. Never place `git reset --hard`, database deletion, asset deletion, or untrusted downloaded scripts in automatic repair commands.

The current project uses frontend `npm run build`, backend `npm test`, backend health `http://127.0.0.1:5000/`, PostgreSQL `stocksite`, Redis `localhost:6379`, BullMQ modules from `backend/node_modules`, and storage under `backend/uploads` and `backend/tmp`. Database saves detect the PostgreSQL server major version and require a matching `pg_dump`; set `database.pgDumpPath` when the matching client is installed outside PATH. No PM2 ecosystem configuration is currently present, so PM2 is reported as `NOT TESTED`.

## Manual recovery

Inspect the newest `GFX-Aanav/checkpoints/AANAV-*.json`. Its `gitCommit`, `gitBranch`, `gitTag` information and `databaseBackup.path` identify the complete recovery pair:

```text
git show <gitCommit>
git tag --list "aanav-stable-*"
pg_restore --list GFX-Aanav/database/AANAV-*-stocksite.backup
```

Before any manual reset, copy the whole project and preserve `git diff --binary`. Emergency repair and rollback folders contain `metadata.json`, `git-status.txt`, `git-diff.patch`, and `git-diff-cached.patch`. To restore a database manually, stop the backend, make an independent current dump, confirm the target database, and use `pg_restore --clean --if-exists` with the environment's `DB_HOST`, `DB_PORT`, `DB_USER`, and `DB_NAME`. Database restoration is destructive and requires an independent backup first.

All command logs are under `GFX-Aanav/logs`; reports are under `GFX-Aanav/reports`. Internet assistance is not required for local checks and is disabled by default. GFX-Aanav never downloads or applies online code automatically. If future online diagnosis is added, it must remain operator-reviewed and backup-first.

The complete project folder can be copied to another drive or computer. Reinstalling Node.js is the only core runtime prerequisite; rerun the npm commands from the copied project after configuring the new machine's database, Redis, and optional image tools.
