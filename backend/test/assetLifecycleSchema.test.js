const test = require('node:test');
const assert = require('node:assert/strict');
const {
  checkAssetLifecycleSchema,
  REQUIRED_COLUMNS,
  REQUIRED_CONSTRAINTS,
  REQUIRED_INDEXES,
} = require('../services/assetLifecycleSchema');

const tableRows = [
  'asset_thumbnail_metadata',
  'asset_thumbnail_orphans',
  'asset_lifecycle_operations',
  'images',
].map((table_name) => ({ table_name }));

const columns = Object.entries(REQUIRED_COLUMNS).flatMap(([table_name, definition]) => {
  const entries = Array.isArray(definition)
    ? definition.map((column_name) => [column_name, {}])
    : Object.entries(definition);
  return entries.map(([column_name, expected]) => ({
    table_name,
    column_name,
    data_type: expected.data_type || 'text',
    character_maximum_length: expected.character_maximum_length || null,
    is_nullable: expected.is_nullable || 'YES',
    column_default: ({
      format: "'webp'::character varying",
      status: "'PENDING'::character varying",
      attempt_count: '0',
      updated_at: 'now()',
      id: "nextval('asset_thumbnail_orphans_id_seq'::regclass)",
      created_at: 'now()',
      cleanup_attempts: '0',
      thumbnail_paths: "'[]'::jsonb",
    })[column_name] || null,
  }));
});

const indexDefinitions = {
  asset_thumbnail_metadata_pkey:
    'CREATE UNIQUE INDEX asset_thumbnail_metadata_pkey ON public.asset_thumbnail_metadata USING btree (asset_id)',
  idx_asset_thumbnail_metadata_status:
    'CREATE INDEX idx_asset_thumbnail_metadata_status ON public.asset_thumbnail_metadata USING btree (status)',
  asset_thumbnail_orphans_pkey:
    'CREATE UNIQUE INDEX asset_thumbnail_orphans_pkey ON public.asset_thumbnail_orphans USING btree (id)',
  asset_thumbnail_orphans_asset_id_thumbnail_path_key:
    'CREATE UNIQUE INDEX asset_thumbnail_orphans_asset_id_thumbnail_path_key ON public.asset_thumbnail_orphans USING btree (asset_id, thumbnail_path)',
  asset_lifecycle_operations_pkey:
    'CREATE UNIQUE INDEX asset_lifecycle_operations_pkey ON public.asset_lifecycle_operations USING btree (id)',
  idx_asset_thumbnail_orphans_created_at:
    'CREATE INDEX idx_asset_thumbnail_orphans_created_at ON public.asset_thumbnail_orphans USING btree (created_at)',
  images_upload_request_owner_uidx:
    'CREATE UNIQUE INDEX images_upload_request_owner_uidx ON public.images USING btree (uploaded_by, upload_request_id) WHERE (upload_request_id IS NOT NULL)',
  asset_lifecycle_operations_pending_idx:
    "CREATE INDEX asset_lifecycle_operations_pending_idx ON public.asset_lifecycle_operations USING btree (id) WHERE (state = ANY (ARRAY['prepared'::text, 'db_committed'::text, 'recovery_required'::text]))",
};

const indexRows = Object.entries(indexDefinitions).map(([indexname, indexdef]) => ({
  tablename: Object.entries(REQUIRED_INDEXES)
    .find(([name]) => name === indexname)[1].table ||
    (indexname.startsWith('images_') ? 'images' : 'asset_lifecycle_operations'),
  indexname,
  indexdef,
  indisvalid: true,
  indisready: true,
}));

const constraintDefinitions = {
  asset_thumbnail_metadata_pkey: 'PRIMARY KEY (asset_id)',
  asset_thumbnail_metadata_asset_id_fkey:
    'FOREIGN KEY (asset_id) REFERENCES images(id) ON DELETE CASCADE',
  asset_thumbnail_metadata_status_check:
    "CHECK (((status)::character varying)::text = ANY ((ARRAY['PENDING'::character varying, 'PROCESSING'::character varying, 'READY'::character varying, 'FAILED'::character varying])::text[]))",
  asset_thumbnail_orphans_pkey: 'PRIMARY KEY (id)',
  asset_thumbnail_orphans_asset_id_thumbnail_path_key:
    'UNIQUE (asset_id, thumbnail_path)',
  asset_lifecycle_operations_pkey: 'PRIMARY KEY (id)',
  asset_lifecycle_operations_operation_check:
    "CHECK (operation IN ('move', 'delete'))",
  asset_lifecycle_operations_state_check:
    "CHECK (state IN ('prepared', 'db_committed', 'recovery_required', 'completed', 'aborted'))",
};

const constraints = Object.entries(constraintDefinitions).map(([constraintname, constraintdef]) => {
  const requirement = REQUIRED_CONSTRAINTS[constraintname];
  return {
    tablename: requirement.table,
    constraintname,
    contype: requirement.type,
    convalidated: true,
    constraintdef,
  };
});

function makePool({
  tables: configuredTables = tableRows,
  columns: configuredColumns = columns,
  indexes: configuredIndexes = indexRows,
  constraints: configuredConstraints = constraints,
  failOnQuery,
} = {}) {
  const queries = [];
  return {
    queries,
    async query(sql) {
      queries.push(sql);
      if (failOnQuery) throw new Error(failOnQuery);
      if (sql.includes('information_schema.tables')) return { rows: configuredTables };
      if (sql.includes('information_schema.columns')) return { rows: configuredColumns };
      if (sql.includes('FROM pg_index AS index_info')) return { rows: configuredIndexes };
      if (sql.includes('FROM pg_constraint AS constraint_info')) {
        return { rows: configuredConstraints };
      }
      throw new Error('Unexpected schema check query');
    },
  };
}

test('accepts complete upload, thumbnail, and lifecycle schema without executing migrations', async () => {
  const pool = makePool();
  const result = await checkAssetLifecycleSchema(pool);

  assert.deepEqual(result, { ready: true, missing: [] });
  assert.equal(pool.queries.length, 4);
  assert.ok(pool.queries.every((query) => !/\b(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE)\b/i.test(query)));
});

test('reports missing and incompatible required columns', async () => {
  const pool = makePool({
    columns: columns
      .filter((column) => !(column.table_name === 'images' && column.column_name === 'upload_file_inode') &&
        !(column.table_name === 'asset_thumbnail_metadata' && column.column_name === 'width'))
      .map((column) => column.column_name === 'format'
        ? { ...column, character_maximum_length: 32 }
        : column),
  });

  test('rejects incompatible migration 029 and 030 column types, nullability, and defaults', async () => {
    const incompatibleColumns = columns.map((column) => {
      if (column.table_name === 'images' && column.column_name === 'upload_request_id') {
        return { ...column, data_type: 'text' };
      }
      if (column.table_name === 'asset_lifecycle_operations' && column.column_name === 'asset_id') {
        return { ...column, is_nullable: 'YES' };
      }
      if (column.table_name === 'asset_lifecycle_operations' && column.column_name === 'thumbnail_paths') {
        return { ...column, column_default: null };
      }
      return column;
    });
    const result = await checkAssetLifecycleSchema(makePool({ columns: incompatibleColumns }));

    assert.equal(result.ready, false);
    assert.deepEqual(result.missing, [
      'column images.upload_request_id definition',
      'column asset_lifecycle_operations.asset_id definition',
      'column asset_lifecycle_operations.thumbnail_paths definition',
    ]);
  });

  const result = await checkAssetLifecycleSchema(pool);
  assert.equal(result.ready, false);
  assert.deepEqual(result.missing, [
    'column images.upload_file_inode',
    'column asset_thumbnail_metadata.format definition',
    'column asset_thumbnail_metadata.width',
  ]);
});

test('reports missing or incorrectly defined required indexes', async () => {
  const pool = makePool({
    indexes: indexRows.filter((index) => index.indexname !== 'idx_asset_thumbnail_orphans_created_at')
      .map((index) => index.indexname === 'idx_asset_thumbnail_metadata_status'
        ? { ...index, indexdef: 'CREATE INDEX idx_asset_thumbnail_metadata_status ON public.asset_thumbnail_metadata (updated_at)' }
        : index),
  });

  const result = await checkAssetLifecycleSchema(pool);
  assert.equal(result.ready, false);
  assert.deepEqual(result.missing, [
    'index idx_asset_thumbnail_metadata_status',
    'index idx_asset_thumbnail_orphans_created_at',
  ]);
});

test('rejects invalid and unready required indexes', async () => {
  const pool = makePool({
    indexes: indexRows.map((index) => index.indexname === 'idx_asset_thumbnail_metadata_status'
      ? { ...index, indisvalid: false }
      : index.indexname === 'idx_asset_thumbnail_orphans_created_at'
        ? { ...index, indisready: false }
        : index),
  });

  const result = await checkAssetLifecycleSchema(pool);
  assert.equal(result.ready, false);
  assert.deepEqual(result.missing, [
    'index idx_asset_thumbnail_metadata_status',
    'index idx_asset_thumbnail_orphans_created_at',
  ]);
});

test('rejects missing, unvalidated, or incorrectly defined migration 028 constraints', async () => {
  const pool = makePool({
    constraints: constraints
      .filter((constraint) => constraint.constraintname !== 'asset_thumbnail_orphans_asset_id_thumbnail_path_key')
      .map((constraint) => constraint.constraintname === 'asset_thumbnail_metadata_status_check'
        ? { ...constraint, constraintdef: "CHECK (status IN ('PENDING', 'FAILED'))" }
        : constraint.constraintname === 'asset_thumbnail_metadata_asset_id_fkey'
          ? { ...constraint, convalidated: false }
          : constraint),
  });

  test('rejects missing or incompatible migration 029 lifecycle constraints', async () => {
    const result = await checkAssetLifecycleSchema(makePool({
      constraints: constraints
        .filter((constraint) => constraint.constraintname !== 'asset_lifecycle_operations_operation_check')
        .map((constraint) => constraint.constraintname === 'asset_lifecycle_operations_state_check'
          ? { ...constraint, constraintdef: "CHECK (state IN ('prepared', 'completed'))" }
          : constraint),
    }));

    assert.equal(result.ready, false);
    assert.deepEqual(result.missing, [
      'constraint asset_lifecycle_operations_operation_check',
      'constraint asset_lifecycle_operations_state_check',
    ]);
  });

  const result = await checkAssetLifecycleSchema(pool);
  assert.equal(result.ready, false);
  assert.deepEqual(result.missing, [
    'constraint asset_thumbnail_metadata_asset_id_fkey',
    'constraint asset_thumbnail_metadata_status_check',
    'constraint asset_thumbnail_orphans_asset_id_thumbnail_path_key',
  ]);
});

test('fails closed with a non-sensitive error when schema verification fails', async () => {
  const pool = makePool({ failOnQuery: 'connection details must not escape' });

  await assert.rejects(
    checkAssetLifecycleSchema(pool),
    { message: 'Asset upload/lifecycle schema readiness could not be verified.' }
  );
});
