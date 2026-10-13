'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = fs.promises;
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { pipeline } = require('node:stream/promises');
const { Transform, Writable } = require('node:stream');
const yauzl = require('yauzl');

const MANIFEST_PATH = path.resolve(__dirname, '..', 'restore-manifest.json');
const BUNDLED_MANIFEST_SHA256 = 'c8e6018f9d88fe84e782c4607b9abd7e89b188e9cecbbac02a4d08c95fba7f1d';
const EMPTY_DATABASE_PREFLIGHT_SQL = `SELECT current_setting('server_version_num') || '|' || COALESCE(inet_server_addr()::text, '') || '|' || inet_server_port() || '|' || (
  (SELECT count(*) FROM pg_namespace WHERE nspname NOT IN ('pg_catalog','information_schema','public') AND nspname !~ '^pg_toast')
  + (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_toast')
  + (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_toast')
  + (SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_toast')
  + (SELECT count(*) FROM pg_collation c JOIN pg_namespace n ON n.oid=c.collnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema'))
  + (SELECT count(*) FROM pg_conversion c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema'))
  + (SELECT count(*) FROM pg_operator o JOIN pg_namespace n ON n.oid=o.oprnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema'))
  + (SELECT count(*) FROM pg_opclass o JOIN pg_namespace n ON n.oid=o.opcnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema'))
  + (SELECT count(*) FROM pg_opfamily o JOIN pg_namespace n ON n.oid=o.opfnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema'))
  + (SELECT count(*) FROM pg_event_trigger)
  + (SELECT count(*) FROM pg_publication)
  + (SELECT count(*) FROM pg_largeobject_metadata)
) || '|' || current_user || '|' || (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database());`;
const SUPPORTED_CHECKS = new Set(['node-version', 'pg-restore-version', 'psql-version', 'git-version', 'npm-cli']);
const EXPECTED_PACKAGE_ARTIFACTS = new Map([
  ['database', 'stocksite.backup'],
  ['websiteCode', 'website-code.zip'],
  ['originalAssets', 'original-assets.zip'],
  ['thumbnails', 'thumbnails.zip'],
  ['wizardHtml', 'stocksite-restore-wizard.html'],
  ['helperZip', 'stocksite-restore-helper.zip'],
  ['softwareManifest', 'restore-manifest.json'],
  ['packageDocumentation', 'RESTORE_PACKAGE_README.md'],
  ['packageManifest', 'restore-package-manifest.json'],
  ['packageChecksums', 'checksums.sha256']
]);
const MAX_ARCHIVE_ENTRIES = 1_000_000;
const RESTORE_TASKS = [
  ['validate-package', 'Validate package manifest, checksums, and archives'],
  ['prepare-staging', 'Prepare private temporary restore folders'],
  ['restore-postgresql-custom-archive', 'Restore PostgreSQL custom archive into the empty database'],
  ['extract-website-code', 'Extract website code archive'],
  ['extract-original-assets', 'Extract original assets archive'],
  ['extract-thumbnails', 'Extract thumbnail archive'],
  ['check-source-compatibility', 'Review source revision metadata; full compatibility is not guaranteed'],
  ['configure-local-environment', 'Configure local application environment'],
  ['install-backend-dependencies', 'Install backend dependencies'],
  ['install-frontend-dependencies', 'Install frontend dependencies'],
  ['build-frontend', 'Build frontend'],
  ['validate-database', 'Validate database connectivity'],
  ['validate-application-schema', 'Check required lifecycle schema without applying migrations'],
  ['promote-destinations', 'Move verified staged files into the new destination folders'],
  ['validate-storage', 'Validate asset and thumbnail paths'],
  ['launch-backend', 'Start local backend'],
  ['health-check-backend', 'Check backend and database health'],
  ['health-check-frontend', 'Check local website health'],
  ['launch-local-website', 'Launch restored website']
];

const SAFE_INHERITED_ENVIRONMENT_KEYS = [
  'PATH', 'HOME', 'USER', 'LOGNAME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL',
  'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT', 'APPDATA', 'LOCALAPPDATA',
  'PROGRAMFILES', 'PROGRAMFILES(X86)', 'SSL_CERT_FILE', 'SSL_CERT_DIR'
];

const UNVERIFIED_RESTORE_STAGES = [
  'User sign-in and authenticated application flows',
  'Delivery of individual original assets and thumbnails through application routes',
  'Redis-backed thumbnail queue readiness and background processing',
  'Complete compatibility of all application schemas and migrations'
];

function getLocalPostgresSettings(environment = process.env) {
  const configuredHost = String(environment.RESTORE_APP_DB_HOST || 'localhost').trim();
  if (!['localhost', '127.0.0.1', '::1'].includes(configuredHost.toLowerCase())) {
    throw new Error('Restore target PostgreSQL must be local (localhost, 127.0.0.1, or ::1); remote database targets are blocked.');
  }
  const host = configuredHost.toLowerCase() === 'localhost' ? '127.0.0.1' : configuredHost;
  const port = Number(environment.RESTORE_APP_DB_PORT || 5432);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Local PostgreSQL port must be a valid TCP port.');
  const user = String(environment.RESTORE_APP_DB_USER || '').trim();
  if (!user || /[\r\n\0]/.test(user)) throw new Error('Configure RESTORE_APP_DB_USER in the helper environment before restoring.');
  const password = String(environment.RESTORE_APP_DB_PASSWORD || '');
  if (/[\r\n\0]/.test(password)) throw new Error('Local PostgreSQL password cannot contain line breaks.');
  const databaseName = String(environment.RESTORE_APP_DB_NAME || '').trim();
  if (databaseName && !/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(databaseName)) {
    throw new Error('Local restore database name must be 1-63 letters, numbers, or underscores and cannot start with a number.');
  }
  const jwtSecret = String(environment.RESTORE_APP_JWT_SECRET || '');
  if (jwtSecret.length < 32 || /[\r\n\0]/.test(jwtSecret)) {
    throw new Error('Configure RESTORE_APP_JWT_SECRET with at least 32 characters in the helper environment before restoring.');
  }
  const backendPort = Number(environment.RESTORE_APP_PORT || 5001);
  if (!Number.isInteger(backendPort) || backendPort < 1024 || backendPort > 65535) {
    throw new Error('RESTORE_APP_PORT must be an available non-privileged TCP port.');
  }
  return { host, port, user, password, databaseName, jwtSecret, backendPort };
}

function parseTrustedRestorePublicKey(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+=*$/.test(value) ||
      Buffer.from(value, 'base64').toString('base64') !== value) {
    throw new Error('Trusted package public key must be base64-encoded Ed25519 SPKI DER from an independently trusted source.');
  }
  let publicKey;
  try {
    publicKey = crypto.createPublicKey({
      key: Buffer.from(value, 'base64'),
      type: 'spki',
      format: 'der'
    });
  } catch (_error) {
    throw new Error('Trusted package public key is not a valid Ed25519 SPKI DER public key.');
  }
  if (publicKey.asymmetricKeyType !== 'ed25519') {
    throw new Error('Trusted package public key must use Ed25519.');
  }
  return publicKey;
}

function assertEmptyOwnedDatabasePreflight(output, settings) {
  const [serverVersion, serverAddress, serverPort, objectCount, connectedRole, databaseOwner] = String(output || '').split('|');
  if (!Number.isInteger(Number(serverVersion)) || Number(serverVersion) < 180000 ||
      !isLoopbackAddress(serverAddress) || Number(serverPort) !== settings.port) {
    throw new Error('The selected database connection did not verify as PostgreSQL 18+ on the configured loopback host and port.');
  }
  if (connectedRole !== settings.user || databaseOwner !== settings.user) {
    throw new Error('The selected database must be owned by the configured dedicated local application role. In pgAdmin, create a new database and set its Owner to that same role.');
  }
  if (Number(objectCount) !== 0) {
    throw new Error('The selected database is not empty. Create a new dedicated local database; existing databases cannot be reused or overwritten.');
  }
  return true;
}

function isLoopbackAddress(value) {
  const address = String(value || '').replace(/\/\d+$/, '').toLowerCase();
  if (net.isIP(address) === 4) return address.split('.').length === 4 && Number(address.split('.')[0]) === 127;
  return net.isIP(address) === 6 && address === '::1';
}

function childEnvironment(overrides = {}) {
  const env = {};
  for (const key of SAFE_INHERITED_ENVIRONMENT_KEYS) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return { ...env, ...overrides };
}

function dotenvValue(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function isSecretEnvironmentPath(value) {
  const name = path.posix.basename(String(value || '').replace(/\\/g, '/'));
  return /^\.env(?:$|[.-])/i.test(name) &&
    !/^\.env\.(?:example|sample|template)(?:$|[.-])/i.test(name);
}

function compareArchiveInventory(actualPaths, expectedPaths, label = 'Restore') {
  if (!(actualPaths instanceof Set) || !(expectedPaths instanceof Set) ||
      actualPaths.size !== expectedPaths.size ||
      [...actualPaths].some((entry) => !expectedPaths.has(entry))) {
    throw new Error(`${label} ZIP entries do not match the verified source inventory or contain unsafe paths.`);
  }
  return true;
}

function getFrontendAssetUrls(html, baseUrl) {
  if (typeof html !== 'string' || !/<div[^>]+id=["']root["']/.test(html)) {
    throw new Error('Frontend root did not return the built Stocksite HTML.');
  }
  const resources = [];
  for (const match of html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)) {
    resources.push({ path: match[1], kind: 'javascript' });
  }
  for (const match of html.matchAll(/<link\b(?=[^>]*\brel=["']stylesheet["'])(?=[^>]*\bhref=["']([^"']+)["'])[^>]*>/gi)) {
    resources.push({ path: match[1], kind: 'stylesheet' });
  }
  if (!resources.some(({ kind }) => kind === 'javascript')) {
    throw new Error('Built frontend HTML does not reference its JavaScript application bundle.');
  }
  return resources.map(({ path: source, kind }) => {
    let url;
    try {
      url = new URL(source, baseUrl);
    } catch (_error) {
      throw new Error('Built frontend references an invalid application resource URL.');
    }
    const expectedExtension = kind === 'javascript' ? /\.js$/i : /\.css$/i;
    if (url.origin !== baseUrl || !url.pathname.startsWith('/static/') || !expectedExtension.test(url.pathname)) {
      throw new Error('Built frontend references a resource outside its local static asset directory.');
    }
    return { url: url.toString(), kind };
  });
}

async function promoteStagedDirectory(stagingPath, destinationPath, isCancelled = () => false, onDestinationCreated = () => {}) {
  const sourceStat = await fsp.lstat(stagingPath);
  if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) {
    throw new Error('Restore staging source is not a safe directory.');
  }
  const sourceRoot = await fsp.realpath(stagingPath);
  const destinationParent = await fsp.realpath(path.dirname(destinationPath));
  const finalDestination = path.join(destinationParent, path.basename(destinationPath));

  const copyEntries = async (sourceDirectory, destinationDirectory) => {
    for (const entry of await fsp.readdir(sourceDirectory, { withFileTypes: true })) {
      if (isCancelled()) throw new Error(`Promotion cancelled after partially creating ${path.basename(finalDestination)}; already-promoted files were left in place.`);
      const source = path.join(sourceDirectory, entry.name);
      const target = path.join(destinationDirectory, entry.name);
      const stat = await fsp.lstat(source);
      if (stat.isSymbolicLink()) throw new Error('Restore staging contains a symbolic link; promotion stopped.');
      if (stat.isDirectory()) {
        await fsp.mkdir(target, { recursive: false, mode: 0o700 });
        await copyEntries(source, target);
      } else if (stat.isFile()) {
        await fsp.link(source, target);
      } else {
        throw new Error('Restore staging contains a special file; promotion stopped.');
      }
    }
  };
  try {
    await fsp.mkdir(finalDestination, { recursive: false, mode: 0o700 });
    onDestinationCreated(finalDestination);
    await copyEntries(sourceRoot, finalDestination);
  } catch (error) {
    const detail = error.code === 'EEXIST'
      ? 'A destination path appeared during restore; no existing path was replaced.'
      : `Promotion stopped; the destination may contain files already promoted and was not deleted. ${safeLog(error.message)}`;
    throw new Error(detail);
  }
}

function assertRequiredRestoreTasksComplete(tasks) {
  const incomplete = tasks.find((task) => task.required && task.status !== 'COMPLETED');
  if (incomplete) throw new Error(`Required restore task did not complete: ${incomplete.name}.`);
}

function assertLifecycleSchemaReady(schemaStatus) {
  if (schemaStatus?.ready === true) return true;
  const missing = Array.isArray(schemaStatus?.missing) ? schemaStatus.missing.join(', ') : 'schema readiness query failed';
  const migrations = new Set();
  if (/asset_thumbnail_metadata|asset_thumbnail_orphans/i.test(missing)) migrations.add('028');
  if (/asset_lifecycle_operations/i.test(missing)) migrations.add('029');
  if (/upload_request|upload_content|upload_file_|upload_target_status|upload_error|images_upload_request_owner_uidx/i.test(missing)) migrations.add('030');
  const migrationHint = migrations.size ? ` Check required migration(s): ${[...migrations].join(', ')}.` : '';
  throw new Error(`Required asset upload/lifecycle schema is incompatible or incomplete: ${missing}.${migrationHint} No migrations were applied by this check.`);
}

function loadEnvironment(filePath) {
  try {
    for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
      const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
      if (match && !Object.hasOwn(process.env, match[1])) {
        process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function validateManifest(manifest) {
  if (
    !manifest ||
    manifest.schema !== 'stocksite.restore-manifest' ||
    manifest.schemaVersion !== 1 ||
    typeof manifest.manifestVersion !== 'string' ||
    !Array.isArray(manifest.software) ||
    !Array.isArray(manifest.operations)
  ) throw new Error('Restore manifest schema is invalid.');

  const ids = new Set();
  for (const item of manifest.software) {
    if (
      !item ||
      !/^[a-z0-9][a-z0-9-]{0,63}$/.test(item.id) ||
      ids.has(item.id) ||
      typeof item.name !== 'string' ||
      typeof item.version !== 'string' ||
      typeof item.required !== 'boolean' ||
      !Array.isArray(item.osCompatibility) ||
      !Array.isArray(item.dependencies) ||
      !Array.isArray(item.validationChecks) ||
      item.validationChecks.some((check) => !SUPPORTED_CHECKS.has(check)) ||
      !['verified-package-manager', 'bundled-with-node', 'manual'].includes(item.installationMethod) ||
      !['node-runtime', 'postgresql-client', 'git', 'none'].includes(item.installAction)
    ) throw new Error(`Restore manifest software entry is invalid: ${item?.id || 'unknown'}`);
    const source = new URL(item.officialDownloadSource);
    if (source.protocol !== 'https:') throw new Error(`Software source must use HTTPS: ${item.id}`);
    if (item.directDownloadUrl !== null && item.directDownloadUrl !== undefined) {
      const direct = new URL(item.directDownloadUrl);
      if (direct.protocol !== 'https:') throw new Error(`Direct software download must use HTTPS: ${item.id}`);
    }
    ids.add(item.id);
  }
  for (const item of manifest.software) {
    if (item.dependencies.some((id) => !ids.has(id))) {
      throw new Error(`Restore manifest has an unknown software dependency: ${item.id}`);
    }
  }
  return manifest;
}

function compareVersion(output, minimumMajor) {
  const match = String(output).match(/v?(\d+)\.(\d+)(?:\.(\d+))?/);
  return Boolean(match && Number(match[1]) >= minimumMajor);
}

function isSupportedNodeRuntime(version, ltsName) {
  const match = /^v?(\d+)\./.exec(String(version || ''));
  return Boolean(match && Number(match[1]) >= 22 && typeof ltsName === 'string' && ltsName.length > 0);
}

function assertMinimumVersion(output, minimumMajor, softwareName, downloadSource) {
  if (compareVersion(output, minimumMajor)) return true;
  const version = String(output).match(/v?(\d+)\.(\d+)(?:\.(\d+))?/);
  const detected = version ? `${version[1]}.${version[2]}${version[3] ? `.${version[3]}` : ''}` : 'unknown';
  throw new Error(
    `${softwareName} version ${detected} is unsupported; ${minimumMajor}.x or newer is required. ` +
    `Install or update it from ${downloadSource}, then retry.`
  );
}

function terminateChildProcess(child, { platform = process.platform, detached = false } = {}) {
  if (!child) return Promise.resolve(true);
  if (child.exitCode !== null && child.exitCode !== undefined) return Promise.resolve(true);
  const fallback = () => {
    try {
      return child.kill('SIGTERM') !== false;
    } catch (_error) {
      return false;
    }
  };
  if (platform !== 'win32' && detached && Number.isInteger(child.pid)) {
    try {
      process.kill(-child.pid, 'SIGTERM');
      return Promise.resolve(true);
    } catch (error) {
      if (error.code === 'ESRCH') return Promise.resolve(true);
      return Promise.resolve(fallback());
    }
  }
  return Promise.resolve(fallback());
}

function parseWindowsPostgresServices(output) {
  let services;
  try {
    services = JSON.parse(String(output || '[]'));
  } catch (_error) {
    return { status: 'unknown', services: [], message: 'Could not read Windows PostgreSQL service status.' };
  }
  if (!Array.isArray(services)) services = [services];
  const postgresServices = services.filter((service) =>
    service && typeof service.Name === 'string' && /^postgresql/i.test(service.Name)
  );
  if (!postgresServices.length) {
    return { status: 'missing', services: [], message: 'No PostgreSQL Windows service was found. Install PostgreSQL Server or configure a local server.' };
  }
  const running = postgresServices.filter((service) => String(service.Status).toLowerCase() === 'running');
  return {
    status: running.length ? 'running' : 'stopped',
    services: postgresServices.map(({ Name, Status }) => ({ name: Name, status: String(Status) })),
    message: running.length
      ? 'A PostgreSQL Windows service is running.'
      : 'A PostgreSQL Windows service is installed but stopped. Start it from Windows Services, then retry.'
  };
}

function parseWindowsSystem(output, runtimeArchitecture = process.arch) {
  let system;
  try {
    system = JSON.parse(String(output || 'null'));
  } catch (_error) {
    system = null;
  }
  if (!system || typeof system !== 'object') {
    return {
      versionStatus: 'unknown',
      version: null,
      architectureStatus: 'unknown',
      architecture: null,
      versionMessage: 'Could not detect the Windows version. Check Settings > System > About.',
      architectureMessage: 'Could not detect Windows architecture. Check Settings > System > About.'
    };
  }

  const caption = String(system.Caption || '');
  const version = String(system.Version || '');
  const osArchitecture = String(system.OSArchitecture || '');
  const desktopWindows = /\bWindows 11\b/i.test(caption);
  const versionMatch = /^10\.0\.(\d+)$/.exec(version);
  const supportedBuild = Boolean(versionMatch && Number(versionMatch[1]) >= 26200);
  const versionReady = desktopWindows && supportedBuild;
  const architectureReady = /64-bit/i.test(osArchitecture) && runtimeArchitecture === 'x64';

  return {
    versionStatus: versionReady ? 'ready' : 'unsupported',
    version,
    architectureStatus: architectureReady ? 'ready' : 'unsupported',
    architecture: `${osArchitecture || 'unknown'} (Node ${runtimeArchitecture})`,
    versionMessage: versionReady
      ? `${caption} (${version}) detected.`
      : `${caption || 'This Windows version'} (${version || 'version unavailable'}) is not a supported Windows 11 desktop release (build 26200 or newer). Update to Windows 11 25H2 or newer; Windows 10 Home/Pro is out of support.`,
    architectureMessage: architectureReady
      ? `64-bit Windows and x64 Node.js detected.`
      : `This restore helper requires 64-bit Windows and x64 Node.js; detected ${osArchitecture || 'unknown Windows architecture'} and ${runtimeArchitecture} Node.js.`
  };
}

function isTcpPortAvailable(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, host, () => server.close(() => resolve(true)));
  });
}

function resolveNpmCli(environment = process.env, nodeExecutable = process.execPath) {
  const nodeDirectory = path.dirname(nodeExecutable);
  const candidates = [
    environment.RESTORE_NPM_CLI,
    path.join(nodeDirectory, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.resolve(nodeDirectory, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')
  ].filter(Boolean);
  return candidates.map((candidate) => path.resolve(candidate)).find((candidate) => {
    try {
      return fs.statSync(candidate).isFile();
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false;
      throw error;
    }
  }) || null;
}

function safeLog(value) {
  return String(value)
    .replace(/(authorization\s*[=:]\s*Bearer\s+)\S+/ig, '$1[REDACTED]')
    .replace(/((?:[A-Z0-9_]*(?:PASSWORD|TOKEN|SECRET|CREDENTIAL|PRIVATE_KEY|API_KEY)[A-Z0-9_]*))\s*[=:]\s*([^\s,;]+)/ig, '$1=[REDACTED]')
    .replace(/\bBearer\s+\S+/ig, 'Bearer [REDACTED]')
    .replace(/postgres(?:ql)?:\/\/[^\s]+/ig, 'postgresql://[REDACTED]');
}

function validateArchiveEntryPath(value) {
  if (
    typeof value !== 'string' ||
    !value ||
    value.includes('\0') ||
    value.includes('\\') ||
    value.normalize('NFC') !== value ||
    path.posix.isAbsolute(value) ||
    path.win32.isAbsolute(value) ||
    /^[a-z]:/i.test(value) ||
    value.split('/').some((part) =>
      !part ||
      part === '.' ||
      part === '..' ||
      /[<>:"|?*\u0000-\u001f]/.test(part) ||
      /[. ]$/.test(part) ||
      /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)
    )
  ) throw new Error('Unsafe archive entry path.');
  return value;
}

async function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  let sizeBytes = 0;
  for await (const chunk of fs.createReadStream(filePath)) {
    hash.update(chunk);
    sizeBytes += chunk.length;
  }
  return { sha256: hash.digest('hex'), sizeBytes };
}

function createRestoreHelper(options = {}) {
  const environment = { ...(options.environment || process.env) };
  const generatedJwtSecret = !String(environment.RESTORE_APP_JWT_SECRET || '').trim();
  if (generatedJwtSecret) {
    environment.RESTORE_APP_JWT_SECRET = crypto.randomBytes(32).toString('base64url');
  }
  const token = environment.RESTORE_HELPER_TOKEN || '';
  const uiOrigin = environment.RESTORE_UI_ORIGIN || 'http://localhost:3000';
  const manifestPath = options.manifestPath || MANIFEST_PATH;
  const jobs = new Map();
  const spawnProcess = options.spawn || spawn;
  const promoteDirectory = options.promoteDirectory || promoteStagedDirectory;
  const removeStagingDirectory = options.removeStagingDirectory || ((stagingPath) =>
    fsp.rm(stagingPath, { recursive: true, force: false }));
  const platform = options.platform || process.platform;
  let activeJobId = null;
  const helperTokenConfigured = token.length >= 32 && !/^replace-with-/i.test(token);
  let configurationInProgress = false;
  let restoreStartInProgress = false;

  function applyLocalConfiguration(configuration) {
    if (!configuration || typeof configuration !== 'object' || Array.isArray(configuration)) {
      throw new Error('Enter the local PostgreSQL settings in the configuration form.');
    }
    const databaseName = String(configuration.databaseName || '').trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(databaseName)) {
      throw new Error('Database name must be 1-63 letters, numbers, or underscores and cannot start with a number.');
    }
    const password = String(configuration.databasePassword || '');
    if (!password || /[\r\n\0]/.test(password)) {
      throw new Error('Enter the password for the dedicated local PostgreSQL role. Passwords cannot contain line breaks.');
    }
    if (!String(configuration.databaseHost || '').trim()) {
      throw new Error('Enter the local PostgreSQL host. Use 127.0.0.1; remote hosts are blocked.');
    }
    if (!String(configuration.databasePort || '').trim()) {
      throw new Error('Enter the local PostgreSQL port shown in pgAdmin (normally 5432).');
    }
    if (!String(configuration.applicationPort || '').trim()) {
      throw new Error('Enter a local Stocksite port (the suggested value is 5001).');
    }
    const candidate = {
      ...environment,
      RESTORE_APP_DB_HOST: String(configuration.databaseHost || ''),
      RESTORE_APP_DB_PORT: String(configuration.databasePort || ''),
      RESTORE_APP_DB_NAME: databaseName,
      RESTORE_APP_DB_USER: String(configuration.databaseUser || ''),
      RESTORE_APP_DB_PASSWORD: password,
      RESTORE_APP_PORT: String(configuration.applicationPort || environment.RESTORE_APP_PORT || '5001')
    };
    getLocalPostgresSettings(candidate);
    const publicKeyValue = String(configuration.packageSigningPublicKey || '').trim();
    if (publicKeyValue) parseTrustedRestorePublicKey(publicKeyValue);
    else if (environment.RESTORE_PACKAGE_SIGNING_PUBLIC_KEY) {
      parseTrustedRestorePublicKey(environment.RESTORE_PACKAGE_SIGNING_PUBLIC_KEY);
    } else {
      throw new Error('A trusted Ed25519 public key is required. Obtain it through a trusted channel separate from the restore package and enter it here; the helper never trusts a key supplied by the package.');
    }
    Object.assign(environment, {
      RESTORE_APP_DB_HOST: candidate.RESTORE_APP_DB_HOST,
      RESTORE_APP_DB_PORT: candidate.RESTORE_APP_DB_PORT,
      RESTORE_APP_DB_NAME: candidate.RESTORE_APP_DB_NAME,
      RESTORE_APP_DB_USER: candidate.RESTORE_APP_DB_USER,
      RESTORE_APP_DB_PASSWORD: candidate.RESTORE_APP_DB_PASSWORD,
      RESTORE_APP_PORT: candidate.RESTORE_APP_PORT
    });
    if (publicKeyValue) environment.RESTORE_PACKAGE_SIGNING_PUBLIC_KEY = publicKeyValue;
    return {
      databaseConfigured: true,
      databaseNameConfigured: true,
      trustedPackageKeyConfigured: Boolean(environment.RESTORE_PACKAGE_SIGNING_PUBLIC_KEY),
      jwtSecretMode: generatedJwtSecret ? 'generated-local-only' : 'configured-local'
    };
  }

  function runProbe(executable, args, env = childEnvironment()) {
    return new Promise((resolve) => {
      let child;
      try {
        child = spawnProcess(executable, args, {
          env,
          windowsHide: true,
          shell: false,
          stdio: ['ignore', 'pipe', 'pipe']
        });
      } catch (_error) {
        resolve({ ok: false, output: '' });
        return;
      }
      let output = '';
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };
      const collect = (stream) => stream?.on('data', (chunk) => {
        output = `${output}${chunk.toString('utf8')}`.slice(-4096);
      });
      collect(child.stdout);
      collect(child.stderr);
      const timer = setTimeout(() => {
        void terminateChildProcess(child, { platform });
        finish({ ok: false, output: '' });
      }, 10_000);
      child.once('error', () => finish({ ok: false, output: '' }));
      child.once('close', (code) => finish({ ok: code === 0, output: output.trim() }));
    });
  }

  async function getPrerequisites() {
    const nodeSupported = isSupportedNodeRuntime(process.version, process.release.lts);
    const npmCli = resolveNpmCli(environment);
    const npmProbe = npmCli
      ? await runProbe(process.execPath, [npmCli, '--version'])
      : { ok: false, output: '' };
    const [pgRestoreProbe, psqlProbe, pgDumpProbe] = await Promise.all([
      runProbe('pg_restore', ['--version']),
      runProbe('psql', ['--version']),
      runProbe('pg_dump', ['--version'])
    ]);
    const versionCheck = (name, probe, minimumMajor, downloadUrl) => {
      const supported = probe.ok && compareVersion(probe.output, minimumMajor);
      return {
        name,
        status: supported ? 'ready' : probe.ok ? 'unsupported' : 'missing',
        version: probe.ok ? probe.output : null,
        downloadUrl,
        message: supported
          ? 'Supported version detected.'
          : probe.ok
            ? `${name} ${probe.output} is too old; version ${minimumMajor} or newer is required. Install the PostgreSQL 18+ command-line tools from the official PostgreSQL downloads page, reopen the helper, then check this PC again.`
            : `${name} was not found on PATH. Install PostgreSQL 18+ command-line tools from the official PostgreSQL downloads page, ensure its bin folder is on PATH, reopen the helper, then check this PC again.`
      };
    };
    let trustedKeyReady = false;
    try {
      if (environment.RESTORE_PACKAGE_SIGNING_PUBLIC_KEY) {
        parseTrustedRestorePublicKey(environment.RESTORE_PACKAGE_SIGNING_PUBLIC_KEY);
        trustedKeyReady = true;
      }
    } catch (_error) {
      trustedKeyReady = false;
    }
    let helperDependencyReady = false;
    try {
      require.resolve('yauzl', { paths: [__dirname] });
      helperDependencyReady = true;
    } catch (_error) {
      helperDependencyReady = false;
    }
    const checks = [
      {
        name: 'Node.js',
        status: nodeSupported ? 'ready' : 'unsupported',
        version: process.version,
        downloadUrl: 'https://nodejs.org/en/download',
        message: nodeSupported
          ? `Supported Node.js ${process.version} LTS runtime detected.`
          : 'Node.js 22 or newer on an active or maintenance LTS line is required; Node.js 20 is end-of-life. Install x64 Node.js LTS from nodejs.org, keep the default npm feature selected, restart the computer or terminal, reopen the helper, then check this PC again.'
      },
      {
        name: 'npm',
        status: npmProbe.ok && compareVersion(npmProbe.output, 9) ? 'ready' : npmProbe.ok ? 'unsupported' : 'missing',
        version: npmProbe.ok ? npmProbe.output : null,
        downloadUrl: 'https://nodejs.org/en/download',
        message: npmProbe.ok && compareVersion(npmProbe.output, 9)
          ? 'Supported npm version detected.'
          : 'npm 9 or newer was not detected. Repair the official x64 Node.js LTS installation with npm enabled, reopen the helper, then check this PC again.'
      },
      {
        name: 'Restore helper dependency',
        status: helperDependencyReady ? 'ready' : 'missing',
        message: helperDependencyReady
          ? 'The pinned ZIP validation dependency is installed.'
          : 'The helper dependency is missing. In File Explorer, open the extracted helper folder, click its address bar, type powershell, press Enter, run npm ci --ignore-scripts, then restart the helper.'
      },
      {
        name: 'Helper authentication token',
        status: helperTokenConfigured ? 'ready' : 'not-configured',
        message: helperTokenConfigured
          ? 'A non-placeholder helper token is configured.'
          : 'Set RESTORE_HELPER_TOKEN in helper/.env to a new random value of at least 32 characters, then restart the helper. Generate one with node -e "console.log(require(\'node:crypto\').randomBytes(32).toString(\'base64url\'))".'
      },
      {
        name: 'Package signing trust key',
        status: trustedKeyReady ? 'ready' : 'not-configured',
        message: trustedKeyReady
          ? 'An independently configured Ed25519 package verification key is ready.'
          : 'Obtain the Ed25519 SPKI DER public key through a trusted channel separate from the package and enter it in the local configuration form. The helper will reject packages without this independent trust key.'
      },
      versionCheck('PostgreSQL pg_restore', pgRestoreProbe, 18, 'https://www.postgresql.org/download/'),
      versionCheck('PostgreSQL psql', psqlProbe, 18, 'https://www.postgresql.org/download/'),
      {
        ...versionCheck('PostgreSQL pg_dump', pgDumpProbe, 18, 'https://www.postgresql.org/download/'),
        status: pgDumpProbe.ok
          ? compareVersion(pgDumpProbe.output, 18) ? 'ready' : 'unsupported'
          : 'optional',
        message: pgDumpProbe.ok
          ? compareVersion(pgDumpProbe.output, 18)
            ? 'Supported version detected. This tool is not required to restore a package.'
            : `PostgreSQL pg_dump ${pgDumpProbe.output} is older than 18; it is not required to restore a package, but install matching version 18+ tools before creating backups.`
          : 'Not found on PATH. pg_dump is not required to restore a package; it is used to create PostgreSQL backups.'
      }
    ];

    let windowsSystem = null;
    let postgresService = platform === 'win32'
      ? { status: 'unknown', services: [], message: 'Checking Windows PostgreSQL service status.' }
      : { status: 'not-applicable', services: [], message: 'Windows service detection is only available on Windows.' };
    if (platform === 'win32') {
      const systemProbe = await runProbe('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "$ErrorActionPreference='Stop'; Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version,OSArchitecture | ConvertTo-Json -Compress"
      ]);
      windowsSystem = parseWindowsSystem(systemProbe.ok ? systemProbe.output : '', options.windowsArchitecture || process.arch);
      const serviceProbe = await runProbe('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "$ErrorActionPreference='Stop'; $services=@(Get-Service -Name 'postgresql*' -ErrorAction SilentlyContinue | Select-Object Name,Status); ConvertTo-Json -InputObject $services -Compress"
      ]);
      postgresService = serviceProbe.ok
        ? parseWindowsPostgresServices(serviceProbe.output)
        : { status: 'unknown', services: [], message: 'Could not inspect PostgreSQL services. Check Windows Services or pgAdmin manually.' };
    }

    let database = { status: 'not-configured', message: 'Complete the local configuration form with the dedicated role, its password, and the explicitly selected empty database. The helper only connects to loopback.' };
    let localSettings;
    try {
      localSettings = getLocalPostgresSettings(environment);
    } catch (error) {
      database.message = safeLog(error.message);
    }
    const postgresRestoreReady = checks.find(({ name }) => name === 'PostgreSQL pg_restore')?.status === 'ready';
    const postgresPsqlReady = checks.find(({ name }) => name === 'PostgreSQL psql')?.status === 'ready';
    if (localSettings?.databaseName && postgresRestoreReady && postgresPsqlReady) {
      const databaseProbe = await runProbe('psql', [
        '--no-psqlrc',
        '--no-password',
        '--tuples-only',
        '--no-align',
        '--host',
        localSettings.host,
        '--port',
        String(localSettings.port),
        '--username',
        localSettings.user,
        '--dbname',
        localSettings.databaseName || 'postgres',
        '--command',
        EMPTY_DATABASE_PREFLIGHT_SQL
      ], {
        ...childEnvironment(),
        PGHOST: localSettings.host,
        PGPORT: String(localSettings.port),
        PGUSER: localSettings.user,
        ...(localSettings.password ? { PGPASSWORD: localSettings.password } : {})
      });
      try {
        if (!databaseProbe.ok) throw new Error('unavailable');
        assertEmptyOwnedDatabasePreflight(databaseProbe.output, localSettings);
        database = {
          status: 'ready',
          message: `Connected to the selected empty PostgreSQL ${Math.floor(Number(databaseProbe.output.split('|')[0]) / 10000)} database on verified loopback.`
        };
      } catch (error) {
        const oldVersion = Number(databaseProbe.output.split('|')[0]);
        database = Number.isInteger(oldVersion) && oldVersion > 0 && oldVersion < 180000
          ? { status: 'unsupported', message: `PostgreSQL server ${oldVersion} is older than required version 18. Install the official PostgreSQL 18+ server, create a new empty database owned by the dedicated role, and check again.` }
          : {
            status: 'unavailable',
            message: databaseProbe.ok
              ? safeLog(error.message)
              : 'Cannot connect to the selected local database. Start the PostgreSQL service, confirm the database already exists and is owned by the configured role, re-enter the local role password, then check again. Existing databases are never created, dropped, or overwritten.'
          };
      }
    }
    const applicationPort = Number(environment.RESTORE_APP_PORT || 5001);
    const applicationPortAvailable = Number.isInteger(applicationPort) &&
      applicationPort >= 1024 && applicationPort <= 65535 &&
      await isTcpPortAvailable(applicationPort);
    const jwtSecret = String(environment.RESTORE_APP_JWT_SECRET || '');
    const jwtConfigured = jwtSecret.length >= 32 && !/[\r\n\0]/.test(jwtSecret);
    if (platform === 'win32') {
      checks.unshift(
        {
          name: 'Windows version',
          status: windowsSystem.versionStatus,
          version: windowsSystem.version,
          downloadUrl: 'https://www.microsoft.com/software-download/windows11',
          message: windowsSystem.versionMessage,
          action: windowsSystem.versionStatus === 'ready'
            ? 'No action needed.'
            : 'Open Settings → Windows Update and install Windows 11 25H2 or newer (build 26200+), restart Windows, reopen the helper, then check again.'
        },
        {
          name: 'Windows architecture',
          status: windowsSystem.architectureStatus,
          architecture: windowsSystem.architecture,
          downloadUrl: 'https://nodejs.org/en/download',
          message: windowsSystem.architectureMessage,
          action: windowsSystem.architectureStatus === 'ready'
            ? 'No action needed.'
            : 'This helper supports only x64 Node.js on 64-bit x64 Windows. Install x64 Node.js LTS; ARM Windows hardware is not supported by this workflow.'
        }
      );
    }
    checks.push({
      name: 'Local PostgreSQL server',
      status: database.status,
      message: database.message,
      downloadUrl: database.status === 'ready' ? undefined : 'https://www.postgresql.org/download/windows/',
      action: database.status === 'ready'
        ? 'No action needed.'
        : 'Start the PostgreSQL service, create a new login role and database owned by that role in pgAdmin, enter the matching local settings above, then check again. Do not reuse or drop existing databases.'
    });
    if (platform === 'win32') checks.push({
      name: 'Windows PostgreSQL service',
      status: postgresService.status,
      message: postgresService.message,
      services: postgresService.services,
      downloadUrl: postgresService.status === 'missing' ? 'https://www.postgresql.org/download/windows/' : undefined,
      action: postgresService.status === 'running'
        ? 'No action needed.'
        : 'Open Windows Services, locate PostgreSQL, choose Start, then check this PC again. This manual action may require administrator approval.'
    });
    checks.push({
      name: 'Local application port',
      status: applicationPortAvailable ? 'ready' : 'unavailable',
      message: applicationPortAvailable
        ? `Port ${applicationPort} is available on loopback.`
        : `Port ${Number.isInteger(applicationPort) ? applicationPort : 'configured'} is invalid or already in use; choose another local port.`,
      action: applicationPortAvailable
        ? 'No action needed.'
        : 'Enter another unused port from 1024–65535 in Local setup, save settings, then check again. Do not stop an unknown process to free a port.'
    });
    checks.push({
      name: 'Local application secret',
      status: jwtConfigured ? 'ready' : 'not-configured',
      message: generatedJwtSecret
        ? 'A new local-only application secret will be generated by the helper and written to the restored backend configuration.'
        : jwtConfigured
          ? 'A local application secret is configured.'
          : 'RESTORE_APP_JWT_SECRET must contain at least 32 characters. Do not reuse a production secret.'
    });
    checks.at(-1).action = jwtConfigured
      ? 'No action needed.'
      : generatedJwtSecret
        ? 'No action needed; the helper has generated a cryptographically random local-only secret and writes it only to the restored backend configuration.'
        : 'Review helper/.env and explicitly clear the invalid RESTORE_APP_JWT_SECRET value or replace it with a new local-only random value of at least 32 characters. Do not reuse a production secret; the helper does not edit this file.';
    return {
      platform,
      checks,
      requiredReady: checks
        .filter(({ name }) => [
          'Windows version',
          'Windows architecture',
          'Node.js',
          'npm',
          'PostgreSQL pg_restore',
          'PostgreSQL psql',
          'Restore helper dependency',
          'Helper authentication token',
          'Package signing trust key',
          'Local PostgreSQL server',
          'Local application port',
          'Local application secret'
        ].includes(name))
        .every(({ status }) => status === 'ready')
    };
  }

  function authenticate(req, res) {
    const origin = req.headers.origin;
    const helperPort = Number(environment.RESTORE_HELPER_PORT || 43127);
    const helperOrigins = new Set([
      `http://127.0.0.1:${helperPort}`,
      `http://localhost:${helperPort}`
    ]);
    if (origin && origin !== uiOrigin && !helperOrigins.has(origin)) {
      res.writeHead(403).end(JSON.stringify({ error: 'Restore helper origin is not allowed.' }));
      return false;
    }
    const host = String(req.headers.host || '').split(':')[0].toLowerCase();
    if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
      res.writeHead(403).end(JSON.stringify({ error: 'Restore helper accepts loopback requests only.' }));
      return false;
    }
    const supplied = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const expectedBuffer = Buffer.from(token);
    const suppliedBuffer = Buffer.from(supplied);
    if (!token || expectedBuffer.length !== suppliedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, suppliedBuffer)) {
      res.writeHead(401).end(JSON.stringify({ error: 'Restore helper authorization failed.' }));
      return false;
    }
    res.setHeader('Access-Control-Allow-Origin', origin || uiOrigin);
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Vary', 'Origin');
    return true;
  }

  function sendJson(res, status, value) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(value));
  }

  async function readJson(req) {
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 1024 * 1024) throw new Error('Request body exceeds the 1 MB limit.');
    }
    return body ? JSON.parse(body) : {};
  }

  async function getManifest() {
    const bundledBytes = await fsp.readFile(manifestPath);
    const bundledHash = crypto.createHash('sha256').update(bundledBytes).digest('hex');
    if (bundledHash !== BUNDLED_MANIFEST_SHA256) throw new Error('Bundled restore manifest integrity check failed.');
    const bundled = validateManifest(JSON.parse(bundledBytes.toString('utf8')));
    const sourceUrl = environment.RESTORE_MANIFEST_URL;
    const publicKey = environment.RESTORE_MANIFEST_PUBLIC_KEY;
    if (!sourceUrl || !publicKey) {
      return { manifest: bundled, source: 'bundled-fallback', fallbackReason: 'No signed remote manifest source is configured.' };
    }
    try {
      const parsedUrl = new URL(sourceUrl);
      if (parsedUrl.protocol !== 'https:') throw new Error('Configured restore manifest source must use HTTPS.');
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      let response;
      try {
        response = await (options.fetch || fetch)(parsedUrl, {
          headers: environment.RESTORE_MANIFEST_TOKEN
            ? { Authorization: `Bearer ${environment.RESTORE_MANIFEST_TOKEN}` }
            : {},
          redirect: 'error',
          signal: controller.signal
        });
      } finally {
        clearTimeout(timeout);
      }
      if (!response.ok) throw new Error(`Manifest source returned HTTP ${response.status}.`);
      const raw = Buffer.from(await response.arrayBuffer());
      if (raw.length > 1024 * 1024) throw new Error('Remote restore manifest exceeds the 1 MB limit.');
      const signature = Buffer.from(response.headers.get('x-restore-manifest-signature') || '', 'base64');
      if (!signature.length || !crypto.verify(null, raw, publicKey, signature)) {
        throw new Error('Remote restore manifest signature is invalid.');
      }
      const manifest = validateManifest(JSON.parse(raw.toString('utf8')));
      return { manifest, source: 'signed-remote', fallbackReason: null };
    } catch (error) {
      return { manifest: bundled, source: 'bundled-fallback', fallbackReason: safeLog(error.message) };
    }
  }

  async function inspectPath(value, kind, label) {
    if (typeof value !== 'string' || !value.trim() || value.includes('\0')) throw new Error(`${label} path is required.`);
    const absolutePath = path.resolve(value.trim());
    const explainPathError = (error) => {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
        return `${label} was not found at the entered path. Check the drive letter, every folder name, and the file extension; paths containing spaces are supported.`;
      }
      if (error.code === 'EACCES' || error.code === 'EPERM') {
        return `Windows denied access to ${label}. Choose a folder owned by your Windows account and review File Explorer → Properties → Security permissions; do not run the helper as Administrator to bypass this check.`;
      }
      return `${label} could not be inspected (${error.code || 'filesystem error'}). Check the path and its permissions.`;
    };
    const linkStat = await fsp.lstat(absolutePath).catch((error) => {
      if (kind === 'destination' && error.code === 'ENOENT') return null;
      throw new Error(explainPathError(error));
    });
    if (linkStat?.isSymbolicLink()) throw new Error(`${label} cannot be a symbolic link.`);
    if (kind === 'file') {
      if (!linkStat?.isFile()) throw new Error(`${label} must be a regular file.`);
      try {
        await fsp.access(absolutePath, fs.constants.R_OK);
        return { path: await fsp.realpath(absolutePath), sizeBytes: linkStat.size };
      } catch (error) {
        throw new Error(explainPathError(error));
      }
    }
    if (kind === 'destination') {
      if (linkStat) throw new Error(`${label} already exists. Select a new, empty destination path.`);
      let parent;
      try {
        parent = await fsp.realpath(path.dirname(absolutePath));
        await fsp.access(parent, fs.constants.W_OK);
      } catch (error) {
        throw new Error(explainPathError(error));
      }
      return { path: path.join(parent, path.basename(absolutePath)), parent };
    }
    throw new Error('Unsupported restore path type.');
  }

  function openZip(archivePath) {
    return new Promise((resolve, reject) => {
      yauzl.open(archivePath, {
        lazyEntries: true,
        autoClose: false,
        decodeStrings: true,
        strictFileNames: true,
        validateEntrySizes: true
      }, (error, zipfile) => error ? reject(error) : resolve(zipfile));
    });
  }

  function archiveEntryType(entry) {
    const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff;
    return unixMode & 0o170000;
  }

  function archiveEntryIsDirectory(entry) {
    return entry.fileName.endsWith('/') || archiveEntryType(entry) === fs.constants.S_IFDIR;
  }

  function validateArchiveEntry(entry, actualEntries, nodeTypes) {
    if (typeof entry.fileName !== 'string' || entry.fileName.length > 4096) {
      throw new Error('Restore ZIP contains an invalid or overlong entry path.');
    }
    const directory = archiveEntryIsDirectory(entry);
    const value = directory ? entry.fileName.replace(/\/$/, '') : entry.fileName;
    const relative = validateArchiveEntryPath(value);
    const type = archiveEntryType(entry);
    if (type !== 0 && type !== fs.constants.S_IFREG && type !== fs.constants.S_IFDIR) {
      throw new Error(`Restore ZIP contains an unsafe symbolic link or special file: ${relative}`);
    }
    if (directory && type === fs.constants.S_IFREG) {
      throw new Error(`Restore ZIP directory has incompatible file attributes: ${relative}`);
    }
    if (!directory && type === fs.constants.S_IFDIR) {
      throw new Error(`Restore ZIP file has incompatible directory attributes: ${relative}`);
    }
    if (actualEntries.has(relative)) throw new Error(`Restore ZIP contains a duplicate entry path: ${relative}`);
    const collisionKey = platform === 'win32' || platform === 'darwin' ? relative.toLocaleLowerCase('en-US') : relative;
    for (const seen of actualEntries) {
      const seenKey = platform === 'win32' || platform === 'darwin' ? seen.toLocaleLowerCase('en-US') : seen;
      if (collisionKey === seenKey) throw new Error(`Restore ZIP contains colliding paths for this platform: ${relative}`);
    }
    actualEntries.add(relative);
    const parts = relative.split('/');
    for (let index = 1; index < parts.length; index += 1) {
      const parent = parts.slice(0, index).join('/');
      const parentKey = platform === 'win32' || platform === 'darwin' ? parent.toLocaleLowerCase('en-US') : parent;
      if (nodeTypes.get(parentKey) === 'file') throw new Error(`Restore ZIP path descends through a file: ${relative}`);
      nodeTypes.set(parentKey, 'directory');
    }
    if (!directory) {
      if (nodeTypes.get(collisionKey) === 'directory') throw new Error(`Restore ZIP file conflicts with a directory: ${relative}`);
      nodeTypes.set(collisionKey, 'file');
    } else {
      if (nodeTypes.get(collisionKey) === 'file') throw new Error(`Restore ZIP directory conflicts with a file: ${relative}`);
      nodeTypes.set(collisionKey, 'directory');
    }
    return { relative, directory };
  }

  async function* zipEntries(zipfile) {
    const queue = [];
    let wake;
    let ended = false;
    let failure = null;
    const notify = () => {
      if (wake) {
        const resume = wake;
        wake = null;
        resume();
      }
    };
    zipfile.on('entry', (entry) => { queue.push(entry); notify(); });
    zipfile.once('end', () => { ended = true; notify(); });
    zipfile.once('error', (error) => { failure = error; notify(); });
    zipfile.readEntry();
    while (!ended || queue.length) {
      if (failure) throw failure;
      if (!queue.length) await new Promise((resolve) => { wake = resolve; });
      if (failure) throw failure;
      const entry = queue.shift();
      if (!entry) continue;
      yield entry;
      zipfile.readEntry();
    }
  }

  async function listArchiveFiles(archivePath) {
    const files = new Set();
    const actualEntries = new Set();
    const nodeTypes = new Map();
    const zipfile = await openZip(archivePath);
    try {
      let entryCount = 0;
      for await (const entry of zipEntries(zipfile)) {
        entryCount += 1;
        if (entryCount > MAX_ARCHIVE_ENTRIES) throw new Error('Restore ZIP exceeds the maximum supported entry count.');
        const { relative, directory } = validateArchiveEntry(entry, actualEntries, nodeTypes);
        if (!directory) files.add(relative);
      }
      return files;
    } finally {
      zipfile.close();
    }
  }

  async function ensureSafeExtractionDirectory(root, relativeDirectory) {
    const rootStat = await fsp.lstat(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('Restore staging destination is not a safe directory.');
    const canonicalRoot = await fsp.realpath(root);
    if (canonicalRoot !== root) throw new Error('Restore staging destination changed during extraction.');
    let current = canonicalRoot;
    for (const part of relativeDirectory ? relativeDirectory.split('/') : []) {
      current = path.join(current, part);
      try {
        await fsp.mkdir(current, { mode: 0o700 });
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
      const stat = await fsp.lstat(current);
      if (!stat.isDirectory() || stat.isSymbolicLink() || await fsp.realpath(current) !== current) {
        throw new Error('Restore extraction path is not a safe, real directory.');
      }
    }
    return current;
  }

  async function extractArchive({ archivePath, destination, expectedFiles, protectedPaths = new Set(), job, task }) {
    const expected = new Map(expectedFiles.map((item) => [
      validateArchiveEntryPath(item.destinationWithinArtifact),
      item
    ]));
    if (expected.size !== expectedFiles.length) throw new Error('Restore package inventory contains duplicate extraction paths.');
    const expectedDirectories = new Set();
    for (const expectedPath of expected.keys()) {
      const parts = expectedPath.split('/');
      for (let index = 1; index < parts.length; index += 1) {
        expectedDirectories.add(parts.slice(0, index).join('/'));
      }
    }
    const expectedBytes = expectedFiles.reduce((sum, item) => sum + item.sizeBytes, 0);
    const actualEntries = new Set();
    const nodeTypes = new Map();
    const completedFiles = new Set();
    task.filesTotal = expected.size;
    task.filesCompleted = 0;
    task.bytesTotal = expectedBytes;
    task.bytesCompleted = 0;
    task.percent = expectedBytes === 0 ? null : 0;
    setTask(job, task, 'TRANSFERRING', 'Inspecting and extracting verified archive entries');
    const zipfile = await openZip(archivePath);
    let entryCount = 0;
    try {
      for await (const entry of zipEntries(zipfile)) {
        if (job.cancelRequested) throw new Error('Operation cancelled by administrator.');
        entryCount += 1;
        if (entryCount > MAX_ARCHIVE_ENTRIES) throw new Error('Restore ZIP exceeds the maximum supported entry count.');
        const { relative, directory } = validateArchiveEntry(entry, actualEntries, nodeTypes);
        const parts = relative.split('/');
        const parentRelative = directory ? parts.join('/') : parts.slice(0, -1).join('/');
        if (directory) {
          if (entry.uncompressedSize !== 0) throw new Error(`Restore ZIP directory contains unexpected data: ${relative}`);
          if (!expectedDirectories.has(relative)) {
            throw new Error(`Restore ZIP contains a directory missing from the verified package inventory: ${relative}`);
          }
          await ensureSafeExtractionDirectory(destination, parentRelative);
          continue;
        }
        const expectedFile = expected.get(relative);
        if (!expectedFile) throw new Error(`Restore ZIP contains a file missing from the verified package inventory: ${relative}`);
        if (completedFiles.has(relative) || entry.uncompressedSize !== expectedFile.sizeBytes) {
          throw new Error(`Restore ZIP file size or uniqueness does not match the package inventory: ${relative}`);
        }
        const protectedFile = protectedPaths.has(relative);
        const parent = protectedFile ? null : await ensureSafeExtractionDirectory(destination, parentRelative);
        const root = await fsp.realpath(destination);
        let target;
        if (!protectedFile) {
          target = path.resolve(parent, parts[parts.length - 1]);
          const relativeTarget = path.relative(root, target);
          if (!relativeTarget || relativeTarget === '..' || relativeTarget.startsWith(`..${path.sep}`) || path.isAbsolute(relativeTarget)) {
            throw new Error(`Restore ZIP path resolves outside the selected destination: ${relative}`);
          }
          const targetParent = await fsp.realpath(path.dirname(target));
          if (targetParent !== parent) throw new Error(`Restore destination changed during extraction: ${relative}`);
          try {
            await fsp.lstat(target);
            throw new Error(`Restore destination already contains a file; refusing to overwrite: ${relative}`);
          } catch (error) {
            if (error.code !== 'ENOENT') throw error;
          }
        }

        const temporary = protectedFile ? null : path.join(parent, `.stocksite-restore-${crypto.randomUUID()}.part`);
        let temporaryCreated = false;
        try {
          const readStream = await new Promise((resolve, reject) => {
            zipfile.openReadStream(entry, (error, stream) => error ? reject(error) : resolve(stream));
          });
          const hash = crypto.createHash('sha256');
          let fileBytes = 0;
          const meter = new Transform({
            transform(chunk, encoding, callback) {
              if (job.cancelRequested) return callback(new Error('Operation cancelled by administrator.'));
              fileBytes += chunk.length;
              task.bytesCompleted += chunk.length;
              if (fileBytes > expectedFile.sizeBytes || task.bytesCompleted > expectedBytes) {
                return callback(new Error('Restore ZIP expanded beyond its verified inventory size.'));
              }
              hash.update(chunk);
              task.percent = expectedBytes ? Math.min(99.9, task.bytesCompleted * 100 / expectedBytes) : null;
              updateJob(job);
              callback(null, chunk);
            }
          });
          const sink = protectedFile
            ? new Writable({ write(chunk, encoding, callback) { callback(); } })
            : fs.createWriteStream(temporary, { flags: 'wx', mode: 0o600 });
          temporaryCreated = !protectedFile;
          await pipeline(readStream, meter, sink);
          if (fileBytes !== expectedFile.sizeBytes || hash.digest('hex') !== expectedFile.sha256) {
            throw new Error(`Extracted file checksum does not match the verified package inventory: ${relative}`);
          }
          if (protectedFile) {
            log(job, task, `Verified encrypted environment file and skipped installing it: ${relative}`);
          } else {
            const currentParent = await fsp.realpath(parent);
            if (currentParent !== parent || (await fsp.lstat(target).catch((error) => {
              if (error.code === 'ENOENT') return null;
              throw error;
            }))) throw new Error(`Restore destination changed or was populated during extraction: ${relative}`);
            await fsp.link(temporary, target);
            await fsp.unlink(temporary);
            temporaryCreated = false;
          }
          completedFiles.add(relative);
          task.filesCompleted = completedFiles.size;
        } finally {
          if (temporaryCreated) await fsp.unlink(temporary).catch(() => {});
        }
      }
    } finally {
      zipfile.close();
    }
    if (completedFiles.size !== expected.size) throw new Error('Extracted file count does not match the verified package inventory.');
    task.percent = expectedBytes ? 100 : null;
    setTask(job, task, 'COMPLETED', `Extracted and verified ${completedFiles.size} files (${task.bytesCompleted} bytes)`);
  }

  async function verifyPackageSources(configuration) {
    const packageDirectory = path.dirname(configuration.databaseFile);
    const manifestPath = path.join(packageDirectory, 'restore-package-manifest.json');
    const checksumsPath = path.join(packageDirectory, 'checksums.sha256');
    const manifestStat = await fsp.lstat(manifestPath);
    const checksumsStat = await fsp.lstat(checksumsPath);
    if (!manifestStat.isFile() || manifestStat.isSymbolicLink() || !checksumsStat.isFile() || checksumsStat.isSymbolicLink()) {
      throw new Error('Keep restore-package-manifest.json and checksums.sha256 beside the downloaded database backup.');
    }
    const manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
    if (
      manifest.schema !== 'stocksite.restore-package-manifest' ||
      manifest.schemaVersion !== 1 ||
      manifest.format !== 'STOCKSITE-RESTORE-PACKAGE' ||
      manifest.sourceInventoryVerification?.result !== 'VERIFIED' ||
      !Array.isArray(manifest.sourceInventory) ||
      !Array.isArray(manifest.artifacts)
    ) throw new Error('Restore package manifest is invalid or has incomplete source inventory.');
    const inventoryPaths = new Set();
    for (const item of manifest.sourceInventory) {
      if (
        !item ||
        !['database', 'websiteCode', 'originalAssets', 'thumbnails'].includes(item.artifactId) ||
        !Number.isSafeInteger(item.sizeBytes) ||
        item.sizeBytes < 0 ||
        !/^[a-f0-9]{64}$/i.test(item.sha256)
      ) throw new Error('Restore package source inventory contains an invalid file record.');
      item.destinationWithinArtifact = validateArchiveEntryPath(item.destinationWithinArtifact);
      const inventoryKey = `${item.artifactId}:${item.destinationWithinArtifact}`;
      if (inventoryPaths.has(inventoryKey)) throw new Error('Restore package source inventory contains duplicate paths.');
      inventoryPaths.add(inventoryKey);
      if (item.artifactId !== 'websiteCode') continue;
      const secretEnvironment = isSecretEnvironmentPath(item.destinationWithinArtifact);
      if (secretEnvironment !== Boolean(item.secretBearing && item.encrypted)) {
        throw new Error(`Website environment file is not safely encrypted in the package inventory: ${item.destinationWithinArtifact}`);
      }
    }
    const canonical = JSON.parse(JSON.stringify(manifest));
    canonical.manifestIntegrity.canonicalSha256 = null;
    if (canonical.packageSignature) canonical.packageSignature.signature = null;
    const packageManifestRecord = canonical.artifacts.find(({ id }) => id === 'packageManifest');
    const checksumsRecord = canonical.artifacts.find(({ id }) => id === 'packageChecksums');
    if (!packageManifestRecord || !checksumsRecord) throw new Error('Restore package manifest has no integrity records.');
    packageManifestRecord.sha256 = null;
    checksumsRecord.sha256 = null;
    const canonicalHash = crypto.createHash('sha256').update(JSON.stringify(canonical, null, 2)).digest('hex');
    if (canonicalHash !== manifest.manifestIntegrity?.canonicalSha256) throw new Error('Restore package manifest integrity check failed.');
    const signature = manifest.packageSignature;
    const configuredPublicKey = environment.RESTORE_PACKAGE_SIGNING_PUBLIC_KEY;
    if (
      signature?.algorithm !== 'Ed25519' ||
      !/^[a-f0-9]{24}$/.test(signature.keyId || '') ||
      !/^[A-Za-z0-9+/]{86}==$/.test(signature.signature || '') ||
      !configuredPublicKey
    ) throw new Error('Restore package signature is missing or no independently trusted Ed25519 public key is configured.');
    const publicKey = parseTrustedRestorePublicKey(configuredPublicKey);
    const trustedKeyId = crypto.createHash('sha256')
      .update(publicKey.export({ type: 'spki', format: 'der' }))
      .digest('hex')
      .slice(0, 24);
    if (trustedKeyId !== signature.keyId ||
        !crypto.verify(null, Buffer.from(`STOCKSITE-RESTORE-PACKAGE-V1\n${canonicalHash}`, 'utf8'), publicKey, Buffer.from(signature.signature, 'base64'))) {
      throw new Error('Restore package signature does not match the independently trusted signing key.');
    }

    const artifactsById = new Map();
    if (manifest.artifacts.length !== EXPECTED_PACKAGE_ARTIFACTS.size) throw new Error('Restore package manifest has a missing or unexpected artifact.');
    for (const artifact of manifest.artifacts) {
      if (
        !artifact ||
        !EXPECTED_PACKAGE_ARTIFACTS.has(artifact.id) ||
        artifactsById.has(artifact.id) ||
        artifact.destination !== EXPECTED_PACKAGE_ARTIFACTS.get(artifact.id) ||
        artifact.inclusionStatus !== 'INCLUDED' ||
        (artifact.id === 'packageChecksums'
          ? artifact.verificationResult !== 'VERIFIED_ENTRIES'
          : artifact.id === 'packageManifest'
            ? artifact.verificationResult !== 'VERIFIED_CANONICAL_HASH'
            : artifact.verificationResult !== 'VERIFIED') ||
        !Number.isSafeInteger(artifact.sizeBytes) ||
        artifact.sizeBytes < 1
      ) throw new Error('Restore package manifest has an invalid or unexpected artifact record.');
      if (artifact.id !== 'packageChecksums' && !/^[a-f0-9]{64}$/i.test(artifact.sha256 || '')) {
        throw new Error(`Restore package artifact checksum is invalid: ${artifact.id}`);
      }
      artifactsById.set(artifact.id, artifact);
    }
    const checksums = new Map();
    for (const line of (await fsp.readFile(checksumsPath, 'utf8')).split(/\r?\n/).filter(Boolean)) {
      const match = /^([a-f0-9]{64}) (\d+) (.+)$/i.exec(line);
      if (!match || checksums.has(match[3])) throw new Error('Restore package SHA-256 inventory is malformed.');
      validateArchiveEntryPath(match[3]);
      const sizeBytes = Number(match[2]);
      if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) throw new Error('Restore package checksum has an invalid size.');
      checksums.set(match[3], { sha256: match[1].toLowerCase(), sizeBytes });
    }
    const expectedChecksumPaths = new Set([...EXPECTED_PACKAGE_ARTIFACTS.values()]
      .filter((filename) => filename !== 'checksums.sha256'));
    if (checksums.size !== expectedChecksumPaths.size || [...checksums.keys()].some((filename) => !expectedChecksumPaths.has(filename))) {
      throw new Error('Restore package SHA-256 inventory does not match the required artifact list.');
    }
    const manifestChecksum = checksums.get('restore-package-manifest.json');
    if (!manifestChecksum || manifestChecksum.sha256 !== canonicalHash || manifestChecksum.sizeBytes !== manifestStat.size) {
      throw new Error('Restore package manifest does not match its detached checksum entry.');
    }
    const checksumRecord = artifactsById.get('packageChecksums');
    if (!checksumRecord || checksumRecord.sizeBytes !== checksumsStat.size || checksumRecord.verificationResult !== 'VERIFIED_ENTRIES') {
      throw new Error('Restore package checksum artifact metadata is incomplete.');
    }

    for (const artifact of manifest.artifacts) {
      if (artifact.id === 'packageChecksums') continue;
      const filePath = path.join(packageDirectory, validateArchiveEntryPath(artifact.destination));
      const stat = await fsp.lstat(filePath);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== artifact.sizeBytes) {
        throw new Error(`Required package artifact is missing or has an unexpected size: ${artifact.destination}`);
      }
      if (artifact.id === 'packageManifest') continue;
      const actual = await hashFile(filePath);
      const expected = checksums.get(artifact.destination);
      if (!expected || expected.sha256 !== artifact.sha256 || expected.sha256 !== actual.sha256 || expected.sizeBytes !== actual.sizeBytes) {
        throw new Error(`Package artifact checksum failed: ${artifact.destination}`);
      }
    }
    const databaseRecord = manifest.sourceInventory.find(({ artifactId }) => artifactId === 'database');
    if (!databaseRecord) throw new Error('Restore package inventory is missing the database payload.');
    const databaseActual = await hashFile(configuration.databaseFile);
    if (databaseActual.sha256 !== databaseRecord.sha256 || databaseActual.sizeBytes !== databaseRecord.sizeBytes) {
      throw new Error('Database backup checksum does not match the source inventory.');
    }

    const selections = [
      ['Website-Code', configuration.websiteArchive, 'websiteCode', 'website-code.zip'],
      ['Assets', configuration.assetsArchive, 'originalAssets', 'original-assets.zip'],
      ['Thumbnails', configuration.thumbnailsArchive, 'thumbnails', 'thumbnails.zip']
    ];
    for (const [category, selectedArchive, artifactId, archiveName] of selections) {
      const canonicalArchive = await fsp.realpath(selectedArchive);
      if (canonicalArchive !== path.join(packageDirectory, archiveName)) {
        throw new Error(`Select the verified ${archiveName} artifact from the same package folder as the database backup.`);
      }
      const expected = manifest.sourceInventory.filter((item) => item.artifactId === artifactId);
      const expectedPaths = new Set(expected.map(({ destinationWithinArtifact }) => validateArchiveEntryPath(destinationWithinArtifact)));
      if (!expected.length || expectedPaths.size !== expected.length) {
        throw new Error(`Restore package inventory is empty or contains duplicate paths for ${category}.`);
      }
      const archivePaths = await listArchiveFiles(canonicalArchive);
      compareArchiveInventory(archivePaths, expectedPaths, category);
    }
    return manifest;
  }

  async function extractPackageSources(job, stagingDestinations) {
    const sources = job.configuration.sources;
    const verifiedManifest = await verifyPackageSources(sources);
    const archives = [
      ['websiteCode', 'websiteArchive', 'extract-website-code'],
      ['originalAssets', 'assetsArchive', 'extract-original-assets'],
      ['thumbnails', 'thumbnailsArchive', 'extract-thumbnails']
    ];
    for (const [artifactId, sourceKey, taskId] of archives) {
      if (job.cancelRequested) throw new Error('Operation cancelled by administrator.');
      await requestApproval(job, taskId);
      const encryptedEnvironmentFiles = artifactId === 'websiteCode'
        ? new Set(verifiedManifest.sourceInventory
          .filter((item) => item.artifactId === 'websiteCode' && item.secretBearing && item.encrypted)
          .map(({ destinationWithinArtifact }) => validateArchiveEntryPath(destinationWithinArtifact)))
        : new Set();
      await extractArchive({
        archivePath: sources[sourceKey],
        destination: stagingDestinations[artifactId],
        expectedFiles: verifiedManifest.sourceInventory.filter((item) => item.artifactId === artifactId),
        protectedPaths: encryptedEnvironmentFiles,
        job,
        task: job.tasksById[taskId]
      });
    }
    return verifiedManifest;
  }

  async function validateConfiguration(configuration) {
    const { sources = {}, destinations = {} } = configuration || {};
    const inspected = {
      databaseFile: await inspectPath(sources.databaseFile, 'file', 'PostgreSQL backup file'),
      websiteArchive: await inspectPath(sources.websiteArchive, 'file', 'Website code ZIP'),
      assetsArchive: await inspectPath(sources.assetsArchive, 'file', 'Original assets ZIP'),
      thumbnailsArchive: await inspectPath(sources.thumbnailsArchive, 'file', 'Thumbnail ZIP'),
      websiteDestination: await inspectPath(destinations.websiteDestination, 'destination', 'Website code destination'),
      assetsDestination: await inspectPath(destinations.assetsDestination, 'destination', 'Original assets destination'),
      thumbnailsDestination: await inspectPath(destinations.thumbnailsDestination, 'destination', 'Thumbnail destination')
    };
    const localSettings = getLocalPostgresSettings(environment);
    if (!(await isTcpPortAvailable(localSettings.backendPort))) {
      throw new Error(`Local application port ${localSettings.backendPort} is already in use. Configure another RESTORE_APP_PORT before restoring.`);
    }
    if (!localSettings.databaseName || destinations.databaseName !== localSettings.databaseName) {
      throw new Error('The target database name must match the database selected in the local configuration form. Re-enter settings and validate again.');
    }
    if (!path.basename(inspected.databaseFile.path).toLowerCase().endsWith('.backup')) {
      throw new Error('Database source must be a PostgreSQL custom-format .backup file.');
    }
    const targetProbe = await runProbe('psql', [
      '--no-psqlrc',
      '--no-password',
      '--tuples-only',
      '--no-align',
      '--host',
      localSettings.host,
      '--port',
      String(localSettings.port),
      '--username',
      localSettings.user,
      '--dbname',
      destinations.databaseName,
      '--command',
      EMPTY_DATABASE_PREFLIGHT_SQL
    ], {
      ...childEnvironment(),
      PGHOST: localSettings.host,
      PGPORT: String(localSettings.port),
      PGUSER: localSettings.user,
      ...(localSettings.password ? { PGPASSWORD: localSettings.password } : {})
    });
    if (!targetProbe.ok) {
      throw new Error('Cannot connect to the selected database. Start PostgreSQL, confirm the database exists and is owned by the configured dedicated role, check the password, and retry. The helper will not create or overwrite databases.');
    }
    assertEmptyOwnedDatabasePreflight(targetProbe.output, localSettings);
    const [targetVersion, targetAddress] = targetProbe.output.split('|');
    const packageDirectory = path.dirname(inspected.databaseFile.path);
    for (const [key, filename] of [
      ['websiteArchive', 'website-code.zip'],
      ['assetsArchive', 'original-assets.zip'],
      ['thumbnailsArchive', 'thumbnails.zip']
    ]) {
      if (path.dirname(inspected[key].path) !== packageDirectory || path.basename(inspected[key].path) !== filename) {
        throw new Error(`Select ${filename} from the same package folder as stocksite.backup.`);
      }
    }
    const databaseHandle = await fsp.open(inspected.databaseFile.path, 'r');
    try {
      const signature = Buffer.alloc(5);
      await databaseHandle.read(signature, 0, signature.length, 0);
      if (signature.toString('ascii') !== 'PGDMP') throw new Error('Database source is not a PostgreSQL custom-format archive.');
    } finally {
      await databaseHandle.close();
    }
    const packageManifest = await verifyPackageSources({
      databaseFile: inspected.databaseFile.path,
      websiteArchive: inspected.websiteArchive.path,
      assetsArchive: inspected.assetsArchive.path,
      thumbnailsArchive: inspected.thumbnailsArchive.path
    });
    const destinationPaths = [
      inspected.websiteDestination.path,
      inspected.assetsDestination.path,
      inspected.thumbnailsDestination.path
    ];
    const destinationBytes = ['websiteCode', 'originalAssets', 'thumbnails'].map((artifactId) =>
      packageManifest.sourceInventory
        .filter(({ artifactId: itemArtifactId }) => itemArtifactId === artifactId)
        .reduce((total, item) => total + item.sizeBytes, 0));
    for (let index = 0; index < destinationPaths.length; index += 1) {
      for (let other = index + 1; other < destinationPaths.length; other += 1) {
        if (destinationPaths[index] === destinationPaths[other] ||
          destinationPaths[other].startsWith(`${destinationPaths[index]}${path.sep}`) ||
          destinationPaths[index].startsWith(`${destinationPaths[other]}${path.sep}`)) {
          throw new Error('Code, originals, and thumbnail destinations must be separate, non-overlapping paths.');
        }
      }
      if (typeof fsp.statfs !== 'function') throw new Error('Destination storage capacity cannot be validated on this system.');
      const stats = await fsp.statfs(path.dirname(destinationPaths[index]));
      const freeBytes = Number(stats.bavail ?? stats.bfree) * Number(stats.bsize);
      if (!Number.isFinite(freeBytes) || freeBytes < destinationBytes[index]) {
        throw new Error(`Insufficient free space for the selected destination ${index + 1}.`);
      }
    }
    return {
      sources: {
        databaseFile: inspected.databaseFile.path,
        websiteArchive: inspected.websiteArchive.path,
        assetsArchive: inspected.assetsArchive.path,
        thumbnailsArchive: inspected.thumbnailsArchive.path
      },
      destinations: {
        databaseName: destinations.databaseName,
        websiteDestination: inspected.websiteDestination.path,
        assetsDestination: inspected.assetsDestination.path,
        thumbnailsDestination: inspected.thumbnailsDestination.path
      },
      databaseTarget: {
        host: localSettings.host,
        port: localSettings.port,
        serverVersion: Number(targetVersion),
        serverAddress: targetAddress,
        empty: true
      },
      requiredBytes: {
        website: destinationBytes[0],
        assets: destinationBytes[1],
        thumbnails: destinationBytes[2]
      },
      sourceInventory: packageManifest.sourceInventory,
      checkedAt: new Date().toISOString()
    };
  }

  function postgresToolEnvironment() {
    const settings = getLocalPostgresSettings(environment);
    return {
      PGHOST: settings.host,
      PGPORT: String(settings.port),
      PGUSER: settings.user,
      ...(settings.password ? { PGPASSWORD: settings.password } : {})
    };
  }

  function applicationEnvironment(job) {
    const settings = getLocalPostgresSettings(environment);
    const destinations = job.configuration.destinations;
    const origins = [`http://localhost:${settings.backendPort}`, `http://127.0.0.1:${settings.backendPort}`];
    return {
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: String(settings.backendPort),
      DB_HOST: settings.host,
      DB_PORT: String(settings.port),
      DB_USER: settings.user,
      DB_PASSWORD: settings.password,
      DB_NAME: destinations.databaseName,
      JWT_SECRET: settings.jwtSecret,
      ASSETS_ROOT: destinations.assetsDestination,
      THUMBNAIL_STORAGE_PATH: destinations.thumbnailsDestination,
      CORS_ALLOWED_ORIGINS: origins.join(',')
    };
  }

  async function writeLocalEnvironment(job, stageCode) {
    const appEnv = applicationEnvironment(job);
    const backendEnvPath = path.join(stageCode, 'backend', '.env');
    const frontendEnvPath = path.join(stageCode, 'frontend', '.env.production.local');
    const backendContent = Object.entries(appEnv).map(([key, value]) => `${key}=${dotenvValue(value)}`).join('\n') + '\n';
    const frontendContent = `REACT_APP_API_BASE_URL=${dotenvValue(`http://127.0.0.1:${appEnv.PORT}`)}\n`;
    await fsp.writeFile(backendEnvPath, backendContent, { flag: 'wx', mode: 0o600 });
    await fsp.writeFile(frontendEnvPath, frontendContent, { flag: 'wx', mode: 0o600 });
    job.applicationEnvironment = appEnv;
  }

  async function captureCommand(job, task, executable, args, options = {}) {
    return new Promise((resolve, reject) => {
      let child;
      try {
        child = spawnProcess(executable, args, {
          cwd: options.cwd,
          env: childEnvironment(options.env),
          windowsHide: true,
          shell: false,
          detached: platform !== 'win32',
          stdio: ['ignore', 'pipe', 'pipe']
        });
      } catch (error) {
        reject(new Error(`${task.name}: ${safeLog(error.message)}`));
        return;
      }
      job.child = child;
      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (chunk) => { stdout = `${stdout}${chunk.toString('utf8')}`.slice(-4000); });
      child.stderr?.on('data', (chunk) => { stderr = `${stderr}${chunk.toString('utf8')}`.slice(-4000); });
      const timer = setTimeout(() => {
        void terminateChildProcess(child, { platform, detached: platform !== 'win32' });
      }, options.timeoutMs || 60_000);
      child.once('error', (error) => {
        clearTimeout(timer);
        if (job.child === child) job.child = null;
        reject(new Error(`${task.name}: ${safeLog(error.message)}`));
      });
      child.once('close', (code, signal) => {
        clearTimeout(timer);
        if (job.child === child) job.child = null;
        if (code !== 0 || signal) reject(new Error(`${task.name} failed${signal ? ` (${signal})` : ` with exit code ${code}`}${stderr.trim() ? `: ${safeLog(stderr.trim())}` : '.'}`));
        else resolve(stdout.trim());
      });
    });
  }

  function createTask(id, name, required = true) {
    return { id, name, required, status: 'WAITING', percent: null, operation: 'Waiting', bytesCompleted: 0, bytesTotal: null, error: null, startedAt: null, completedAt: null };
  }

  function approvalDetails(actionId, job) {
    const { sources, destinations } = job.configuration;
    const settings = getLocalPostgresSettings(environment);
    const actions = {
      'prepare-staging': {
        title: 'Create private temporary restore folders',
        why: 'The helper needs isolated staging folders to validate and extract package contents without overwriting existing files.',
        source: 'Verified package archives in the selected local package folder',
        destination: [
          path.join(path.dirname(destinations.websiteDestination), `.stocksite-restore-${job.id}`),
          path.join(path.dirname(destinations.assetsDestination), `.stocksite-restore-${job.id}-assets`),
          path.join(path.dirname(destinations.thumbnailsDestination), `.stocksite-restore-${job.id}-thumbnails`)
        ].join('; '),
        impact: 'Creates uniquely named temporary directories; final destination folders must still be new.',
        administratorPermission: 'Not requested. The signed-in Windows user must have write permission to the selected parent folder.'
      },
      'restore-postgresql-custom-archive': {
        title: 'Restore the database archive',
        why: 'This loads the package database into the selected local PostgreSQL database.',
        source: path.basename(sources.databaseFile),
        destination: `${settings.host}:${settings.port}/${destinations.databaseName}`,
        impact: 'The helper rechecks PostgreSQL version and database emptiness immediately before restore. Cancellation or failure may leave the database partially restored; it will not be deleted automatically.',
        administratorPermission: 'No Windows administrator permission is requested. The configured local PostgreSQL role must be permitted to restore into this database.'
      },
      'extract-website-code': {
        title: 'Extract website code',
        why: 'The restored application code is required to build and start Stocksite locally.',
        source: path.basename(sources.websiteArchive),
        destination: destinations.websiteDestination,
        impact: 'Extracts only after checksum, inventory, path, and file-type checks. Existing files are never overwritten.',
        administratorPermission: 'Not requested. The signed-in Windows user must be able to write to the selected folder.'
      },
      'extract-original-assets': {
        title: 'Extract original assets',
        why: 'The local copy needs the package originals to support the restored asset library.',
        source: path.basename(sources.assetsArchive),
        destination: destinations.assetsDestination,
        impact: 'Extracts verified files into a new destination. Existing files are never overwritten.',
        administratorPermission: 'Not requested. The signed-in Windows user must be able to write to the selected folder.'
      },
      'extract-thumbnails': {
        title: 'Extract thumbnails',
        why: 'The local copy needs the package thumbnails for asset previews.',
        source: path.basename(sources.thumbnailsArchive),
        destination: destinations.thumbnailsDestination,
        impact: 'Extracts verified files into a new destination. Existing files are never overwritten.',
        administratorPermission: 'Not requested. The signed-in Windows user must be able to write to the selected folder.'
      },
      'promote-destinations': {
        title: 'Place verified files into the selected destination folders',
        why: 'The package has been validated and extracted into private staging areas; promotion makes the restored files available at the paths configured for Stocksite.',
        source: 'Private staging folders created for this restore job',
        destination: `${destinations.websiteDestination}; ${destinations.assetsDestination}; ${destinations.thumbnailsDestination}`,
        impact: 'Moves staged files into the three new destinations. If a move is interrupted, some destinations may exist and must be reviewed manually; the helper never overwrites or removes them.',
        administratorPermission: 'Not requested. The signed-in Windows user must have permission to create and write to all selected destination parents.'
      },
      'configure-local-environment': {
        title: 'Write local application configuration',
        why: 'The restored backend and frontend need local-only database, asset-path, and API settings.',
        source: 'Helper configuration and a newly generated local JWT secret',
        destination: `${destinations.websiteDestination}/backend/.env and frontend/.env.production.local`,
        impact: 'Writes new configuration files inside the staged application. The generated JWT secret is not displayed or logged. Production environment files are not copied or decrypted.',
        administratorPermission: 'Not requested. Files are created with owner-only POSIX permissions where supported; Windows ACLs must be reviewed manually.'
      },
      'install-backend-dependencies': {
        title: 'Install backend dependencies',
        why: 'The restored backend requires its pinned Node dependencies.',
        source: 'Backend package-lock.json and configured npm registry',
        destination: `${destinations.websiteDestination}/backend/node_modules`,
        impact: 'Downloads dependencies and runs npm installation lifecycle scripts; uses network access and local disk space.',
        administratorPermission: 'Not requested. If Windows shows UAC, cancel and resolve folder permissions rather than elevating the helper.'
      },
      'install-frontend-dependencies': {
        title: 'Install frontend dependencies',
        why: 'The website must install its pinned dependencies before it can be built.',
        source: 'Frontend package-lock.json and configured npm registry',
        destination: `${destinations.websiteDestination}/frontend/node_modules`,
        impact: 'Downloads dependencies and runs npm installation lifecycle scripts; uses network access and local disk space.',
        administratorPermission: 'Not requested. If Windows shows UAC, cancel and resolve folder permissions rather than elevating the helper.'
      },
      'build-frontend': {
        title: 'Build the local website',
        why: 'The production frontend bundle is served by the restored backend.',
        source: `${destinations.websiteDestination}/frontend`,
        destination: `${destinations.websiteDestination}/frontend/build`,
        impact: 'Runs the restored project build script and writes generated files within the staged application.',
        administratorPermission: 'Not requested. Build scripts execute as the signed-in user.'
      },
      'launch-backend': {
        title: 'Start Stocksite locally',
        why: 'The backend must run to verify database connectivity and serve the built website.',
        source: `${destinations.websiteDestination}/backend/server.js`,
        destination: `http://127.0.0.1:${settings.backendPort}`,
        impact: 'Backend startup runs the bundled bootstrap SQL migrations (002–027 selected files) before listening. This can modify the restored local database. It also clears auth_sessions, signing out restored sessions. Migrations 028–030 are not applied by the helper; lifecycle schema validation must pass first. Review the restored database and source revision before approval.',
        administratorPermission: 'Not requested. The helper binds the backend to loopback only; no Windows service or firewall settings are changed.'
      }
    };
    const details = actions[actionId];
    if (!details) throw new Error(`No approval description exists for restore action ${actionId}.`);
    return { actionId, ...details, requestedAt: new Date().toISOString() };
  }

  async function requestApproval(job, taskId) {
    if (job.cancelRequested) throw new Error('Restore was cancelled before the next action.');
    const task = job.tasksById[taskId];
    if (!task) throw new Error(`Restore approval references an unknown task: ${taskId}.`);
    const request = approvalDetails(taskId, job);
    job.awaitingApproval = { ...request, taskId };
    updateJob(job);
    const approved = await new Promise((resolve) => {
      job.resolveApproval = resolve;
    });
    job.awaitingApproval = null;
    job.resolveApproval = null;
    job.approvalHistory.push({
      actionId: taskId,
      decision: approved ? 'approved' : job.approvalDeniedActionId === taskId ? 'declined' : 'cancelled',
      decidedAt: new Date().toISOString()
    });
    if (!approved || job.cancelRequested) {
      if (task.status === 'WAITING') setTask(job, task, 'CANCELLED', 'Action was not approved; this action was not started.');
      throw new Error(job.approvalDeniedActionId === taskId
        ? `Action not approved: ${request.title}. Completed database or destination work is not deleted; private temporary staging folders may be cleaned up.`
        : 'Restore was cancelled before the action started.');
    }
  }

  function updateJob(job) {
    const tasks = [...job.softwareTasks, ...job.tasks];
    const completed = tasks.filter((task) => ['COMPLETED', 'SKIPPED'].includes(task.status)).length;
    const failed = tasks.filter((task) => task.status === 'FAILED').length;
    const pending = tasks.filter((task) => ['WAITING', 'DOWNLOADING', 'VERIFYING', 'INSTALLING', 'CONFIGURING', 'VALIDATING', 'TRANSFERRING'].includes(task.status)).length;
    const finished = completed + failed;
    job.progress = {
      total: tasks.length,
      completed,
      failed,
      pending,
      percent: tasks.length ? Math.round((finished / tasks.length) * 100) : 0
    };
  }

  function log(job, task, message) {
    job.logs.push({ at: new Date().toISOString(), taskId: task.id, message: safeLog(message) });
    if (job.logs.length > 500) job.logs.splice(0, job.logs.length - 500);
  }

  async function runCommand(job, task, executable, args, options = {}) {
    return new Promise((resolve, reject) => {
      let child;
      try {
        child = spawnProcess(executable, args, {
          cwd: options.cwd,
          env: childEnvironment(options.env),
          windowsHide: true,
          shell: false,
          detached: platform !== 'win32',
          stdio: ['ignore', 'pipe', 'pipe']
        });
      } catch (error) {
        reject(new Error(`${task.name}: ${safeLog(error.message)}`));
        return;
      }
      job.child = child;
      if (options.onStarted) child.once('spawn', options.onStarted);
      const collect = (stream) => {
        let tail = '';
        stream?.on('data', (chunk) => {
          const lines = `${tail}${chunk.toString('utf8')}`.split(/\r?\n/);
          tail = lines.pop() || '';
          for (const line of lines) if (line.trim()) log(job, task, line);
        });
        stream?.on('end', () => { if (tail.trim()) log(job, task, tail); });
      };
      collect(child.stdout);
      collect(child.stderr);
      const timeout = setTimeout(() => {
        void terminateChildProcess(child, { platform, detached: platform !== 'win32' });
      }, options.timeoutMs || 30 * 60 * 1000);
      child.once('error', (error) => {
        clearTimeout(timeout);
        job.child = null;
        reject(new Error(`${task.name}: ${error.message}`));
      });
      child.once('close', (code, signal) => {
        clearTimeout(timeout);
        job.child = null;
        if (job.cancelRequested) reject(new Error('Operation cancelled by administrator.'));
        else if (code !== 0) reject(new Error(`${task.name} failed${signal ? ` (${signal})` : ` with exit code ${code}`}.`));
        else resolve();
      });
    });
  }

  function setTask(job, task, status, operation) {
    task.status = status;
    task.operation = operation;
    task.startedAt ||= new Date().toISOString();
    if (status === 'COMPLETED' || status === 'FAILED' || status === 'SKIPPED' || status === 'CANCELLED') task.completedAt = new Date().toISOString();
    updateJob(job);
  }

  async function validateSoftware(job, task) {
    if (task.software.installationMethod === 'manual') return false;
    const checkMap = {
      'pg-restore-version': ['pg_restore', ['--version'], 18],
      'psql-version': ['psql', ['--version'], 18],
      'git-version': ['git', ['--version'], 2]
    };
    if (task.software.id === 'npm') {
      const npmCli = resolveNpmCli(environment);
      if (!npmCli) {
        throw new Error('npm CLI was not found beside the active Node.js installation.');
      }
      const version = await runProbe(process.execPath, [npmCli, '--version']);
      if (!version.ok) {
        throw new Error(`npm version check failed: ${version.output || 'npm did not return a version'}`);
      }
      assertMinimumVersion(version.output, 9, 'npm', 'https://nodejs.org/');
      return true;
    }
    if (task.software.id === 'node') {
      if (!isSupportedNodeRuntime(process.version, process.release.lts)) {
        throw new Error('Node.js 22 or newer on an active or maintenance LTS line is required; Node.js 20 is end-of-life.');
      }
      return true;
    }
    for (const check of task.software.validationChecks) {
      const details = checkMap[check];
      if (!details) throw new Error(`Unsupported software validation check: ${check}`);
      const [executable, args, minimumMajor] = details;
      const output = await new Promise((resolve, reject) => {
        const child = spawnProcess(executable, args, { env: childEnvironment(), windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
        job.child = child;
        let text = '';
        const timer = setTimeout(() => child.kill('SIGTERM'), 15_000);
        child.stdout?.on('data', (chunk) => { text += chunk.toString('utf8'); });
        child.stderr?.on('data', (chunk) => { text += chunk.toString('utf8'); });
        child.once('error', (error) => {
          clearTimeout(timer);
          if (job.child === child) job.child = null;
          reject(error);
        });
        child.once('close', (code) => {
          clearTimeout(timer);
          if (job.child === child) job.child = null;
          if (code === 0) resolve(text);
          else reject(new Error(`${executable} is not available.`));
        });
      });
      assertMinimumVersion(
        output,
        minimumMajor,
        task.software.name,
        task.software.officialDownloadSource
      );
    }
    return true;
  }

  async function runSoftwareTasks(job) {
    for (const task of job.softwareTasks) {
      if (job.cancelRequested) throw new Error('Operation cancelled by administrator.');
      setTask(job, task, 'VALIDATING', 'Checking installed software version');
      try {
        if (await validateSoftware(job, task)) {
          setTask(job, task, 'COMPLETED', 'Required version is installed');
          continue;
        }
        if (task.required) {
          throw new Error(
            `${task.software.name} is required. Install it from ${task.software.officialDownloadSource}, reopen the helper, and retry. ` +
            'The helper does not install software or request administrator privileges automatically.'
          );
        }
        setTask(job, task, 'SKIPPED', `Optional software unavailable; install from ${task.software.officialDownloadSource}`);
      } catch (error) {
        task.error = safeLog(error.message);
        setTask(job, task, task.required ? 'FAILED' : 'SKIPPED', task.error);
        log(job, task, task.error);
        if (task.required) throw error;
      }
    }
  }

  async function runNpm(job, task, codeRoot, args, cwd) {
    const npmCli = resolveNpmCli(environment);
    if (!npmCli) throw new Error('npm CLI was not found; install Node.js/npm and retry.');
    setTask(job, task, 'INSTALLING', 'Running npm with lockfile; installer does not report byte progress');
    const apiUrl = `http://127.0.0.1:${getLocalPostgresSettings(environment).backendPort}`;
    await runCommand(job, task, process.execPath, [npmCli, ...args], {
      cwd: path.join(codeRoot, cwd),
      timeoutMs: 60 * 60 * 1000,
      env: cwd === 'frontend' ? { REACT_APP_API_BASE_URL: apiUrl } : {}
    });
    setTask(job, task, 'COMPLETED', 'npm operation completed');
  }

  async function startAndCheckWebsite(job, codeRoot) {
    const launchTask = job.tasksById['launch-backend'];
    setTask(job, launchTask, 'INSTALLING', 'Starting the backend with the project entry point, bound to loopback only');
    const appEnv = job.applicationEnvironment;
    let child;
    try {
      child = spawnProcess(process.execPath, ['server.js'], {
        cwd: path.join(codeRoot, 'backend'),
        env: childEnvironment(appEnv),
        windowsHide: true,
        shell: false,
        detached: true,
        stdio: 'ignore'
      });
    } catch (error) {
      throw new Error(`Could not start the local backend: ${safeLog(error.message)}`);
    }
    job.serviceProcess = child;
    job.child = child;
    let processFailure = null;
    child.once('error', (error) => { processFailure = safeLog(error.message); });
    child.once('exit', (code, signal) => {
      if (job.status === 'RUNNING') processFailure = `Local backend exited${signal ? ` (${signal})` : ` with code ${code}`}.`;
    });
    child.unref?.();

    const healthTask = job.tasksById['health-check-backend'];
    const frontendTask = job.tasksById['health-check-frontend'];
    setTask(job, healthTask, 'VALIDATING', 'Waiting for HTTP /health and its PostgreSQL query');
    setTask(job, frontendTask, 'VALIDATING', 'Waiting for the production-built frontend');
    try {
      const deadline = Date.now() + 120_000;
      let backendHealthy = false;
      let frontendHealthy = false;
      let lastHealthError = 'Backend is not ready yet.';
      while (Date.now() < deadline) {
        if (job.cancelRequested) throw new Error('Operation cancelled by administrator.');
        if (processFailure || (child.exitCode !== null && child.exitCode !== undefined)) {
          throw new Error(`Local backend stopped before health checks passed${processFailure ? `: ${processFailure}` : '.'}`);
        }
        if (!backendHealthy) {
          try {
            const response = await fetch(`http://127.0.0.1:${appEnv.PORT}/health`, { signal: AbortSignal.timeout(3000) });
            if (!response.ok) throw new Error(`Backend /health returned HTTP ${response.status}.`);
            const payload = await response.json();
            if (!Array.isArray(payload) || payload.length === 0 || !payload[0]?.now) {
              throw new Error('Backend /health response did not confirm a PostgreSQL query.');
            }
            backendHealthy = true;
            setTask(job, healthTask, 'COMPLETED', 'Backend HTTP health check and PostgreSQL query passed');
          } catch (error) {
            lastHealthError = safeLog(error.message);
          }
        }
        if (backendHealthy && !frontendHealthy) {
          try {
            const baseUrl = `http://127.0.0.1:${appEnv.PORT}`;
            const response = await fetch(`${baseUrl}/`, { signal: AbortSignal.timeout(3000) });
            const contentType = response.headers.get('content-type') || '';
            const html = await response.text();
            if (!response.ok || !contentType.includes('text/html')) throw new Error(`Frontend root did not return the built Stocksite HTML (HTTP ${response.status}).`);
            const resources = getFrontendAssetUrls(html, baseUrl);
            for (const resource of resources) {
              const assetResponse = await fetch(resource.url, { signal: AbortSignal.timeout(5000) });
              const assetType = assetResponse.headers.get('content-type') || '';
              const expectedType = resource.kind === 'javascript' ? /(?:javascript|ecmascript)/i : /text\/css/i;
              if (!assetResponse.ok || !expectedType.test(assetType)) {
                throw new Error(`Built frontend ${resource.kind} asset is unavailable from the local backend (HTTP ${assetResponse.status}).`);
              }
            }
            frontendHealthy = true;
            setTask(job, frontendTask, 'COMPLETED', `Production frontend HTML and ${resources.length} local bundle/style assets are served by the backend`);
          } catch (error) {
            lastHealthError = safeLog(error.message);
          }
        }
        if (backendHealthy && frontendHealthy) {
          if (child.exitCode !== null && child.exitCode !== undefined) throw new Error('Local backend exited immediately after health checks.');
          const launchTask = job.tasksById['launch-local-website'];
          job.launchUrl = `http://127.0.0.1:${appEnv.PORT}/`;
          setTask(job, launchTask, 'COMPLETED', `Backend, database, and frontend health checks passed; open ${job.launchUrl}`);
          setTask(job, job.tasksById['launch-backend'], 'COMPLETED', 'Backend stayed running and passed its database-backed HTTP health check');
          job.child = null;
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      throw new Error(`Local website did not pass backend, database, and frontend health checks within 120 seconds. Last check: ${lastHealthError}`);
    } catch (error) {
      await terminateChildProcess(child, { platform, detached: true });
      job.child = null;
      throw error;
    }
  }

  async function runJob(job) {
    job.status = 'RUNNING';
    job.startedAt = new Date().toISOString();
    updateJob(job);
    try {
      const packageTask = job.tasksById['validate-package'];
      setTask(job, packageTask, 'VERIFYING', 'Validating trusted package manifest, all artifact checksums, ZIP structure, and source inventories');
      const packageManifest = await verifyPackageSources({
        databaseFile: job.configuration.sources.databaseFile,
        websiteArchive: job.configuration.sources.websiteArchive,
        assetsArchive: job.configuration.sources.assetsArchive,
        thumbnailsArchive: job.configuration.sources.thumbnailsArchive
      });
      setTask(job, packageTask, 'COMPLETED', 'Package manifest, checksums, artifact types, ZIP paths, and inventories validated');
      await runSoftwareTasks(job);

      const destinationPairs = [
        ['websiteDestination', 'website'],
        ['assetsDestination', 'assets'],
        ['thumbnailsDestination', 'thumbnails']
      ];
      for (const [destinationKey, sizeKey] of destinationPairs) {
        const checked = await inspectPath(job.configuration.destinations[destinationKey], 'destination', 'Restore destination');
        if (checked.path !== job.configuration.destinations[destinationKey]) {
          throw new Error('Restore destination parent changed after validation; select and validate the paths again.');
        }
        if (typeof fsp.statfs !== 'function') throw new Error('Destination storage capacity cannot be revalidated on this system.');
        const stats = await fsp.statfs(path.dirname(checked.path));
        const availableBytes = Number(stats.bavail ?? stats.bfree) * Number(stats.bsize);
        if (!Number.isFinite(availableBytes) || availableBytes < job.configuration.requiredBytes[sizeKey]) {
          throw new Error(`Insufficient or unavailable free space for the selected ${sizeKey} destination.`);
        }
      }
      const stageRoot = path.join(path.dirname(job.configuration.destinations.websiteDestination), `.stocksite-restore-${job.id}`);
      const stageCode = path.join(stageRoot, 'website');
      const stageAssets = path.join(path.dirname(job.configuration.destinations.assetsDestination), `.stocksite-restore-${job.id}-assets`);
      const stageThumbnails = path.join(path.dirname(job.configuration.destinations.thumbnailsDestination), `.stocksite-restore-${job.id}-thumbnails`);
      job.staging = [
        [stageCode, job.configuration.destinations.websiteDestination],
        [stageAssets, job.configuration.destinations.assetsDestination],
        [stageThumbnails, job.configuration.destinations.thumbnailsDestination]
      ];
      job.createdDestinations = [];
      job.databaseRestoreStarted = false;
      job.stagingRoots = [];
      job.retainedStagingPaths = [];
      for (const stagingPath of [stageRoot, stageAssets, stageThumbnails]) {
        try {
          await fsp.lstat(stagingPath);
          throw new Error(`Temporary restore staging path already exists; refusing to overwrite it: ${path.basename(stagingPath)}`);
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      }
      await requestApproval(job, 'prepare-staging');
      const stagingTask = job.tasksById['prepare-staging'];
      setTask(job, stagingTask, 'RUNNING', 'Creating private temporary restore folders');
      await fsp.mkdir(stageRoot, { recursive: false, mode: 0o700 });
      job.stagingRoots.push(stageRoot);
      await fsp.mkdir(stageCode, { recursive: false, mode: 0o700 });
      await fsp.mkdir(stageAssets, { recursive: false, mode: 0o700 });
      job.stagingRoots.push(stageAssets);
      await fsp.mkdir(stageThumbnails, { recursive: false, mode: 0o700 });
      job.stagingRoots.push(stageThumbnails);
      setTask(job, stagingTask, 'COMPLETED', 'Private temporary restore folders created');
      const databaseTask = job.tasksById['restore-postgresql-custom-archive'];
      setTask(job, databaseTask, 'VERIFYING', 'Checking archive table of contents');
      await runCommand(job, databaseTask, 'pg_restore', ['--list', job.configuration.sources.databaseFile], { timeoutMs: 60 * 1000 });
      const expectedDatabase = job.configuration.sourceInventory.find(({ artifactId }) => artifactId === 'database');
      const currentDatabase = await hashFile(job.configuration.sources.databaseFile);
      if (!expectedDatabase || currentDatabase.sha256 !== expectedDatabase.sha256 || currentDatabase.sizeBytes !== expectedDatabase.sizeBytes) {
        throw new Error('Database archive changed after package validation; restore was not started.');
      }
      await requestApproval(job, 'restore-postgresql-custom-archive');
      setTask(job, databaseTask, 'VALIDATING', 'Verifying target database is empty');
      const psqlBaseArgs = ['--no-psqlrc', '--tuples-only', '--no-align', '--dbname', job.configuration.destinations.databaseName];
      const databasePreflight = await captureCommand(job, databaseTask, 'psql', [
        ...psqlBaseArgs,
        '--command',
        EMPTY_DATABASE_PREFLIGHT_SQL
      ], { env: postgresToolEnvironment() });
      assertEmptyOwnedDatabasePreflight(databasePreflight, getLocalPostgresSettings(environment));
      if (!(await isTcpPortAvailable(getLocalPostgresSettings(environment).backendPort))) {
        throw new Error('The configured local application port became unavailable; database restore was not started.');
      }
      setTask(job, databaseTask, 'INSTALLING', 'Restoring custom-format PostgreSQL archive into explicitly selected empty database');
      await runCommand(job, databaseTask, 'pg_restore', ['--exit-on-error', '--no-owner', '--no-privileges', '--dbname', job.configuration.destinations.databaseName, job.configuration.sources.databaseFile], {
        timeoutMs: 60 * 60 * 1000,
        env: postgresToolEnvironment(),
        onStarted: () => { job.databaseRestoreStarted = true; }
      });
      setTask(job, databaseTask, 'COMPLETED', 'pg_restore completed successfully');

      const extractedManifest = await extractPackageSources(job, {
        websiteCode: stageCode,
        originalAssets: stageAssets,
        thumbnails: stageThumbnails
      });
      const compatibilityTask = job.tasksById['check-source-compatibility'];
      const rootPackagePath = path.join(stageCode, 'package.json');
      try {
        const projectPackage = JSON.parse(await fsp.readFile(rootPackagePath, 'utf8'));
        const sourceVersion = extractedManifest.generation?.sourceApplicationVersion;
        if (!sourceVersion || !projectPackage.version) {
          setTask(job, compatibilityTask, 'SKIPPED', 'Source revision metadata is incomplete; full application schema compatibility is not verified. The helper does not run migrations; backend startup may run its configured initialization/migrations.');
        } else {
          setTask(job, compatibilityTask, 'SKIPPED', `Source package version ${projectPackage.version}; backup source version ${sourceVersion}. Full application schema compatibility is not verified. The helper does not run migrations; backend startup may run its configured initialization/migrations.`);
        }
      } catch (error) {
        if (error.code === 'ENOENT' || error instanceof SyntaxError) {
          setTask(job, compatibilityTask, 'SKIPPED', 'Could not compare source revision metadata; full application schema compatibility is not verified. The helper does not run migrations; backend startup may run its configured initialization/migrations.');
        } else {
          throw error;
        }
      }

      const environmentTask = job.tasksById['configure-local-environment'];
      await requestApproval(job, 'configure-local-environment');
      setTask(job, environmentTask, 'CONFIGURING', 'Writing local-only credentials and destination paths with owner-only permissions');
      await writeLocalEnvironment(job, stageCode);
      setTask(job, environmentTask, 'COMPLETED', 'Local environment files written without copying encrypted production credentials');
      await requestApproval(job, 'install-backend-dependencies');
      await runNpm(job, job.tasksById['install-backend-dependencies'], stageCode, ['ci'], 'backend');
      await requestApproval(job, 'install-frontend-dependencies');
      await runNpm(job, job.tasksById['install-frontend-dependencies'], stageCode, ['ci'], 'frontend');
      await requestApproval(job, 'build-frontend');
      await runNpm(job, job.tasksById['build-frontend'], stageCode, ['run', 'build'], 'frontend');

      const databaseValidationTask = job.tasksById['validate-database'];
      setTask(job, databaseValidationTask, 'VALIDATING', databaseValidationTask.name);
      const databaseResult = await captureCommand(job, databaseValidationTask, 'psql', [...psqlBaseArgs, '--command', 'SELECT 1;'], { env: postgresToolEnvironment() });
      if (databaseResult !== '1') throw new Error('PostgreSQL validation query returned an unexpected result.');
      setTask(job, databaseValidationTask, 'COMPLETED', 'Local PostgreSQL query passed');

      const schemaTask = job.tasksById['validate-application-schema'];
      setTask(job, schemaTask, 'VALIDATING', 'Checking required asset upload/lifecycle schema without running migrations');
      const schemaCheck = await captureCommand(job, schemaTask, process.execPath, [
        '-e',
        "const {Pool}=require('pg');const {checkAssetLifecycleSchema}=require('./services/assetLifecycleSchema');const pool=new Pool({host:process.env.DB_HOST,port:Number(process.env.DB_PORT),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});checkAssetLifecycleSchema(pool).then((result)=>console.log(JSON.stringify(result))).catch(()=>console.log(JSON.stringify({ready:false,missing:['schema readiness query failed']}))).finally(()=>pool.end());"
      ], {
        cwd: path.join(stageCode, 'backend'),
        env: applicationEnvironment(job),
        timeoutMs: 60_000
      });
      let schemaStatus;
      try {
        schemaStatus = JSON.parse(schemaCheck);
      } catch (_error) {
        throw new Error('Application schema validation returned an unreadable result.');
      }
      assertLifecycleSchemaReady(schemaStatus);
      setTask(job, schemaTask, 'COMPLETED', 'Required asset upload/lifecycle schema objects are present; no migrations were applied by this check');

      await requestApproval(job, 'promote-destinations');
      const promotionTask = job.tasksById['promote-destinations'];
      setTask(job, promotionTask, 'RUNNING', 'Promoting verified files without replacing existing destination paths');
      for (const [stagingPath, destinationPath] of job.staging) {
        if (job.cancelRequested) throw new Error('Operation cancelled by administrator.');
        const checked = await inspectPath(destinationPath, 'destination', 'Restore destination');
        if (checked.path !== destinationPath) {
          throw new Error('Restore destination parent changed immediately before promotion; select and validate the paths again.');
        }
        await promoteDirectory(
          stagingPath,
          destinationPath,
          () => job.cancelRequested,
          (createdPath) => job.createdDestinations.push(createdPath)
        );
      }
      setTask(job, promotionTask, 'COMPLETED', 'All verified files promoted without replacing existing paths');
      const storageTask = job.tasksById['validate-storage'];
      setTask(job, storageTask, 'VALIDATING', 'Verifying promoted originals and thumbnail destinations are accessible');
      for (const destinationPath of [
        job.configuration.destinations.assetsDestination,
        job.configuration.destinations.thumbnailsDestination
      ]) {
        const stat = await fsp.lstat(destinationPath);
        if (!stat.isDirectory() || stat.isSymbolicLink() || await fsp.realpath(destinationPath) !== destinationPath) {
          throw new Error('A promoted asset or thumbnail destination is not a safe, real directory.');
        }
        await fsp.access(destinationPath, fs.constants.R_OK | fs.constants.W_OK);
      }
      setTask(job, storageTask, 'COMPLETED', 'Promoted originals and thumbnail destinations are readable and writable');
      const websiteRoot = job.configuration.destinations.websiteDestination;
      await requestApproval(job, 'launch-backend');
      await startAndCheckWebsite(job, websiteRoot);
      assertRequiredRestoreTasksComplete([...job.softwareTasks, ...job.tasks]);
      job.status = 'COMPLETED';
      job.completedAt = new Date().toISOString();
    } catch (error) {
      const failedTask = [...job.softwareTasks, ...job.tasks].find((task) => ['RUNNING', 'DOWNLOADING', 'VERIFYING', 'INSTALLING', 'CONFIGURING', 'VALIDATING', 'TRANSFERRING'].includes(task.status));
      if (failedTask) {
        failedTask.error = safeLog(error.message);
        setTask(job, failedTask, job.cancelRequested ? 'CANCELLED' : 'FAILED', failedTask.error);
      }
      job.error = safeLog(error.message);
      const hasPartialState = Boolean(job.databaseRestoreStarted || job.createdDestinations?.length);
      job.status = hasPartialState ? 'PARTIAL' : job.cancelRequested ? 'CANCELLED' : 'FAILED';
      if (hasPartialState) {
        job.recoveryInstructions = [
          ...(job.databaseRestoreStarted
            ? ['The selected database may be partially restored or fully restored even though a later step failed. Do not retry using this database.']
            : []),
          ...(job.createdDestinations?.length
            ? [`This operation created destination director${job.createdDestinations.length === 1 ? 'y' : 'ies'} that may contain partial files: ${job.createdDestinations.join(', ')}. They were not deleted.`]
            : []),
          'For a clean retry, create and verify a new empty local database and select new destination folders. Do not drop the existing database or delete these folders unless you have independently confirmed they contain only disposable restore data and explicitly intend to remove it.',
          'Review the failed task and helper log, then resolve the reported cause before retrying. Backend startup may run local migrations; use only a disposable restore target.'
        ];
      }
    } finally {
      job.child = null;
      job.elapsedMs = Date.now() - new Date(job.startedAt).getTime();
      updateJob(job);
      if (activeJobId === job.id) activeJobId = null;
      if (job.stagingRoots) {
        for (const stagingPath of [...job.stagingRoots].reverse()) {
          try {
            const stat = await fsp.lstat(stagingPath);
            if (!stat.isDirectory() || stat.isSymbolicLink() || await fsp.realpath(stagingPath) !== stagingPath) {
              throw new Error('Temporary staging path changed or is no longer a safe directory.');
            }
            await removeStagingDirectory(stagingPath);
          } catch (cleanupError) {
            if (cleanupError.code === 'ENOENT') continue;
            job.retainedStagingPaths ||= [];
            job.retainedStagingPaths.push(stagingPath);
            const message = `Temporary staging cleanup failed for ${stagingPath}: ${safeLog(cleanupError.message)}`;
            job.error = [job.error, message].filter(Boolean).join(' ');
            job.recoveryInstructions ||= [];
            job.recoveryInstructions.push(
              `Private restore staging data may remain at ${stagingPath}. Do not reuse or remove it until you have independently confirmed its contents and that the path is not a link or user data.`
            );
            job.status = 'PARTIAL';
          }
        }
      }
    }
  }

  async function handle(req, res) {
    if (req.method === 'OPTIONS') {
      const helperPort = Number(environment.RESTORE_HELPER_PORT || 43127);
      const allowedOrigin = new Set([
        uiOrigin,
        `http://127.0.0.1:${helperPort}`,
        `http://localhost:${helperPort}`
      ]);
      if (!allowedOrigin.has(req.headers.origin)) return sendJson(res, 403, { error: 'Restore helper origin is not allowed.' });
      res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Private-Network', 'true');
      return res.writeHead(204).end();
    }
    if (req.method === 'GET' && ['/', '/restore-wizard.html'].includes(new URL(req.url, 'http://127.0.0.1').pathname)) {
      try {
        const wizard = await fsp.readFile(path.resolve(__dirname, '..', 'restore-wizard.html'));
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'Referrer-Policy': 'no-referrer'
        });
        return res.end(wizard);
      } catch (error) {
        return sendJson(res, 500, { error: `Restore Wizard HTML could not be loaded: ${safeLog(error.message)}` });
      }
    }
    if (!authenticate(req, res)) return;
    const url = new URL(req.url, 'http://127.0.0.1');
    try {
      if (req.method === 'GET' && url.pathname === '/api/manifest') {
        return sendJson(res, 200, await getManifest());
      }
      if (req.method === 'GET' && url.pathname === '/api/prerequisites') {
        return sendJson(res, 200, { prerequisites: await getPrerequisites() });
      }
      if (req.method === 'POST' && url.pathname === '/api/configure') {
        if (activeJobId || configurationInProgress || restoreStartInProgress) {
          return sendJson(res, 409, { error: 'Local settings cannot change while a restore is active or starting.' });
        }
        configurationInProgress = true;
        try {
          const configuration = await readJson(req);
          const result = applyLocalConfiguration(configuration);
          return sendJson(res, 200, { configuration: result });
        } finally {
          configurationInProgress = false;
        }
      }
      if (req.method === 'POST' && url.pathname === '/api/validate') {
        const config = await readJson(req);
        return sendJson(res, 200, { validation: await validateConfiguration(config) });
      }
      if (req.method === 'POST' && url.pathname === '/api/start') {
        if (activeJobId || restoreStartInProgress || configurationInProgress) {
          return sendJson(res, 409, { error: 'A restore is already running or starting, or local settings are being changed.' });
        }
        restoreStartInProgress = true;
        try {
          const body = await readJson(req);
          const validation = await validateConfiguration(body.configuration);
          if (body.restoreAuthorized !== true || body.confirmation !== `RESTORE ${validation.destinations.databaseName}`) {
            return sendJson(res, 422, { error: `Type RESTORE ${validation.destinations.databaseName} to confirm the selected target database.` });
          }
          const trustedManifest = await getManifest();
          const manifest = validateManifest(trustedManifest.manifest);
          const job = {
            id: crypto.randomUUID(),
            status: 'WAITING',
            startedAt: null,
            completedAt: null,
            elapsedMs: null,
            error: null,
            logs: [],
            configuration: validation,
            cancelRequested: false,
            awaitingApproval: null,
            resolveApproval: null,
            approvalHistory: [],
            softwareTasks: manifest.software.map((software) => ({ ...createTask(`software-${software.id}`, software.name, software.required), software })),
            tasks: RESTORE_TASKS.map(([id, name]) => createTask(id, name, id !== 'check-source-compatibility')),
            child: null,
            staging: null
          };
          job.tasksById = Object.fromEntries(job.tasks.map((task) => [task.id, task]));
          jobs.set(job.id, job);
          activeJobId = job.id;
          setImmediate(() => void runJob(job));
          return sendJson(res, 202, { job: publicJob(job) });
        } finally {
          restoreStartInProgress = false;
        }
      }
      const approvalMatch = /^\/api\/jobs\/([a-f0-9-]+)\/approval$/.exec(url.pathname);
      if (req.method === 'POST' && approvalMatch) {
        const job = jobs.get(approvalMatch[1]);
        const body = await readJson(req);
        if (!job || job.status !== 'RUNNING' || !job.awaitingApproval || !job.resolveApproval) {
          return sendJson(res, 409, { error: 'This restore job is not waiting for an action approval.' });
        }
        if (body.actionId !== job.awaitingApproval.actionId || typeof body.approved !== 'boolean') {
          return sendJson(res, 422, { error: 'Approval must match the currently displayed action and include an explicit decision.' });
        }
        if (!body.approved) {
          job.approvalDeniedActionId = body.actionId;
          job.cancelRequested = true;
        }
        const resolveApproval = job.resolveApproval;
        job.resolveApproval = null;
        resolveApproval(body.approved);
        return sendJson(res, 202, { job: publicJob(job) });
      }
      const jobMatch = /^\/api\/jobs\/([a-f0-9-]+)$/.exec(url.pathname);
      if (req.method === 'GET' && jobMatch) {
        const job = jobs.get(jobMatch[1]);
        return job ? sendJson(res, 200, { job: publicJob(job) }) : sendJson(res, 404, { error: 'Restore job was not found.' });
      }
      const cancelMatch = /^\/api\/jobs\/([a-f0-9-]+)\/cancel$/.exec(url.pathname);
      if (req.method === 'POST' && cancelMatch) {
        const job = jobs.get(cancelMatch[1]);
        if (!job || job.status !== 'RUNNING') return sendJson(res, 409, { error: 'No active restore operation can be cancelled.' });
        job.cancelRequested = true;
        const child = job.child;
        const serviceProcess = job.serviceProcess;
        await Promise.all([
          ...(child ? [terminateChildProcess(child, { platform, detached: platform !== 'win32' })] : []),
          ...(serviceProcess && serviceProcess !== child
            ? [terminateChildProcess(serviceProcess, { platform, detached: true })]
            : [])
        ]);
        if (job.resolveApproval) {
          const resolveApproval = job.resolveApproval;
          job.resolveApproval = null;
          resolveApproval(false);
        }
        return sendJson(res, 202, { job: publicJob(job) });
      }
      return sendJson(res, 404, { error: 'Restore helper endpoint not found.' });
    } catch (error) {
      return sendJson(res, 422, { error: safeLog(error.message) });
    }
  }

  function publicJob(job) {
    const tasks = [...job.softwareTasks, ...job.tasks];
    const allSettled = tasks.every((task) => ['COMPLETED', 'SKIPPED', 'FAILED', 'CANCELLED'].includes(task.status));
    const pending = tasks.filter((task) => ['WAITING', 'DOWNLOADING', 'VERIFYING', 'INSTALLING', 'CONFIGURING', 'VALIDATING', 'TRANSFERRING'].includes(task.status)).length;
    const completed = tasks.filter((task) => task.status === 'COMPLETED').length;
    const failed = tasks.filter((task) => task.status === 'FAILED').length;
    const skipped = tasks.filter((task) => task.status === 'SKIPPED').length;
    return {
      id: job.id,
      status: job.status,
      partialState: job.status !== 'COMPLETED' && Boolean(
        job.databaseRestoreStarted || job.createdDestinations?.length || job.retainedStagingPaths?.length
      ),
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      elapsedMs: job.elapsedMs ?? (job.startedAt ? Date.now() - new Date(job.startedAt).getTime() : 0),
      etaSeconds: null,
      progress: { total: tasks.length, completed, skipped, failed, pending, percent: tasks.length ? Math.round((completed + skipped + failed) * 100 / tasks.length) : 0 },
      softwareTasks: job.softwareTasks.map(({ software, ...task }) => ({ ...task, softwareName: software.name })),
      tasks: job.tasks,
      awaitingApproval: job.awaitingApproval,
      approvalHistory: job.approvalHistory,
      finalReport: ['COMPLETED', 'FAILED', 'CANCELLED', 'PARTIAL'].includes(job.status) ? {
        completed: tasks.filter((task) => task.status === 'COMPLETED').map(({ id, name }) => ({ id, name })),
        failed: tasks.filter((task) => task.status === 'FAILED').map(({ id, name, error }) => ({ id, name, error })),
        skipped: tasks.filter((task) => task.status === 'SKIPPED').map(({ id, name, operation }) => ({ id, name, operation })),
        cancelledOrNotStarted: tasks.filter((task) => ['CANCELLED', 'WAITING'].includes(task.status)).map(({ id, name, status }) => ({ id, name, status })),
        notVerified: UNVERIFIED_RESTORE_STAGES,
        recoveryInstructions: job.recoveryInstructions || []
      } : null,
      logs: job.logs,
      error: job.error,
      launchAvailable: job.status === 'COMPLETED' && Boolean(job.launchUrl),
      launchUrl: job.status === 'COMPLETED' ? job.launchUrl : null
    };
  }

  return {
    handle,
    getManifest,
    getPrerequisites,
    validateConfiguration,
    listArchiveFiles,
    extractArchive,
    extractPackageSources,
    requestApproval,
    async shutdown() {
      const processes = new Set();
      for (const job of jobs.values()) {
        job.cancelRequested = true;
        if (job.resolveApproval) {
          const resolveApproval = job.resolveApproval;
          job.resolveApproval = null;
          resolveApproval(false);
        }
        if (job.child) processes.add(job.child);
        if (job.serviceProcess) processes.add(job.serviceProcess);
      }
      const results = await Promise.all([...processes].map((child) =>
        terminateChildProcess(child, { platform, detached: true })));
      return results.every(Boolean);
    },
    jobs
  };
}

if (require.main === module) {
  loadEnvironment(path.join(__dirname, '.env'));
  const helper = createRestoreHelper();
  const server = http.createServer((req, res) => {
    void helper.handle(req, res);
  });
  const port = Number(process.env.RESTORE_HELPER_PORT || 43127);
  if (!process.env.RESTORE_HELPER_TOKEN || process.env.RESTORE_HELPER_TOKEN.length < 32 || /^replace-with-/i.test(process.env.RESTORE_HELPER_TOKEN)) {
    console.error('Set RESTORE_HELPER_TOKEN to a random value of at least 32 characters in helper/.env.');
    process.exitCode = 1;
  } else if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    console.error('RESTORE_HELPER_PORT must be an unused local TCP port from 1024 through 65535; 43127 is the default.');
    process.exitCode = 1;
  } else {
    server.once('error', (error) => {
      console.error(error.code === 'EADDRINUSE'
        ? `Local helper port ${port} is already in use. Choose another RESTORE_HELPER_PORT in helper/.env and update the wizard's Helper address.`
        : `Local helper could not listen on port ${port}: ${safeLog(error.message)}`);
      process.exitCode = 1;
    });
    server.listen(port, '127.0.0.1', () => console.log(`Stocksite restore helper listening on http://127.0.0.1:${port}`));
    const shutdown = async () => {
      const processesStopped = await helper.shutdown();
      server.close(() => process.exit(processesStopped ? 0 : 1));
    };
    process.on('SIGINT', () => void shutdown());
    process.on('SIGTERM', () => void shutdown());
  }
}

module.exports = {
  BUNDLED_MANIFEST_SHA256,
  createRestoreHelper,
  validateManifest,
  compareVersion,
  isSupportedNodeRuntime,
  assertMinimumVersion,
  resolveNpmCli,
  safeLog,
  validateArchiveEntryPath,
  getLocalPostgresSettings,
  parseWindowsPostgresServices,
  parseWindowsSystem,
  terminateChildProcess,
  isTcpPortAvailable,
  isLoopbackAddress,
  assertEmptyOwnedDatabasePreflight,
  parseTrustedRestorePublicKey,
  assertLifecycleSchemaReady,
  childEnvironment,
  dotenvValue,
  compareArchiveInventory,
  getFrontendAssetUrls,
  promoteStagedDirectory,
  assertRequiredRestoreTasksComplete
};
