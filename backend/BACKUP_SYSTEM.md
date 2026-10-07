# Admin Backup System

The Admin Backup page exposes three complete categories: native PostgreSQL database, website code, and production assets plus centralized thumbnails. Every job writes a new set under:

```text
<destination>/GFXunlimit/Backup-Set-<job-id>/Drive-<n>/
```

For multi-drive sets, combine the category trees from each `Drive-n` folder while retaining paths below `Database`, `Website-Code`, `Assets`, and `Thumbnails`. A `manifest.json` and streaming `checksums.sha256` file are written per drive. Files are streamed, checksummed after copy, and compared with their source before being counted complete.

## PC2 configuration

The backend process must have:

- `ASSETS_ROOT=F:\GFXunlimitAssets`
- `THUMBNAIL_STORAGE_PATH=F:\GFXunlimitThumbnails`
- `POSTGRES_DATA_DIRECTORY=D:\GFXunlimitDatabase` if the connected PostgreSQL account cannot report its data directory
- `PG_DUMP_PATH` set to the PostgreSQL 18.6 `pg_dump.exe` when it is not on `PATH`
- `BACKUP_ENCRYPTION_KEY` set to a randomly generated 32-byte key, encoded as 64 hexadecimal characters or base64

Database connection settings are taken from the backend's existing `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, and `DB_NAME` environment values. The secret password is passed only to the `pg_dump` child process environment; it is not written into job status or manifests.

Website `.env` files are encrypted individually with AES-256-GCM before writing, at the same relative paths. The key is never written to the destination or manifest. Store it securely outside the backup drives: without that key, encrypted environment files cannot be recovered. The destination and backup drives themselves should also be access-controlled.

## Website Code source allowlist

The Website Code backup preserves project-relative paths and scans only these source roots:

- Project root: `package.json`, `package-lock.json` when present, setup/start scripts, Git attributes/ignore configuration, and all root `.env` variants.
- `backend/`: the backend source, routes, services, migrations, scripts, and configuration.
- `frontend/`: package manifests, Babel config, `.env` variants, and the complete `src/`, `public/`, and `scripts/` trees.
- Root `scripts/` and `GFX-Aanav/` project configuration/source.

The scan excludes dependency, build, cache, log, temporary, backup, upload, and staging directories/files. Any `.env` file found within the selected roots is encrypted and kept at its original relative path. The destination manifest never contains environment-file contents or the encryption key.

## Planning and execution

Destination validation is performed by the PC2 backend: it creates the path if needed, tests read/write/delete, and queries filesystem capacity. The fixed safety limit is 90% of total reported filesystem capacity, and remaining backup room is bounded by both that limit and current free space. The planner inventories actual files, groups originals by username and thumbnails by year/month, and assigns complete groups without splitting them. The database dump and website code are also indivisible plan groups. A job is rejected unless every selected group fits the tested destination set.

One job runs at a time. Job state and history are persisted under `backend/backup-system/`; the browser only polls server-side progress. Completed files have SHA-256 entries in `checksums.sha256`; the database dump is made with custom-format `pg_dump --create`, checked for nonzero size, and hashed. The database's own schema and data are stored in `Database/stocksite.dump`; no JSON-table snapshot is used.

## Automatic schedules

The Admin page stores one automatic schedule on the PC2 backend in `backend/backup-system/automatic-schedule.json`. Its server-side scheduler checks the configured time every 15 seconds; closing the browser does not stop a run. The schedule uses the backend server's configured timezone (`TZ`, or the operating-system timezone when unset). Daily, weekly, and monthly dates are calculated at runtime. Weekly schedules select a weekday; monthly schedules select a day from 1 through 31, with 31 mapped to the last day of shorter months.

Automatic jobs use the same source inventory, capacity planner, 90% safety limit, streaming copy, checksums, manifest, and verification as manual jobs. Database and Website Code are selected by default; Assets and Thumbnails can be explicitly enabled and must pass the same complete-group capacity checks. Each run is written under:

```text
<automatic destination>/Automatic Backups/YYYY-MM-DD/Database/
<automatic destination>/Automatic Backups/YYYY-MM-DD/Website-Code/
```

The date is the actual server-side run date. Retention is capped at 30 run folders per frequency, not 30 calendar days. Once the limit is reached, the oldest eligible folder for that frequency is renamed to the new run date and its contents are completely replaced. A reused folder is not merged with prior data. Schedule saves validate the destination and preflight the selected backup against its current capacity; execution plans again before writing.

## Restore compatibility

These backup sets are not `.gfxbackup` archives and are not accepted by the existing Restore page. Restore behavior is intentionally unchanged and requires a separate, explicitly scoped implementation before these sets can be restored through the UI.
