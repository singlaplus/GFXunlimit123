const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeAdminInboxReadState, isAdminInboxCreditRequestRow } = require('../messaging');

test('normalizeAdminInboxReadState marks rows with a timestamp as read', () => {
  const rows = [
    { id: 1, source_type: 'activity', read_at: null },
    { id: 2, source_type: 'message', read_at: '2026-08-29T12:00:00.000Z' },
    { id: 3, source_type: 'asset-request', is_read: true },
    { id: 4, source_type: 'credit-request', is_read: false },
  ];

  const normalized = normalizeAdminInboxReadState(rows);

  assert.deepEqual(normalized.map((row) => row.is_read), [false, true, true, false]);
  assert.equal(normalized[0].read_at, null);
  assert.equal(normalized[1].read_at, '2026-08-29T12:00:00.000Z');
});

test('credit_request items remain visible in admin inbox while pending approval', () => {
  const creditRequestRows = [
    {
      id: 312,
      source_type: 'credit-request',
      category: 'Customer credit request pending approval',
      description: 'Customer demo_user requested credits in order GFX250823-01.',
      order_type: 'credit_purchase',
      payment_method: 'request to admin',
      order_status: 'pending',
      payment_status: 'pending',
      is_read: false,
      read_at: null,
      created_at: '2026-08-29T09:15:00.000Z',
    },
    {
      id: 314,
      source_type: 'credit-request',
      category: 'Credit request approval required',
      description: 'Customer another_user requested credits in order GFX250823-02.',
      order_type: 'credit_purchase',
      payment_method: 'request to admin',
      order_status: 'completed',
      payment_status: 'paid',
      is_read: true,
      read_at: '2026-08-29T10:00:00.000Z',
      created_at: '2026-08-29T10:00:00.000Z',
    },
  ];

  const visibleRequests = creditRequestRows.filter((row) => isAdminInboxCreditRequestRow(row));
  const normalized = normalizeAdminInboxReadState(creditRequestRows);

  assert.equal(visibleRequests.length, 1);
  assert.equal(visibleRequests[0].id, 312);
  assert.equal(normalized[0].source_type, 'credit-request');
  assert.equal(normalized[0].category, 'Customer credit request pending approval');
  assert.equal(normalized[0].is_read, false);
  assert.equal(normalized[1].is_read, true);
  assert.equal(normalized.length, 2);
});

test('new contributor approvals are included in the admin inbox', () => {
  const contributorRows = [
    {
      id: 901,
      source_type: 'contributor-request',
      category: 'New contributor approval required',
      description: 'New contributor new_creator is awaiting approval.',
      user_id: 901,
      username: 'new_creator',
      created_at: '2026-08-29T08:00:00.000Z',
      is_read: false,
      read_at: null,
    },
    {
      id: 902,
      source_type: 'contributor-request',
      category: 'New contributor approval required',
      description: 'New contributor approved_creator is already active.',
      user_id: 902,
      username: 'approved_creator',
      created_at: '2026-08-29T07:00:00.000Z',
      is_read: true,
      read_at: '2026-08-29T07:30:00.000Z',
    },
  ];

  const visibleContributors = contributorRows.filter((row) => row.source_type === 'contributor-request' && row.is_read === false);

  assert.equal(visibleContributors.length, 1);
  assert.equal(visibleContributors[0].username, 'new_creator');
  assert.equal(visibleContributors[0].category, 'New contributor approval required');
});
