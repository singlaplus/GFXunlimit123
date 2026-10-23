# Admin Backup System

The Admin Backup page exposes three complete categories: native PostgreSQL database, website code, and production assets plus centralized thumbnails. SERVER refers to the Windows machine holding the configured database and files; Developer refers to the macOS workstation whose authenticated requests are relayed to SERVER. Every job writes a new set under:

```text
<destination>/GFXunlimit/Backup-Set-<job-id>/Drive-<n>/
```

For multi-drive sets, combine the category trees from each `Drive-n` folder while retaining paths below `Database`, `Website-Code`, `Assets`, and `Thumbnails`. A `manifest.json` and streaming `checksums.sha256` file are written per drive. Files are streamed, checksummed after copy, and compared with their source before being counted complete.

## SERVER configuration

The backend process must have:

- `ASSETS_ROOT=F:\GFXunlimitAssets` set to the documented production original-asset directory
- `THUMBNAIL_STORAGE_PATH=F:\GFXunlimitThumbnails`
- `POSTGRES_DATA_DIRECTORY=D:\GFXunlimitDatabase` if the connected PostgreSQL account cannot report its data directory
- `PG_BIN_DIR` set to the PostgreSQL client `bin` directory when the tools are not on `PATH`; `PG_DUMP_PATH` and `PG_RESTORE_PATH` can still specify individual executables and take precedence
- `PG_DUMP_PATH` set to PostgreSQL `pg_dump` 18 or newer when a compatible executable is not found in the configured binary directory or on `PATH`
- `PG_RESTORE_PATH` set to PostgreSQL `pg_restore` 18 or newer when a compatible executable is not beside the selected `pg_dump`, in the configured binary directory, or on `PATH`
- `BACKUP_ENCRYPTION_KEY` set to a randomly generated 32-byte key, encoded as 64 hexadecimal characters or base64

Database connection settings are taken from the backend's existing `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, and `DB_NAME` environment values. The secret password is passed only to the `pg_dump` child process environment; it is not written into job status or manifests.

Backup requests made through the macOS Developer backend are relayed, with the authenticated admin request, to the configured `PC2_ASSET_SERVER_URL`. The Windows SERVER backend performs source discovery, planning, `pg_dump`, `pg_restore`, asset reads, and staging there; the Developer backend does not try to read SERVER drive paths or use its local database for these requests. The SERVER's `DB_HOST` and `DB_NAME` (or PostgreSQL equivalents `PGHOST` and `PGDATABASE`) must be explicit for backup operations; implicit localhost/database defaults are rejected. PostgreSQL clients are selected in this order: an individual `PG_DUMP_PATH` or `PG_RESTORE_PATH`, the configured `PG_BIN_DIR` (or `POSTGRES_BIN_DIR`), the process `PATH`, then a matching platform installation (including versioned Homebrew locations on macOS Apple Silicon and Intel). Each executable is validated with a bounded `--version` check and PostgreSQL major-version compatibility check before planning or backup execution.

The Backup Center periodically measures configured sources while open and also offers an authenticated manual refresh. Measurements identify the source environment, report per-source availability, file/table counts, and estimated sizes, and cache ordinary requests briefly to avoid repeated filesystem scans. PostgreSQL size is `pg_database_size` (an estimate of uncompressed database contents), not the size of a generated compressed dump; measurement never creates a dump. Filesystem size is the sum of eligible file sizes under the existing allowlist/exclusion rules. The bounded scanner rejects symbolic links and reports missing, unconfigured, inaccessible, or over-limit sources explicitly. Actual `.env` contents are never returned by source metrics; their sizes may contribute to the website-code estimate, while package inclusion remains encrypted and subject to the existing authorization/consent flows.

Website `.env` files are encrypted individually with AES-256-GCM before writing, at the same relative paths. If environment files are present and `BACKUP_ENCRYPTION_KEY` is missing or invalid, planning fails and the backup cannot start; they are never silently copied unencrypted. The key is never written to the destination or manifest. Store it securely outside the backup drives: without that key, encrypted environment files cannot be recovered. The destination and backup drives themselves should also be access-controlled.

## Restore package signing

Restore package generation is refused unless `RESTORE_PACKAGE_SIGNING_PRIVATE_KEY_FILE` names a protected Ed25519 private-key file on the package-generation server. The service rejects a symlink or, on POSIX, a key file with group/other permission bits. Keep the private key outside the repository, backups, and generated packages; on Windows, restrict the key file with an ACL to the backend service identity. The generated canonical package manifest is signed, and the local restore helper verifies it against `RESTORE_PACKAGE_SIGNING_PUBLIC_KEY` (base64-encoded Ed25519 SPKI DER) configured in the helper's `.env`. Distribute the public key through a separately trusted channel; a key bundled only inside the package is not a trust anchor. Missing or mismatched signing configuration fails closed. Existing unsigned restore packages are not accepted by the helper.

### Production Ed25519 key provisioning checklist

1. Preflight
   - Confirm the exact production package-generation service and the helper deployment that will verify the signed package.
   - Confirm that an authorized operator is responsible for key generation and secret management.
   - Review the deployment and secret-management procedures before any key material is created or installed.
   - Do not start a package-generation job, restore process, or real backup export while provisioning the key.

2. Generate the signing key
   - Generate a persistent Ed25519 key pair in an approved secure environment under the operator's control.
   - Protect the private key using the organization's approved secret-management mechanism (for example, a vault, HSM, KMS, or locked OS storage).
   - Configure the package generator to use `RESTORE_PACKAGE_SIGNING_PRIVATE_KEY_FILE` or the supported in-process `packageSigningPrivateKey` option.
   - Restrict the private-key file to the minimum required service identity; on POSIX, deny group and other permissions; on Windows, restrict access with the service account ACL.
   - Never place the private key in frontend code, restore packages, logs, source control, ordinary documentation, or temporary working directories.

3. Configure the trusted public key
   - Derive the matching public key from the generated private key.
   - Encode it in the expected base64-encoded Ed25519 SPKI DER format.
   - Deliver the public key to the helper operator through an authenticated, independent trusted channel.
   - Configure `RESTORE_PACKAGE_SIGNING_PUBLIC_KEY` in the helper's private `.env` or equivalent protected environment.
   - Never trust a public key supplied only inside the package being verified.
   - Independently compare the public-key fingerprint before enabling the helper to verify packages.

4. Verify configuration safely
   - Validate that the package generator can load the private key without error.
   - Validate that the helper can parse the configured public key without error.
   - Use only disposable synthetic fixtures to verify that a correctly signed package is accepted and that wrong-key, altered, unsigned, and malformed packages are all rejected.
   - Confirm that private-key material is absent from logs, API responses, package manifests, job state, and package output.
   - Do not use production data or generate a real package for this step.

5. Operational safeguards
   - Document key ownership, access control, backup/recovery, and rotation procedures.
   - Do not replace an active key without a coordinated helper update and out-of-band trust verification.
   - If a key is lost or compromised, suspend signed package generation or verification until trust is re-established.
   - Keep unsigned or unverifiable packages rejected by policy.

6. Acceptance gate
   - Production provisioning is complete only after the authorized operator confirms the actual configuration and independently verifies the helper's trusted public-key fingerprint.
   - A separate authorized non-production signed-package test is required before making any real Windows restore claims.
   - Production signing-key provisioning, real package download, and fresh-Windows acceptance remain untested until explicit authorized validation is performed in a non-production environment.

## Website Code source allowlist

The Website Code backup preserves project-relative paths and scans only these source roots:

- Project root: `package.json`, `package-lock.json` when present, setup/start scripts, Git attributes/ignore configuration, and all root `.env` variants.
- `backend/`: the backend source, routes, services, migrations, scripts, and configuration.
- `frontend/`: package manifests, Babel config, `.env` variants, and the complete `src/`, `public/`, and `scripts/` trees.
- Root `scripts/` and `GFX-Aanav/` project configuration/source.

The scan excludes dependency, build, cache, log, temporary, backup, upload, and staging directories/files. Actual environment files are encrypted individually and kept at their original relative paths. Safe configuration templates named `.env.example`, `.env.sample`, or `.env.template` (including suffixed variants) are copied as ordinary source files, not treated as secrets. The destination manifest never contains environment-file contents or the encryption key.

## Planning and execution

Destination validation is performed by the SERVER backend: it creates the path if needed, tests read/write/delete, and queries filesystem capacity. The fixed safety limit is 90% of total reported filesystem capacity, and remaining backup room is bounded by both that limit and current free space. The planner inventories actual files, groups originals by username and thumbnails by year/month, and assigns complete groups without splitting them. The database dump and website code are also indivisible plan groups. A job is rejected unless every selected group fits the tested destination set.

One job runs at a time. Job state and history are persisted under `backend/backup-system/`; the browser only polls server-side progress. Completed files have SHA-256 entries in `checksums.sha256`; the database dump is made with custom-format `pg_dump --create`, checked for a successful process exit and a valid custom-format signature, structurally inspected with a bounded `pg_restore --list`, and hashed. This TOC inspection verifies that the compatible restore utility can parse and enumerate the archive table of contents; it does not restore data or prove that every data block is complete or that a full restore will succeed. All manual and automatic jobs store the PostgreSQL database artifact at `Database/stocksite.backup`; the extension is only a filename convention and the contents remain custom-format archives for the supported `pg_restore` workflow.

Manual jobs may alternatively select **This Mac** in the Backup Center. Before planning is enabled, the browser obtains read/write permission and creates, reads, and removes a temporary test file in the chosen folder. The selected browser folder handle is used only by the browser's File System Access API and is never sent as a server path. The backend runs the same plan, copy, checksum, manifest, and verification flow into a server temporary staging directory, then exposes only files from that successful, verified manual job to the authenticated administrator for streamed transfer. On non-Windows systems the staging root is owner-only; on Windows it resides under the backend service account's OS temporary directory. The browser recreates `GFXunlimit/Backup-Set-<job-id>/Drive-1/` under the tested folder, checks each copied file's size and SHA-256 against `checksums.sha256`, and validates the manifest before reporting the local copy complete. No archive conversion or change to the backup-set format occurs. Unclaimed staging sets are scheduled for removal after 24 hours and expired sets are pruned at service startup or on the next export request; a successful browser transfer requests immediate cleanup. This requires a supported browser and read/write folder permission, and needs temporary free space on the backend server.

## Automatic schedules

The Admin page stores multiple automatic schedules on the SERVER backend in `backend/backup-system/automatic-schedule.json`; existing single-schedule files are upgraded to the list format when first read. The Saved Schedule popup lists enabled schedules and allows each schedule to be edited or deleted; a queued or active schedule cannot be deleted. Each schedule has its own destination, selected backup types, frequency, and time. Destinations must be distinct so schedules cannot replace one another's date folders. The server-side scheduler checks configured times every 15 seconds; when several schedules are due together, they are queued and run one at a time. Closing the browser does not stop a run. Schedules use the fixed `Asia/Kolkata` timezone. Daily, weekly, and monthly dates are calculated at runtime. Weekly schedules select a weekday; monthly schedules select a day from 1 through 31, with 31 mapped to the last day of shorter months.

Automatic jobs use the same source inventory, capacity planner, 90% safety limit, streaming copy, checksums, manifest, and verification as manual jobs. Database and Website Code are selected by default; Assets and Thumbnails can be explicitly enabled and must pass the same complete-group capacity checks. Each run is written under:

```text
<automatic destination>/Automatic Backups/YYYY-MM-DD/Database/
<automatic destination>/Automatic Backups/YYYY-MM-DD/Website-Code/
```

The date is the actual server-side run date. Retention is capped at 30 run folders per frequency, not 30 calendar days. Once the limit is reached, the oldest eligible folder for that frequency is renamed to the new run date and its contents are completely replaced. A reused folder is not merged with prior data. Schedule saves validate the destination and preflight the selected backup against its current capacity; execution plans again before writing.

Automatic destination browsing lists SERVER filesystem folders only. The SERVER-managed Developer-local manual-export staging root is hidden from that browser and rejected by backend destination validation. Schedule destinations are canonicalized when saved and checked again when a run starts, before folder preparation, and before output-file operations. These checks reduce stale-path and symlink redirection risk, but ordinary path-based filesystem calls are not atomic with validation; a concurrent filesystem change can still race a check. Use a destination whose parent directories are writable only by trusted administrators.

## Restore compatibility

The existing Restore tab starts an administrator-authenticated restore-package job on the configured SERVER. The administrator must explicitly authorize inclusion of encrypted `.env` configuration before START; without that request property, the route rejects the job. It reuses the verified manual backup pipeline to collect the database, allowlisted website source, originals, and thumbnails without modifying their configured source directories. The package job adds separate downloads for the custom-format `Database/stocksite.backup`, website-code ZIP, original-assets ZIP, thumbnail ZIP, standalone HTML wizard, helper ZIP, versioned software manifest, package documentation, package manifest, and SHA-256 inventory. Downloads are available only from a successful, verified job under the authenticated Backup Center route. Package output and job state are retained for up to 24 hours; completed job status survives page refresh and backend restart.

An unknown route under `/admin/backup/restore-package` is returned as HTTP 404 with `X-Stocksite-Error-Code: RESTORE_PACKAGE_ENDPOINT_NOT_FOUND` and the same JSON `code`. The Developer proxy translates only this explicit signal to its actionable HTTP 503 diagnostic. A normal job-not-found or artifact-not-found response remains HTTP 404, and a wrong method on a known route returns HTTP 405 without the missing-endpoint signal. Older SERVER backends that do not emit the explicit signal also remain HTTP 404 through the proxy; the proxy does not infer a missing endpoint from response text.

### Release file checklist (locally verified)

The following is a source-release checklist verified against the local route imports, service inputs, frontend imports, and package-generation code. It identifies files required in a coherent release; it does not establish that any of these files or settings are present in the deployed SERVER release.

- [ ] Deploy the backend application as a coherent unit, including the runtime route and generator files `backend/server.js`, `backend/config.js`, `backend/routes/backup-routes.js`, `backend/services/backupSystem.js`, and `backend/services/restorePackageSystem.js`. The route is mounted from `server.js`, uses the shared configuration and backup service, and creates the restore-package service.
- [ ] Preserve the normal backend startup and runtime dependencies, including `backend/startup/bootstrap.js`, `backend/db.js`, `backend/middleware/createAdminVerifier.js`, and the complete backend runtime source tree. The lifecycle startup/runtime path specifically imports `backend/services/assetLifecycleSchema.js`, `backend/services/assetLifecycleOperations.js`, `backend/services/assetFileMove.js`, `backend/services/assetDeletion.js`, `backend/services/assetLifecycleRouting.js`, and `backend/services/assetUploadLifecycle.js`. Keep `backend/migrations/028_asset_thumbnails.sql`, `backend/migrations/029_asset_lifecycle_operations.sql`, and `backend/migrations/030_idempotent_asset_uploads.sql` in the release; startup checks for their schema but does not apply these migrations. `backend/package.json` starts through `startup/bootstrap.js`; deploying only the Restore route/service files is not a deployable backend.
- [ ] Install backend dependencies from the matching `backend/package.json` and `backend/package-lock.json` using the deployment's normal lockfile-based install. The package generator imports `adm-zip`; the route and existing backup runtime also use the backend dependencies declared by the project.
- [ ] Include the complete tracked `restore-wizard/` source tree used by package generation: `restore-wizard/README.md`, `restore-wizard/restore-wizard.html`, `restore-wizard/restore-manifest.json`, and all files under `restore-wizard/helper/`, including `server.js`, `.env.example`, `package.json`, `package-lock.json`, `start-macos.sh`, `start-windows.cmd`, and `server.test.js`. The generator reads the README, HTML, and manifest directly and recursively packages the helper tree; it excludes `node_modules`, which is installed from the helper lockfile when required.
- [ ] For the website Restore tab, include the current frontend integration: `frontend/src/components/AdminPanel.js`, `frontend/src/pages/AdminBackupPage.jsx`, `frontend/src/pages/AdminBackupPage.css`, `frontend/src/components/RestorePackagePanel.jsx`, `frontend/src/utils/apiBaseUrl.js`, and `frontend/src/utils/streamSha256.js`, with the existing authentication/session utilities imported by those components. Build using the matching `frontend/package.json`, `frontend/package-lock.json`, and the normal frontend build inputs (including `frontend/scripts/validate-production-api.cjs`, `frontend/src/index.js`, and `frontend/public/index.html`); the UI code is part of the frontend build, not the backend package generator.
- [ ] `frontend/src/components/RestoreWizard.jsx` is not imported by `AdminPanel.js`, `AdminBackupPage.jsx`, or `RestorePackagePanel.jsx` in the verified Restore tab path. It is therefore not a dependency of that page's current integration; its presence alone does not establish a wired Restore UI.

The paths above are locally verified source requirements only. Before release, an authorized operator must separately confirm the deployed SERVER's matching code/dependency versions, database and source-path configuration, compatible PostgreSQL client tools, archive utility, protected signing-key configuration, encryption-key availability, and writable/access-controlled state and output storage. Do not print secret values while checking configuration. These SERVER-side facts have not been checked from this workstation.

`restore-package-manifest.json` is schema version 1 and records generation/source version details, PostgreSQL engine/server/`pg_dump` versions, dump timestamp, every download artifact's logical source, package destination, byte size, checksum or documented self-checksum scope, inclusion state, and verification result. Its source inventory records the relative path, size, SHA-256, inclusion state, and verification result of each collected payload file, including encrypted `.env` payloads without their contents. It also carries both exact relative-path exclusions observed during the scan and the policy patterns/reasons. The code allowlist includes applicable setup documentation, startup/config files, backend and frontend source/configuration/tests/migrations, scripts, and lockfiles. Generated dependency/build/cache/log/upload/backup data, OS metadata, editor files, common private-key/credential files, and root content outside the approved project roots are excluded. Credential-bearing `.npmrc` files are excluded while non-secret package configuration is preserved.

The manifest uses a canonical SHA-256 with its own digest fields nulled. The detached `checksums.sha256` contains that canonical manifest digest and all other artifact digests; it cannot contain its own checksum, so its manifest entry records size and entry-verification status but no self-referential digest. Source inventory and byte totals must match the already-verified source backup before the package can be marked READY. ZIP payloads are created with platform archive utilities and structurally tested; the Windows path explicitly includes hidden files and compares archive file counts and byte totals to the source inventory.

Package preflight depends on the configured database connection, compatible `pg_dump`/`pg_restore`, `BACKUP_ENCRYPTION_KEY`, `ASSETS_ROOT`, and `THUMBNAIL_STORAGE_PATH`. Data ZIP generation additionally requires `powershell.exe` with .NET `System.IO.Compression` support on Windows, or `/usr/bin/ditto` and `/usr/bin/unzip` on macOS. The Windows generator uses the .NET ZIP API from PowerShell; it does not invoke the `Compress-Archive` cmdlet. Missing configuration or tools causes the job to fail with a reported error; the implementation does not infer server paths or fall back to local storage.

The generated local helper requires explicit target confirmation, validates package checksums and ZIP inventories, streams website/originals/thumbnails archives into private staging folders, and refuses unsafe paths, links, special entries, and overwrites. It validates a custom-format PostgreSQL archive with `pg_restore --list`, refuses an existing or non-empty target database, configures local-only environment files, installs dependencies using the included lockfiles, builds the frontend, restores the database, starts the backend on loopback, and checks the backend/database health endpoint and built frontend before exposing the local launch link. Encrypted environment files are verified and skipped; local environment secrets must be configured manually from an approved source and are not copied into the helper ZIP or exposed in the frontend. The helper does not invoke migration scripts as a restore stage. However, launching the restored `backend/server.js` runs its normal `initializeThumbnailSystem()` startup initializer, which executes its individually loaded startup migration sequence (legacy migration files through 027) before checking that the schema from migrations 028, 029, and 030 is present; it does not apply those three lifecycle/upload migrations. Apply required schema migrations only through an independently approved process and use a disposable local database for restore acceptance. The backend's BullMQ thumbnail worker also expects Redis at `localhost:6379` by default. The helper neither installs/configures Redis nor includes Redis readiness in its success health checks, so background thumbnail-queue readiness must be verified separately. A helper-process restart loses its in-memory restore-job status, and post-failure database or destination cleanup may require operator action. The archive TOC check catches many malformed or truncated archives, but is not equivalent to a restore test and does not prove all archive data blocks are readable.

Developer-local export staging files may remain on the SERVER for up to 24 hours, but the current export verification requires the in-memory job plan. A SERVER backend restart loses that plan, so an untransferred staged set cannot be resumed after restart and will fail closed; no durable-plan reconstruction is currently supported.
