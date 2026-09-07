import { calculateCartTotals, normalizeCouponCode } from './cartCheckout';

describe('calculateCartTotals', () => {
  it('normalizes coupon codes across casing and whitespace', () => {
    expect(normalizeCouponCode('  s1  ')).toBe('S1');
    expect(normalizeCouponCode('welcome10')).toBe('WELCOME10');
  });
  it('applies percentage discounts and multiple taxes correctly', () => {
    const result = calculateCartTotals([
      { unitPrice: 100, quantity: 1 },
      { unitPrice: 50, quantity: 2 },
    ], {
      coupon: { discountType: 'percentage', discountValue: 10 },
      taxSettings: [
        { enabled: true, rate: 5, label: 'CGST', type: 'percentage' },
        { enabled: true, rate: 5, label: 'SGST', type: 'percentage' }
      ],
      currency: 'USD',
    });

    expect(result.subtotal).toBe(200);
    expect(result.discount).toBe(20);
    expect(result.tax).toBe(18); // (200 - 20) * 0.10 = 18
    expect(result.total).toBe(198);
    expect(result.currency).toBe('USD');
  });

  it('supports flat discounts and mixed tax settings', () => {
    const result = calculateCartTotals([
      { unitPrice: 0, quantity: 1 },
      { unitPrice: 75, quantity: 1 },
    ], {
      coupon: { discountType: 'flat', discountValue: 25 },
      taxSettings: [
        { enabled: true, rate: 8, label: 'Tax1', type: 'percentage' },
        { enabled: false, rate: 10, label: 'Tax2', type: 'percentage' }
      ],
      currency: 'EUR',
    });

    expect(result.subtotal).toBe(75);
    expect(result.discount).toBe(25);
    expect(result.tax).toBe(4); // (75 - 25) * 0.08 = 4
    expect(result.total).toBe(54);
    expect(result.currency).toBe('EUR');
  });

  it('supports the fixed coupon alias as a flat amount discount', () => {
    const result = calculateCartTotals([
      { unitPrice: 100, quantity: 1 },
    ], {
      coupon: { discountType: 'fixed', discountValue: 20 },
      taxSettings: [
        { enabled: true, rate: 10, label: 'Tax', type: 'percentage' }
      ],
      currency: 'USD',
    });

    expect(result.discount).toBe(20);
    expect(result.tax).toBe(8); // (100 - 20) * 0.10
    expect(result.total).toBe(88);
  });

  it('zeros all taxes when a 100% coupon covers the full subtotal', () => {
    const result = calculateCartTotals([
      { unitPrice: 100, quantity: 1 },
    ], {
      coupon: { discountType: 'percentage', discountValue: 100 },
      taxSettings: [
        { enabled: true, type: 'percentage', rate: 18, label: 'GST' },
        { enabled: true, type: 'fixed', amount: 5, label: 'Handling Fee' },
      ],
      currency: 'INR',
    });

    expect(result.discount).toBe(100);
    expect(result.tax).toBe(0);
    expect(result.total).toBe(0);
  });

  it('supports fixed amount taxes in addition to percentage taxes', () => {
    const result = calculateCartTotals([
      { unitPrice: 120, quantity: 1 },
    ], {
      taxSettings: [
        { enabled: true, type: 'percentage', rate: 10, label: 'GST' },
        { enabled: true, type: 'fixed', amount: 5, label: 'Handling Fee' },
      ],
      currency: 'INR',
    });

    expect(result.subtotal).toBe(120);
    expect(result.tax).toBe(17);
    expect(result.total).toBe(137);
  });

  it('keeps percentage and fixed tax values isolated per row', () => {
    const result = calculateCartTotals([
      { unitPrice: 100, quantity: 1 },
    ], {
      taxSettings: [
        { enabled: true, type: 'percentage', rate: 18, amount: 0, label: 'GST' },
        { enabled: true, type: 'fixed', rate: 0, amount: 5, label: 'Handling Fee' },
      ],
      currency: 'INR',
    });

    expect(result.tax).toBe(23);
    expect(result.total).toBe(123);
  });
});
