const test = require('node:test');
const assert = require('node:assert/strict');
require('./helpers/blockPostgres');
const ProcessorDetector = require('../thumbnail-engine/processor-detector');

test('reports current tool detections instead of stale macOS database statuses', async () => {
  const detector = new ProcessorDetector();
  detector.getProcessorConfig = async () => [
    { processor_name: 'ffmpeg', status: 'NOT_AVAILABLE', version: null },
    { processor_name: 'imagemagick', status: 'NOT_AVAILABLE', version: null },
  ];
  detector.detectionResults = {
    ffmpeg: { status: 'READY', executablePath: '/opt/homebrew/bin/ffmpeg', version: '9.0.2' },
    imagemagick: { status: 'READY', executablePath: '/opt/homebrew/bin/magick', version: 'ImageMagick 7' },
  };
  const output = [];
  const originalLog = console.log;
  console.log = (...args) => output.push(args.join(' '));

  try {
    await detector.printStatusTable();
  } finally {
    console.log = originalLog;
  }

  const table = output.join('\n');
  assert.match(table, /ffmpeg\s+✓ READY\s+9\.0\.2/);
  assert.match(table, /imagemagick\s+✓ READY\s+ImageMagick 7/);
});

test('checks that the built-in AI processor can route .ai files', async () => {
  const result = await new ProcessorDetector().detectAiProcessor();
  assert.equal(result.status, 'READY');
});
