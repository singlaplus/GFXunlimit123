const test = require('node:test');
const assert = require('node:assert/strict');

const { DEFAULT_MAX_UPLOAD_FILE_SIZE, resolveUploadLimitBytes } = require('../uploadLimits');

test('default upload limit is 20MB', () => {
  assert.equal(DEFAULT_MAX_UPLOAD_FILE_SIZE, 20 * 1024 * 1024, 'Default upload limit should be 20MB');
});

test('admin upload limit values support 1, 5, 10, 20, 100 with MB or GB', () => {
  assert.equal(resolveUploadLimitBytes({ upload_limit_value: 1, upload_limit_unit: 'MB' }), 1 * 1024 * 1024);
  assert.equal(resolveUploadLimitBytes({ upload_limit_value: 5, upload_limit_unit: 'GB' }), 5 * 1024 * 1024 * 1024);
  assert.equal(resolveUploadLimitBytes({ upload_limit_value: 20, upload_limit_unit: 'MB' }), 20 * 1024 * 1024);
  assert.equal(resolveUploadLimitBytes({ upload_limit_value: 100, upload_limit_unit: 'MB' }), 100 * 1024 * 1024);
  assert.equal(resolveUploadLimitBytes({}), DEFAULT_MAX_UPLOAD_FILE_SIZE);
});
