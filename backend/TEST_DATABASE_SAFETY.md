# Backend Test Database Safety

This inventory describes test behavior, not an approved database target.
Neither configured `stocksite` database is an approved test target. Do not run
tests against either one without a separately reviewed, isolated test setup.

`npm test` is not safe to use as a database-free check: it includes tests that
write database rows or apply migrations, and one separate PostgreSQL 18
integration test that creates and drops databases.

## A — DB-free and safe

These tests use pure functions, filesystem fixtures, injected fake pools, or
local HTTP servers without issuing SQL through the application database pool.
They can be run individually or with this command:

```sh
node --test \
  test/assetDeletion.test.js \
  test/assetFileMove.test.js \
  test/assetLifecycleRouting.test.js \
  test/assetLifecycleSchema.test.js \
  test/assetServing.test.js \
  test/assetUploadLifecycle.test.js \
  test/assetUploadValidation.test.js \
  test/backupRoutes.test.js \
  test/backupSystem.test.js \
  test/bootstrap.test.js \
  test/catalogFilters.test.js \
  test/config.test.js \
  test/createAdminVerifier.test.js \
  test/dashboardStatsDownloadWindow.test.js \
  test/dbPoolConfig.test.js \
  test/googlePayPaymentReview.test.js \
  test/myUploadsQuery.test.js \
  test/optionalThumbnailNaming.test.js \
  test/optionalThumbnailWatermark.test.js \
  test/remoteAssetFileAuthorization.test.js \
  test/remoteAssetUploadProxy.test.js \
  test/restoreDatabaseItems.test.js \
  test/restorePackageSystem.test.js \
  test/uploadLimits.test.js \
  test/uploadLockCleanup.test.js
```

The grouped command previously showed 151 passing subtests but did not exit.
The cause was `restoreDatabaseItems.test.js`: detached HTTP-server callbacks
could fail before closing their listeners. The tests now await their server
requests and close each server in `finally`. The exact grouped command above was
rerun after that change and passed 196 tests with 0 failures and 0 skips,
exiting in about 3.3 seconds. This is a DB-free test group, not a substitute
for the database-backed or PostgreSQL 18 integration tests below.

The restore-package helper tests use mocked child-process calls; they do not
connect to PostgreSQL. The restore database-items tests use injected fake query
interfaces. These are not substitutes for the separate PostgreSQL integration
test below.

## B — Mocked or unit-oriented, with database imports

These tests load modules that import `backend/db.js` directly or transitively.
The listed tests now load `test/helpers/blockPostgres.js` before those imports.
It rejects `pg.Pool.connect()` so an unexpected pool query fails without
attempting a network connection. Their normal query paths use local mocks.

```sh
node --test \
  test/adminInboxRead.test.js \
  test/aiThumbnailProcessor.test.js \
  test/assetThumbnails.test.js \
  test/assetUploadFilename.test.js \
  test/conversationVisibility.test.js \
  test/epsProcessor.test.js \
  test/notificationRules.test.js \
  test/processor-detector.test.js \
  test/rasterProcessor.test.js \
  test/singleImage.test.js \
  test/thumbnailQueueWorker.test.js \
  test/thumbnailRemoteProxy.test.js \
  test/uploadLifecycle.test.js
```

`contributorEarnings.test.js` is **unverified and excluded**: it imports
`server.js` to access a function that is not exported or defined in the current
server file, and importing the server can start asynchronous schema DDL. It
must not be run as a DB-free test until its intended function and safe import
boundary are corrected.

## C — Requires an application PostgreSQL database

Do not run these until a dedicated, disposable loopback-only application test
database and role are separately provisioned and verified:

- `adminUserStatusNotifications.test.js` — inserts/deletes users and
  notifications and disables/enables the activity-event trigger during cleanup.
- `loginResponse.test.js` — inserts/deletes a user and exercises database-backed
  authentication/session routes.
- `otpEnabled.test.js` — inserts/deletes users and updates/reads OTP columns.
- `pricingSettings.test.js` — applies migration 027 and inserts/deletes a user
  while exercising the pricing route.

All four import `server.js`; its schema initializer can execute DDL on import
unless `DISABLE_SERVER_SCHEMA_INITIALIZATION=true`. That flag does not make the
four tests database-free: their test bodies still issue real SQL.

## D — Separate PostgreSQL 18 restore integration test

`restorePostgres18.integration.test.js` is a separate integration test. It
requires the dedicated PostgreSQL 18 test environment, loopback host
`127.0.0.1`, port `55418`, `STOCKSITE_PG18_TEST_USER`, and a protected
`STOCKSITE_PG18_TEST_PGPASSFILE`. It creates uniquely named synthetic source
and target databases and drops only those databases after verifying ownership
markers. Do not run it unless that separate cluster and role have been
independently verified and approved.

## Guard limitations and safe-run rule

The B-group guard blocks connections through the shared `pg.Pool` class used by
`backend/db.js`; it does not certify arbitrary subprocesses or separately
constructed pools. The B test paths listed above were checked for such
database operations. If a test changes imports or starts invoking an
unmocked query, it should fail at the guard; investigate rather than removing
the guard or redirecting it to a configured `stocksite` database.
