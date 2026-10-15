# Stocksite Restore Wizard

This tool prepares a separate local Stocksite restore on a computer you choose. It does not automatically install software or overwrite your existing website.

The computer that downloads this guide is not necessarily the restore target. Choose Windows or macOS in Step 1, and run the local helper on that same target computer. The helper runs as your signed-in user; it does not request elevation or change operating-system permissions.

## Follow the numbered wizard

1. **Choose your target.** Select the operating system of the computer that will run Stocksite. Detection only describes the browser computer and never selects the restore target for you.
2. **Prepare the computer and files.** Manually install Node.js LTS and PostgreSQL 18+ with `psql` and `pg_restore`. Create a new local PostgreSQL login role and an empty database owned by that role. Download `stocksite.backup`, `website-code.zip`, `original-assets.zip`, `thumbnails.zip`, `restore-package-manifest.json`, and `checksums.sha256` into one private folder. Extract `stocksite-restore-helper.zip` separately.
3. **Run the helper and check prerequisites.** In the helper folder, run `npm ci --ignore-scripts`, copy `.env.example` to `.env` without overwriting an existing file, and set a private random `RESTORE_HELPER_TOKEN` of at least 32 characters. Start `start-windows.cmd` or `./start-macos.sh` and open `http://127.0.0.1:43127/` on that same computer. The helper checks what is installed; it does not install Node.js/PostgreSQL, start PostgreSQL, or create a database.
4. **Enter local settings.** Provide the loopback database host, port, local role, role password, empty database name, and a free application port. A trusted administrator must provide the Ed25519 package-signing public key through a separate trusted channel. Do not trust a key found only inside the downloaded package. These settings are kept in helper memory for the run; never put the role password or helper token in a URL.
5. **Choose and verify package files.** Enter the local paths for the four payloads. The helper reads the signed manifest and checksum inventory from their folder and rejects missing, changed, unsafe, or mismatched files.
6. **Choose new destinations.** Enter three new, non-overlapping folders for website code, originals, and thumbnails. The helper refuses existing folders, insufficient free space, a remote database host, a database not owned by the configured role, and a database that is not empty.
7. **Review and approve.** Read the preflight report. Every consequential action—database restore, extraction, configuration, dependency install, build, and backend start—requires its own approval. One approval does not approve later actions.

## What the helper does and does not do

The helper can validate package signatures, checksums and archive paths; check local prerequisites and database ownership/emptiness; and, after separate approvals, restore the database, extract files into new folders, configure local application settings, install project dependencies, build and start the local application. It does not install operating-system software, create or drop PostgreSQL roles/databases, start operating-system services, change Windows permissions, or overwrite existing website folders.

**Important:** the website ZIP may include encrypted production `.env` settings because an administrator explicitly approved inclusion. The helper never decrypts or automatically installs those credentials. Configure new local settings. Never reuse production passwords, encryption keys, or JWT secrets on the restore computer.

## Simple explanations

- **Node.js:** software that runs the helper and website tools.
- **PostgreSQL:** the database program that stores Stocksite records.
- **Database:** a named collection of records inside PostgreSQL. The restore target must be new and empty.
- **Local folder:** a folder on the restore computer, such as `C:\Stocksite-Restore` or `/Users/you/Stocksite-Restore`.
- **Trusted public key:** a public verification key supplied separately by a trusted administrator. It checks who signed the package. It is not a private key, but choosing the wrong key means you cannot establish package authenticity.

## If a check fails

Read the named failed check and its “Next action.” Install or start only the missing local requirement yourself, then reopen the helper and run the check again. Correct misspelled paths and re-enter them. Do not point the wizard at an existing website folder or database to get past an error.

If PostgreSQL restore has started or files have been promoted, a later failure may be reported as **PARTIAL**. The helper does not roll back database changes or delete promoted data. Do not retry into a possibly partial database or folder; create a new empty database and new destination folders after reviewing the report. Redis-backed thumbnail processing and complete application compatibility require separate validation.

<details>
<summary>Technical details · generated files, trust, and limits</summary>

The setup-only helper ZIP contains this guide, `restore-wizard.html`, `restore-manifest.json`, and the helper's `.env.example`, Node entry point, package/lock files, and Windows/macOS launch scripts. It excludes the database backup, website archive, original assets, thumbnails, development `node_modules`, and tests. Those payload files remain separate downloads.

Restore package generation uses the authenticated Backup Center and requires explicit administrator consent before encrypted `.env` files are included. The configured SERVER must have a working PostgreSQL connection and dump tools, encryption key, configured original-asset and thumbnail roots, and platform ZIP tooling. The Developer frontend does not read SERVER filesystem paths. Do not generate a package unless the configured SERVER and source data are explicitly authorized and confirmed suitable.

The helper binds only to loopback, rejects remote database hosts, verifies a signed manifest with the independently trusted Ed25519 key, checks SHA-256 inventories and safe archive paths, and requires an empty database owned by the configured role. It does not establish complete source/schema compatibility. Normal backend startup may run migrations. Windows support and complete Windows restore acceptance must be validated on Windows; synthetic macOS tests do not prove it.

The helper does not install or check Redis. The restored application's background thumbnail queue may need Redis configured and running separately. No database integration test is run by this guide.

</details>
