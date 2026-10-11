const REQUIRED_TABLES = [
  'asset_thumbnail_metadata',
  'asset_thumbnail_orphans',
  'asset_lifecycle_operations',
  'images',
];

const REQUIRED_COLUMNS = {
  images: {
    upload_request_id: { data_type: 'uuid', is_nullable: 'YES' },
    upload_content_sha256: { data_type: 'text', is_nullable: 'YES' },
    upload_request_hash: { data_type: 'text', is_nullable: 'YES' },
    upload_file_device: { data_type: 'text', is_nullable: 'YES' },
    upload_file_inode: { data_type: 'text', is_nullable: 'YES' },
    upload_target_status: { data_type: 'text', is_nullable: 'YES' },
    upload_error: { data_type: 'text', is_nullable: 'YES' },
  },
  asset_lifecycle_operations: {
    id: {
      data_type: 'bigint',
      is_nullable: 'NO',
      default_matches: (value) => /^nextval\(/.test(normalizeDefault(value)),
    },
    asset_id: { data_type: 'bigint', is_nullable: 'NO' },
    operation: { data_type: 'text', is_nullable: 'NO' },
    state: { data_type: 'text', is_nullable: 'NO' },
    old_filename: { data_type: 'text', is_nullable: 'NO' },
    new_filename: { data_type: 'text', is_nullable: 'YES' },
    content_sha256: { data_type: 'text', is_nullable: 'YES' },
    temporary_device: { data_type: 'text', is_nullable: 'YES' },
    temporary_inode: { data_type: 'text', is_nullable: 'YES' },
    thumbnail_paths: {
      data_type: 'jsonb',
      is_nullable: 'NO',
      default_matches: (value) => normalizeDefault(value) === "'[]'::jsonb",
    },
    error_message: { data_type: 'text', is_nullable: 'YES' },
    created_at: {
      data_type: 'timestamp with time zone',
      is_nullable: 'NO',
      default_matches: (value) => normalizeDefault(value) === 'now()',
    },
    updated_at: {
      data_type: 'timestamp with time zone',
      is_nullable: 'NO',
      default_matches: (value) => normalizeDefault(value) === 'now()',
    },
  },
  asset_thumbnail_metadata: {
    asset_id: { data_type: 'integer', is_nullable: 'NO' },
    thumbnail_path: { data_type: 'text', is_nullable: 'NO' },
    format: {
      data_type: 'character varying',
      character_maximum_length: 16,
      is_nullable: 'NO',
      default_matches: (value) => normalizeDefault(value) === "'webp'",
    },
    width: { data_type: 'integer', is_nullable: 'YES' },
    height: { data_type: 'integer', is_nullable: 'YES' },
    file_size: { data_type: 'bigint', is_nullable: 'YES' },
    quality: { data_type: 'integer', is_nullable: 'YES' },
    generated_at: { data_type: 'timestamp with time zone', is_nullable: 'YES' },
    source_size: { data_type: 'bigint', is_nullable: 'YES' },
    source_modified_at: { data_type: 'timestamp with time zone', is_nullable: 'YES' },
    processor: { data_type: 'character varying', character_maximum_length: 64, is_nullable: 'YES' },
    processor_version: { data_type: 'character varying', character_maximum_length: 64, is_nullable: 'NO' },
    status: {
      data_type: 'character varying',
      character_maximum_length: 24,
      is_nullable: 'NO',
      default_matches: (value) => normalizeDefault(value) === "'pending'",
    },
    error_message: { data_type: 'text', is_nullable: 'YES' },
    attempt_count: {
      data_type: 'integer',
      is_nullable: 'NO',
      default_matches: (value) => normalizeDefault(value) === '0',
    },
    last_attempt_at: { data_type: 'timestamp with time zone', is_nullable: 'YES' },
    updated_at: {
      data_type: 'timestamp with time zone',
      is_nullable: 'NO',
      default_matches: (value) => normalizeDefault(value) === 'now()',
    },
  },
  asset_thumbnail_orphans: {
    id: {
      data_type: 'bigint',
      is_nullable: 'NO',
      default_matches: (value) => /^nextval\(/.test(normalizeDefault(value)),
    },
    asset_id: { data_type: 'integer', is_nullable: 'NO' },
    thumbnail_path: { data_type: 'text', is_nullable: 'NO' },
    error_message: { data_type: 'text', is_nullable: 'NO' },
    created_at: {
      data_type: 'timestamp with time zone',
      is_nullable: 'NO',
      default_matches: (value) => normalizeDefault(value) === 'now()',
    },
    last_attempt_at: { data_type: 'timestamp with time zone', is_nullable: 'YES' },
    cleanup_attempts: {
      data_type: 'integer',
      is_nullable: 'NO',
      default_matches: (value) => normalizeDefault(value) === '0',
    },
  },
};

const REQUIRED_INDEXES = {
  asset_lifecycle_operations_pkey: {
    table: 'asset_lifecycle_operations',
    matches: (definition) => normalizeIndexDefinition(definition) ===
      'create unique index asset_lifecycle_operations_pkey on asset_lifecycle_operations using btree (id)',
  },
  asset_thumbnail_metadata_pkey: {
    table: 'asset_thumbnail_metadata',
    matches: (definition) => normalizeIndexDefinition(definition) ===
      'create unique index asset_thumbnail_metadata_pkey on asset_thumbnail_metadata using btree (asset_id)',
  },
  idx_asset_thumbnail_metadata_status: {
    table: 'asset_thumbnail_metadata',
    matches: (definition) => normalizeIndexDefinition(definition) ===
      'create index idx_asset_thumbnail_metadata_status on asset_thumbnail_metadata using btree (status)',
  },
  idx_asset_thumbnail_orphans_created_at: {
    table: 'asset_thumbnail_orphans',
    matches: (definition) => normalizeIndexDefinition(definition) ===
      'create index idx_asset_thumbnail_orphans_created_at on asset_thumbnail_orphans using btree (created_at)',
  },
  asset_thumbnail_orphans_pkey: {
    table: 'asset_thumbnail_orphans',
    matches: (definition) => normalizeIndexDefinition(definition) ===
      'create unique index asset_thumbnail_orphans_pkey on asset_thumbnail_orphans using btree (id)',
  },
  asset_thumbnail_orphans_asset_id_thumbnail_path_key: {
    table: 'asset_thumbnail_orphans',
    matches: (definition) => normalizeIndexDefinition(definition) ===
      'create unique index asset_thumbnail_orphans_asset_id_thumbnail_path_key on asset_thumbnail_orphans using btree (asset_id, thumbnail_path)',
  },
  images_upload_request_owner_uidx: (definition) => {
    const normalized = normalizeIndexDefinition(definition);
    return normalized.startsWith('create unique index ') &&
      / on (?:public\.)?images using btree \(uploaded_by, upload_request_id\) where \(upload_request_id is not null\)$/.test(normalized);
  },
  asset_lifecycle_operations_pending_idx: (definition) => {
    const normalized = normalizeIndexDefinition(definition);
    return normalized.startsWith('create index ') &&
      / on (?:public\.)?asset_lifecycle_operations using btree \(id\) where \(state = any \(array\['prepared', 'db_committed', 'recovery_required'\]\)\)$/.test(normalized);
  },
};

const REQUIRED_CONSTRAINTS = {
  asset_lifecycle_operations_pkey: {
    table: 'asset_lifecycle_operations',
    type: 'p',
    matches: (definition) => compactConstraintDefinition(definition) === 'primarykeyid',
  },
  asset_lifecycle_operations_operation_check: {
    table: 'asset_lifecycle_operations',
    type: 'c',
    matches: (definition) => matchesAllowedValues(definition, 'operation', ['move', 'delete']),
  },
  asset_lifecycle_operations_state_check: {
    table: 'asset_lifecycle_operations',
    type: 'c',
    matches: (definition) => matchesAllowedValues(definition, 'state', [
      'prepared', 'db_committed', 'recovery_required', 'completed', 'aborted',
    ]),
  },
  asset_thumbnail_metadata_pkey: {
    table: 'asset_thumbnail_metadata',
    type: 'p',
    matches: (definition) => compactConstraintDefinition(definition) === 'primarykeyasset_id',
  },
  asset_thumbnail_metadata_asset_id_fkey: {
    table: 'asset_thumbnail_metadata',
    type: 'f',
    matches: (definition) => compactConstraintDefinition(definition) ===
      'foreignkeyasset_idreferencesimagesidondeletecascade',
  },
  asset_thumbnail_metadata_status_check: {
    table: 'asset_thumbnail_metadata',
    type: 'c',
    matches: (definition) => matchesAllowedValues(definition, 'status', [
      'pending', 'processing', 'ready', 'failed',
    ]),
  },
  asset_thumbnail_orphans_pkey: {
    table: 'asset_thumbnail_orphans',
    type: 'p',
    matches: (definition) => compactConstraintDefinition(definition) === 'primarykeyid',
  },
  asset_thumbnail_orphans_asset_id_thumbnail_path_key: {
    table: 'asset_thumbnail_orphans',
    type: 'u',
    matches: (definition) => compactConstraintDefinition(definition) ===
      'uniqueasset_id,thumbnail_path',
  },
};

function normalizeIndexDefinition(definition) {
  return String(definition || '')
    .toLowerCase()
    .replace(/\bpublic\./g, '')
    .replace(/::text/g, '')
    .replace(/::character varying/g, '')
    .replace(/::varchar/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeConstraintDefinition(definition) {
  return String(definition || '')
    .toLowerCase()
    .replace(/\bpublic\./g, '')
    .replace(/::text\[\]/g, '')
    .replace(/::text/g, '')
    .replace(/::character varying\[\]/g, '')
    .replace(/::character varying/g, '')
    .replace(/::varchar/g, '')
    .replace(/\[\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactConstraintDefinition(definition) {
  return normalizeConstraintDefinition(definition).replace(/[()\s]/g, '');
}

function matchesAllowedValues(definition, column, values) {
  const compact = compactConstraintDefinition(definition);
  const allowed = values.map((value) => `'${value}'`).join(',');
  return compact === `check${column}in${allowed}` ||
    compact === `check${column}=anyarray[${allowed}]`;
}

function normalizeDefault(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/::character varying/g, '')
    .replace(/::regclass/g, '')
    .replace(/\s+/g, '')
    .replace(/^\((.*)\)$/, '$1');
}

async function checkAssetLifecycleSchema(pool) {
  let tables;
  let columns;
  let indexes;
  let constraints;
  const requiredColumnEntries = Object.entries(REQUIRED_COLUMNS).flatMap(([table, definition]) => {
    const names = Array.isArray(definition) ? definition : Object.keys(definition);
    return names.map((column) => [table, column]);
  });
  try {
    [tables, columns, indexes, constraints] = await Promise.all([
      pool.query(
        `SELECT table_name
         FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
        [REQUIRED_TABLES]
      ),
      pool.query(
        `SELECT table_name, column_name, data_type, character_maximum_length, is_nullable,
                column_default
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND (table_name, column_name) IN (
             SELECT required.table_name, required.column_name
             FROM unnest($1::text[], $2::text[]) AS required(table_name, column_name)
           )`,
        [
          requiredColumnEntries.map(([table]) => table),
          requiredColumnEntries.map(([, column]) => column),
        ]
      ),
      pool.query(
        `SELECT table_relation.relname AS tablename,
                index_relation.relname AS indexname,
                pg_get_indexdef(index_info.indexrelid) AS indexdef,
                index_info.indisvalid,
                index_info.indisready
         FROM pg_index AS index_info
         JOIN pg_class AS index_relation ON index_relation.oid = index_info.indexrelid
         JOIN pg_class AS table_relation ON table_relation.oid = index_info.indrelid
         JOIN pg_namespace AS table_namespace ON table_namespace.oid = table_relation.relnamespace
         WHERE table_namespace.nspname = 'public'
           AND index_relation.relname = ANY($1::text[])`,
        [Object.keys(REQUIRED_INDEXES)]
      ),
      pool.query(
        `SELECT relation.relname AS tablename,
                constraint_info.conname AS constraintname,
                constraint_info.contype,
                constraint_info.convalidated,
                pg_get_constraintdef(constraint_info.oid) AS constraintdef
         FROM pg_constraint AS constraint_info
         JOIN pg_class AS relation ON relation.oid = constraint_info.conrelid
         JOIN pg_namespace AS relation_namespace ON relation_namespace.oid = relation.relnamespace
         WHERE relation_namespace.nspname = 'public'
           AND constraint_info.conname = ANY($1::text[])`,
        [Object.keys(REQUIRED_CONSTRAINTS)]
      ),
    ]);
  } catch (_error) {
    throw new Error('Asset upload/lifecycle schema readiness could not be verified.');
  }

  const existingTables = new Set(tables.rows.map((row) => row.table_name));
  const existingColumns = new Map(columns.rows.map((row) => [
    `${row.table_name}.${row.column_name}`,
    row,
  ]));
  const indexRows = new Map(indexes.rows.map((row) => [row.indexname, row]));
  const missing = [];

  for (const table of REQUIRED_TABLES) {
    if (!existingTables.has(table)) missing.push(`table ${table}`);
  }
  for (const [table, specification] of Object.entries(REQUIRED_COLUMNS)) {
    const expectedColumns = Array.isArray(specification)
      ? Object.fromEntries(specification.map((column) => [column, {}]))
      : specification;
    for (const [column, expected] of Object.entries(expectedColumns)) {
      const actual = existingColumns.get(`${table}.${column}`);
      if (!actual) {
        missing.push(`column ${table}.${column}`);
      } else if (
        (expected.data_type && actual.data_type !== expected.data_type) ||
        (expected.character_maximum_length &&
          Number(actual.character_maximum_length) !== expected.character_maximum_length) ||
        (expected.is_nullable && actual.is_nullable !== expected.is_nullable) ||
        (expected.default_matches && !expected.default_matches(actual.column_default))
      ) {
        missing.push(`column ${table}.${column} definition`);
      }
    }
  }
  for (const [indexName, requirement] of Object.entries(REQUIRED_INDEXES)) {
    const index = indexRows.get(indexName);
    const expectedTable = typeof requirement === 'function'
      ? (indexName.startsWith('images_') ? 'images' : 'asset_lifecycle_operations')
      : requirement.table;
    const matches = typeof requirement === 'function' ? requirement : requirement.matches;
    if (
      !index ||
      index.tablename !== expectedTable ||
      index.indisvalid !== true ||
      index.indisready !== true ||
      !matches(index.indexdef)
    ) {
      missing.push(`index ${indexName}`);
    }
  }
  const constraintRows = new Map(constraints.rows.map((row) => [row.constraintname, row]));
  for (const [constraintName, requirement] of Object.entries(REQUIRED_CONSTRAINTS)) {
    const constraint = constraintRows.get(constraintName);
    if (
      !constraint ||
      constraint.tablename !== requirement.table ||
      constraint.contype !== requirement.type ||
      constraint.convalidated !== true ||
      !requirement.matches(constraint.constraintdef)
    ) {
      missing.push(`constraint ${constraintName}`);
    }
  }

  return { ready: missing.length === 0, missing };
}

module.exports = {
  checkAssetLifecycleSchema,
  REQUIRED_COLUMNS,
  REQUIRED_CONSTRAINTS,
  REQUIRED_INDEXES,
};
