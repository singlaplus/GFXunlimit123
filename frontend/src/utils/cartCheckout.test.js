import {
  calculateCartTotals,
  calculateBestBundleTierDiscount,
  calculateFlashSaleDiscount,
  getFlashSaleEligibleItems,
  getFlashSaleRequiredAssetCount,
  isBundleDiscountOfferActive,
  normalizeCouponCode
} from './cartCheckout';

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

  it('applies only the coupon when a coupon and Flash Sale are selected', () => {
    const result = calculateCartTotals([{ unitPrice: 100 }], {
      coupon: { discountType: 'flat', discountValue: 80 },
      flashSaleDiscount: 50,
      bundleDiscount: 45,
    });

    expect(result.discount).toBe(80);
    expect(result.total).toBe(20);
  });

  it('applies only the Flash Sale when a Flash Sale and bundle discount are selected', () => {
    const result = calculateCartTotals([{ unitPrice: 100 }], {
      flashSaleDiscount: 40,
      bundleDiscount: 50,
    });

    expect(result.discount).toBe(40);
    expect(result.total).toBe(60);
  });

  it('uses the bundle discount when it is the only selected offer', () => {
    const result = calculateCartTotals([{ unitPrice: 100 }], {
      bundleDiscount: 50,
    });

    expect(result.discount).toBe(50);
    expect(result.total).toBe(50);
  });
});

describe('Bundle discount calculations', () => {
  const tiers = [
    { asset_count: 3, discount_percent: 10 },
    { asset_count: 5, discount_percent: 15 },
    { asset_count: 10, discount_percent: 25 },
  ];
  const offer = {
    id: 1,
    name: 'Volume offer',
    status: 'active',
    metadata: { discount_tiers: tiers, start_date: '2020-01-01', end_date: null }
  };

  it('applies the highest qualifying tier to the paid asset subtotal', () => {
    const items = Array.from({ length: 5 }, (_, index) => ({ id: index + 1, unitPrice: 20 }));
    expect(calculateBestBundleTierDiscount(items, [offer])).toMatchObject({
      assetCount: 5,
      tier: { assetCount: 5, discountPercent: 15 },
      discount: 15,
    });
  });

  it('excludes subscription carts and ignores free and credit items when counting assets', () => {
    const items = [
      { id: 1, unitPrice: 10 },
      { id: 2, unitPrice: 10 },
      { id: 3, unitPrice: 10, freeAsset: true },
      { id: 'credits', unitPrice: 10, creditPackage: true },
      { id: 'subscription', unitPrice: 10, subscription: true },
    ];
    expect(calculateBestBundleTierDiscount(items, [offer])).toMatchObject({
      assetCount: 0,
      tier: null,
      discount: 0,
    });
  });

  it('uses the single active offer with the highest saving', () => {
    const threeAssets = Array.from({ length: 3 }, (_, index) => ({ id: index + 1, unitPrice: 100 }));
    const betterOffer = {
      id: 2,
      status: 'active',
      metadata: {
        discount_tiers: [{ asset_count: 3, discount_percent: 20 }],
        start_date: '2020-01-01'
      },
    };
    const inactiveOffer = {
      id: 3,
      status: 'draft',
      metadata: { discount_tiers: [{ asset_count: 3, discount_percent: 90 }] },
    };
    expect(calculateBestBundleTierDiscount(threeAssets, [offer, betterOffer, inactiveOffer])).toMatchObject({
      offer: betterOffer,
      discount: 60,
    });
  });

  it('uses the selected eligible bundle offer instead of the default best-saving offer', () => {
    const threeAssets = Array.from({ length: 3 }, (_, index) => ({ id: index + 1, unitPrice: 100 }));
    const lowerOffer = {
      id: 4,
      status: 'active',
      metadata: {
        start_date: '2020-01-01',
        discount_tiers: [{ asset_count: 3, discount_percent: 10 }]
      }
    };
    const higherOffer = {
      id: 5,
      status: 'active',
      metadata: {
        start_date: '2020-01-01',
        discount_tiers: [{ asset_count: 3, discount_percent: 20 }]
      }
    };

    expect(calculateBestBundleTierDiscount(threeAssets, [lowerOffer, higherOffer], lowerOffer.id)).toMatchObject({
      offer: lowerOffer,
      discount: 30
    });
  });

  it('only considers offers inside their inclusive date range', () => {
    const datedOffer = {
      ...offer,
      metadata: { ...offer.metadata, start_date: '2026-10-29', end_date: '2026-11-02' }
    };
    expect(isBundleDiscountOfferActive(datedOffer, '2026-10-28')).toBe(false);
    expect(isBundleDiscountOfferActive(datedOffer, '2026-10-29')).toBe(true);
    expect(isBundleDiscountOfferActive(datedOffer, '2026-11-02')).toBe(true);
    expect(isBundleDiscountOfferActive(datedOffer, '2026-11-03')).toBe(false);
    expect(isBundleDiscountOfferActive({
      ...datedOffer,
      metadata: { ...datedOffer.metadata, start_date: '2026-02-30' }
    }, '2026-02-15')).toBe(false);
  });
});

describe('Flash Sale calculations', () => {
  const items = [
    { id: 1, title: 'Asset 1', unitPrice: 100, category: 'Nature', keywords: 'cat holiday' },
    { id: 2, title: 'Asset 2', unitPrice: 40, category: 'Nature', keywords: 'diwali' },
    { id: 3, title: 'Asset 3', unitPrice: 30, category: 'Nature', keywords: 'building' },
    { id: 4, title: 'Asset 4', unitPrice: 25, category: 'Travel', keywords: 'cat' },
  ];

  it('maps BOGO rules to the required number of selected assets', () => {
    expect(getFlashSaleRequiredAssetCount('BOGO')).toBe(2);
    expect(getFlashSaleRequiredAssetCount('BOG2')).toBe(3);
    expect(getFlashSaleRequiredAssetCount('BOG3')).toBe(4);
    expect(getFlashSaleRequiredAssetCount('BOG5')).toBe(6);
  });

  it('charges the highest-priced selected BOG2 asset and discounts the other two', () => {
    const sale = { discount_rule: 'BOG2', featured_placement: 'homepage', metadata: {} };

    expect(calculateFlashSaleDiscount(items, sale, [1, 2])).toBe(0);
    expect(calculateFlashSaleDiscount(items, sale, [1, 2, 3])).toBe(70);
  });

  it('limits percentage discounts to assets matching the placement and keywords', () => {
    const sale = {
      discount_rule: 'percentage',
      featured_placement: 'category',
      featured_category_name: 'Nature',
      metadata: { featured_category_id: '1', discount_value: 10, keywords: 'cat, building' },
    };

    expect(getFlashSaleEligibleItems(items, sale).map((item) => item.id)).toEqual([1, 3]);
    expect(calculateFlashSaleDiscount(items, sale)).toBe(13);
  });

  it('caps a fixed-amount discount to the eligible asset subtotal', () => {
    const sale = {
      discount_rule: 'fixed_amount',
      featured_placement: 'collection',
      featured_collection_name: 'Nature Collection',
      metadata: { featured_collection_id: '2', discount_value: 500 },
    };
    const collectionItems = items.slice(0, 3).map((item) => ({ ...item, collection: 'Nature Collection' }));

    expect(calculateFlashSaleDiscount(collectionItems, sale)).toBe(170);
  });
});
