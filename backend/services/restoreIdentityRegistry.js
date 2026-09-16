const IDENTITY_RULES = {
  users: [['email'], ['username']],
  images: [['checksum'], ['filename', 'uploaded_by']],
  orders: [['order_number'], ['invoice_number'], ['transaction_id']],
  coupons: [['code']],
  categories: [['slug']],
  subscriptions: [['subscription_id'], ['customer_id', 'plan_id']],
  messages: [['reference_id']],
  notifications: [['notification_id'], ['reference_id']],
  activity_events: [['event_uuid'], ['event_id']]
};

function getIdentityColumns(tableName, row, declaredColumns = []) {
  const normalizedTable = String(tableName || '').toLowerCase();
  const rules = IDENTITY_RULES[normalizedTable] || [];

  for (const columns of rules) {
    if (columns.every((column) => row?.[column] !== undefined && row?.[column] !== null && row[column] !== '')) {
      return columns;
    }
  }

  const declared = (Array.isArray(declaredColumns) ? declaredColumns : [])
    .filter((column) => row?.[column] !== undefined && row?.[column] !== null && row[column] !== '');
  if (declared.length && !(declared.length === 1 && declared[0] === 'id' && rules.length)) {
    return declared;
  }

  if (normalizedTable === 'users' || normalizedTable === 'images' || normalizedTable === 'orders') {
    return [];
  }

  const fallback = ['id', 'uuid', 'slug'].find((column) => row?.[column] !== undefined && row?.[column] !== null);
  return fallback ? [fallback] : [];
}

function buildIdentity(row, tableName, declaredColumns = []) {
  const columns = getIdentityColumns(tableName, row, declaredColumns);
  if (!columns.length) return null;
  return {
    columns,
    values: Object.fromEntries(columns.map((column) => [column, row[column]])),
    key: columns.map((column) => `${column}=${row[column]}`).join('&')
  };
}

module.exports = { IDENTITY_RULES, getIdentityColumns, buildIdentity };
