const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
require('./helpers/blockPostgres');
const ProcessorDetector = require('../thumbnail-engine/processor-detector');

test('detectFfmpeg honors the configured executable path', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ffmpeg-detector-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const executablePath = path.join(directory, 'ffmpeg');
  fs.writeFileSync(executablePath, '#!/bin/sh\nprintf "ffmpeg version 7.1.1\\n"\n');
  fs.chmodSync(executablePath, 0o755);
  const previousPath = process.env.FFMPEG_PATH;
  process.env.FFMPEG_PATH = executablePath;

  try {
    const result = await new ProcessorDetector().detectFfmpeg();
    assert.equal(result.status, 'READY');
    assert.equal(result.executablePath, executablePath);
    assert.equal(result.version, '7.1.1');
  } finally {
    if (previousPath === undefined) delete process.env.FFMPEG_PATH;
    else process.env.FFMPEG_PATH = previousPath;
  }
});

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
