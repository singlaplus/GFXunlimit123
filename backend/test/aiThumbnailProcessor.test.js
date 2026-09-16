const test = require('node:test');
const assert = require('node:assert/strict');
const AiProcessor = require('../thumbnail-engine/ai-processor');

test('AI processor renders PostScript Illustrator files server-side', async () => {
  const processor = new AiProcessor();
  const preview = Buffer.from('preview');
  let serverSideCalled = false;

  processor.extractPreviewServerSide = async () => {
    serverSideCalled = true;
    return preview;
  };
  processor.extractPreviewWithIllustrator = async () => {
    throw new Error('Illustrator fallback should not be used');
  };

  const result = await processor.extractPreview('/tmp/design.ai');

  assert.equal(serverSideCalled, true);
  assert.equal(result, preview);
});