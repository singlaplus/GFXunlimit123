const test = require('node:test');
const assert = require('node:assert/strict');
const ProcessorDetector = require('../thumbnail-engine/processor-detector');

test('processor configuration writes are disabled on macOS only', () => {
  assert.equal(ProcessorDetector.isProcessorConfigWriteAllowed('darwin'), false);
  assert.equal(ProcessorDetector.isProcessorConfigWriteAllowed('win32'), true);
  assert.equal(ProcessorDetector.isProcessorConfigWriteAllowed('linux'), true);
});
