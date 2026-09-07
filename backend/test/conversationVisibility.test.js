const test = require('node:test');
const assert = require('node:assert/strict');
const { clearConversationVisibilityForParticipants } = require('../messaging.js');

test('new replies clear prior hidden flags for both conversation participants', async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rowCount: 2 };
    },
  };

  const cleared = await clearConversationVisibilityForParticipants(pool, 42, [5, 9]);

  assert.equal(cleared, 2);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /DELETE FROM conversation_hidden_for_users/i);
  assert.equal(calls[0].params[0], 42);
  assert.deepEqual(calls[0].params[1], [5, 9]);
});
