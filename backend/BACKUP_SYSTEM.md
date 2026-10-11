# Admin Backup System

The Admin Backup page exposes three complete categories: native PostgreSQL database, website code, and production assets plus centralized thumbnails. Every job writes a new set under:

```text
<destination>/GFXunlimit/Backup-Set-<job-id>/Drive-<n>/
```

For multi-drive sets, combine the category trees from each `Drive-n` folder while retaining paths below `Database`, `Website-Code`, `Assets`, and `Thumbnails`. A `manifest.json` and streaming `checksums.sha256` file are written per drive. Files are streamed, checksummed after copy, and compared with their source before being counted complete.

## PC2 configuration

The backend process must have:

- `ASSETS_ROOT=F:\GFXunlimitAssets` set to the documented production original-asset directory
- `THUMBNAIL_STORAGE_PATH=F:\GFXunlimitThumbnails`
- `POSTGRES_DATA_DIRECTORY=D:\GFXunlimitDatabase` if the connected PostgreSQL account cannot report its data directory
- `PG_DUMP_PATH` set to PostgreSQL `pg_dump` 18 or newer when a compatible executable is not on `PATH`
- `PG_RESTORE_PATH` set to PostgreSQL `pg_restore` 18 or newer when a compatible executable is not beside the configured `pg_dump` or on `PATH`
- `BACKUP_ENCRYPTION_KEY` set to a randomly generated 32-byte key, encoded as 64 hexadecimal characters or base64

Database connection settings are taken from the backend's existing `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, and `DB_NAME` environment values. The secret password is passed only to the `pg_dump` child process environment; it is not written into job status or manifests.

Backup requests made through the macOS DEVELOPER backend are relayed, with the authenticated admin request, to the configured `PC2_ASSET_SERVER_URL`. The Windows SERVER backend performs source discovery, planning, `pg_dump`, `pg_restore`, asset reads, and staging there; the Mac backend does not try to read Windows drive paths or use its local database for these requests. The SERVER's `DB_HOST` and `DB_NAME` (or PostgreSQL equivalents `PGHOST` and `PGDATABASE`) must be explicit for backup operations; implicit localhost/database defaults are rejected. `PG_DUMP_PATH`, when set, selects the executable in the backend process environment; otherwise `pg_dump` is resolved from that backend process's `PATH`. `PG_RESTORE_PATH` can explicitly select the matching restore utility; when `PG_DUMP_PATH` is set and `PG_RESTORE_PATH` is not, the sibling `pg_restore` executable is used, otherwise it is resolved from `PATH`.

Website `.env` files are encrypted individually with AES-256-GCM before writing, at the same relative paths. If environment files are present and `BACKUP_ENCRYPTION_KEY` is missing or invalid, planning fails and the backup cannot start; they are never silently copied unencrypted. The key is never written to the destination or manifest. Store it securely outside the backup drives: without that key, encrypted environment files cannot be recovered. The destination and backup drives themselves should also be access-controlled.

## Website Code source allowlist

The Website Code backup preserves project-relative paths and scans only these source roots:

- Project root: `package.json`, `package-lock.json` when present, setup/start scripts, Git attributes/ignore configuration, and all root `.env` variants.
- `backend/`: the backend source, routes, services, migrations, scripts, and configuration.
- `frontend/`: package manifests, Babel config, `.env` variants, and the complete `src/`, `public/`, and `scripts/` trees.
- Root `scripts/` and `GFX-Aanav/` project configuration/source.

The scan excludes dependency, build, cache, log, temporary, backup, upload, and staging directories/files. Any `.env` file found within the selected roots is encrypted and kept at its original relative path. The destination manifest never contains environment-file contents or the encryption key.

## Planning and execution

Destination validation is performed by the PC2 backend: it creates the path if needed, tests read/write/delete, and queries filesystem capacity. The fixed safety limit is 90% of total reported filesystem capacity, and remaining backup room is bounded by both that limit and current free space. The planner inventories actual files, groups originals by username and thumbnails by year/month, and assigns complete groups without splitting them. The database dump and website code are also indivisible plan groups. A job is rejected unless every selected group fits the tested destination set.

One job runs at a time. Job state and history are persisted under `backend/backup-system/`; the browser only polls server-side progress. Completed files have SHA-256 entries in `checksums.sha256`; the database dump is made with custom-format `pg_dump --create`, checked for a successful process exit and a valid custom-format signature, structurally inspected with a bounded `pg_restore --list`, and hashed. This TOC inspection verifies that the compatible restore utility can parse and enumerate the archive table of contents; it does not restore data or prove that every data block is complete or that a full restore will succeed. All manual and automatic jobs store the PostgreSQL database artifact at `Database/stocksite.backup`; the extension is only a filename convention and the contents remain custom-format archives for the supported `pg_restore` workflow.

Manual jobs may alternatively select **This Mac** in the Backup Center. Before planning is enabled, the browser obtains read/write permission and creates, reads, and removes a temporary test file in the chosen folder. The selected browser folder handle is used only by the browser's File System Access API and is never sent as a server path. The backend runs the same plan, copy, checksum, manifest, and verification flow into a server temporary staging directory, then exposes only files from that successful, verified manual job to the authenticated administrator for streamed transfer. On non-Windows systems the staging root is owner-only; on Windows it resides under the backend service account's OS temporary directory. The browser recreates `GFXunlimit/Backup-Set-<job-id>/Drive-1/` under the tested folder, checks each copied file's size and SHA-256 against `checksums.sha256`, and validates the manifest before reporting the local copy complete. No archive conversion or change to the backup-set format occurs. Unclaimed staging sets are scheduled for removal after 24 hours and expired sets are pruned at service startup or on the next export request; a successful browser transfer requests immediate cleanup. This requires a supported browser and read/write folder permission, and needs temporary free space on the backend server.

## Automatic schedules

The Admin page stores multiple automatic schedules on the PC2 backend in `backend/backup-system/automatic-schedule.json`; existing single-schedule files are upgraded to the list format when first read. Each schedule has its own destination, selected backup types, frequency, and time. Destinations must be distinct so schedules cannot replace one another's date folders. The server-side scheduler checks configured times every 15 seconds; when several schedules are due together, they are queued and run one at a time. Closing the browser does not stop a run. Schedules use the fixed `Asia/Kolkata` timezone. Daily, weekly, and monthly dates are calculated at runtime. Weekly schedules select a weekday; monthly schedules select a day from 1 through 31, with 31 mapped to the last day of shorter months.

Automatic jobs use the same source inventory, capacity planner, 90% safety limit, streaming copy, checksums, manifest, and verification as manual jobs. Database and Website Code are selected by default; Assets and Thumbnails can be explicitly enabled and must pass the same complete-group capacity checks. Each run is written under:

```text
<automatic destination>/Automatic Backups/YYYY-MM-DD/Database/
<automatic destination>/Automatic Backups/YYYY-MM-DD/Website-Code/
```

The date is the actual server-side run date. Retention is capped at 30 run folders per frequency, not 30 calendar days. Once the limit is reached, the oldest eligible folder for that frequency is renamed to the new run date and its contents are completely replaced. A reused folder is not merged with prior data. Schedule saves validate the destination and preflight the selected backup against its current capacity; execution plans again before writing.

Automatic destination browsing lists server filesystem folders only. The server-managed Mac-local manual-export staging root is hidden from that browser and rejected by backend destination validation. Schedule destinations are canonicalized when saved and checked again when a run starts, before folder preparation, and before output-file operations. These checks reduce stale-path and symlink redirection risk, but ordinary path-based filesystem calls are not atomic with validation; a concurrent filesystem change can still race a check. Use a destination whose parent directories are writable only by trusted administrators.

## Restore compatibility

These backup sets are not `.gfxbackup` archives and are not accepted by the existing Restore page. Restore behavior is intentionally unchanged and requires a separate, explicitly scoped implementation before these sets can be restored through the UI. The database artifact can be inspected with `pg_restore --list <backup-set>/Drive-1/Database/stocksite.backup` and restored with the supported `pg_restore` workflow. A dump is accepted only after `pg_dump` exits successfully, the output is a regular file of valid size with a custom-format signature, a compatible `pg_restore --list` exits successfully with TOC output within 60 seconds, and every planned payload is present and matches the finalized SHA-256 inventory. The TOC check catches many malformed or truncated archives, but is not equivalent to a restore test and does not prove all archive data blocks are readable.

Mac-local export staging files may remain on the server for up to 24 hours, but the current export verification requires the in-memory job plan. A backend restart loses that plan, so an untransferred staged set cannot be resumed after restart and will fail closed; no durable-plan reconstruction is currently supported.
