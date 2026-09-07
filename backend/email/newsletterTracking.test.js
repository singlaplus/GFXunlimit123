const test = require('node:test');
const assert = require('node:assert/strict');
const { injectTrackingIntoHtml, getTrackingWindowStatus } = require('./newsletterTracking');

test('injectTrackingIntoHtml adds a tracking pixel and rewrites click links', () => {
  const html = '<p>Hello <a href="https://example.com/page">Open</a></p>';
  const tracked = injectTrackingIntoHtml(html, 42, 'user@example.com', 'http://localhost:5000');
  assert.match(tracked, /track\/open\/42\/user%40example.com/);
  assert.match(tracked, /track\/click\/42\/user%40example.com/);
  assert.match(tracked, /url=https%3A%2F%2Fexample.com%2Fpage/);
});

test('getTrackingWindowStatus marks data older than six hours as archived', () => {
  const now = new Date();
  const recent = new Date(now.getTime() - 2 * 60 * 60 * 1000);
  const old = new Date(now.getTime() - 7 * 60 * 60 * 1000);
  assert.equal(getTrackingWindowStatus(recent), 'active');
  assert.equal(getTrackingWindowStatus(old), 'archived');
});

test('injectTrackingIntoHtml appends a pixel and rewrites links even without a body tag', () => {
  const html = '<div>Welcome <a href="https://example.com">Go</a></div>';
  const tracked = injectTrackingIntoHtml(html, 7, 'user@example.com', 'http://localhost:5000');
  assert.match(tracked, /track\/open\/7\/user%40example.com/);
  assert.match(tracked, /track\/click\/7\/user%40example.com/);
  assert.match(tracked, /url=https%3A%2F%2Fexample\.com/);
});
