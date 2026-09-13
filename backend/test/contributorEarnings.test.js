const test = require('node:test');
const assert = require('node:assert/strict');

const { calculateContributorEarning } = require('../server');

test('applies percentage to discounted asset value and converts to INR only', () => {
  const amount = calculateContributorEarning({
    currency: 'USD',
    lineTotal: 2,
    discountAmount: 0.2,
    commissionPercent: 10,
    exchangeRate: 83,
  });

  assert.equal(amount, 0.18);
});

test('returns zero when discount removes the full asset value', () => {
  const amount = calculateContributorEarning({
    currency: 'INR',
    lineTotal: 2,
    discountAmount: 2,
    commissionPercent: 10,
    exchangeRate: 83,
  });

  assert.equal(amount, 0);
});

test('uses the fixed INR subscription amount when a subscription download is used', () => {
  const amount = calculateContributorEarning({
    currency: 'USD',
    lineTotal: 0,
    discountAmount: 0,
    commissionPercent: 10,
    exchangeRate: 83,
    isSubscriptionDownload: true,
  });

  assert.equal(amount, 0.1);
});
