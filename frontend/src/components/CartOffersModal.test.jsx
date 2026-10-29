import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import CartOffersModal from "./CartOffersModal";

const commonProps = {
  open: true,
  onClose: jest.fn(),
  darkMode: false,
  items: [
    { id: 1, unitPrice: 100, category: "Nature" },
    { id: 2, unitPrice: 50, category: "Nature" },
    { id: 3, unitPrice: 25, category: "Nature" },
  ],
  coupons: [],
  appliedCoupon: null,
  couponError: "",
  onApplyCoupon: jest.fn(),
  flashSales: [],
  appliedFlashSale: null,
  onApplyFlashSale: jest.fn(),
  bundleOffers: [],
  appliedBundleOfferId: "",
  onApplyBundle: jest.fn(),
  subscriptionRestricted: false,
};

describe("CartOffersModal", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("applies an eligible coupon and closes the dialog", async () => {
    const onApplyCoupon = jest.fn().mockResolvedValue(true);
    render(<CartOffersModal
      {...commonProps}
      coupons={[{ id: 3, name: "Welcome offer", code: "WELCOME10", coupon_type: "manual", discount_type: "percentage", discount_value: 10 }]}
      onApplyCoupon={onApplyCoupon}
    />);

    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() => {
      expect(onApplyCoupon).toHaveBeenCalledWith("WELCOME10");
      expect(commonProps.onClose).toHaveBeenCalled();
    });
  });

  it("allows applying a qualifying Flash Sale and blocks ineligible sales", () => {
    const onApplyFlashSale = jest.fn();
    render(<CartOffersModal
      {...commonProps}
      flashSales={[
        { id: 1, name: "BOGO sale", discount_rule: "BOGO", metadata: {}, featured_placement: "homepage" },
        { id: 2, name: "Large bundle sale", discount_rule: "BOG5", metadata: {}, featured_placement: "homepage" },
      ]}
      onApplyFlashSale={onApplyFlashSale}
    />);

    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onApplyFlashSale).toHaveBeenCalledWith(expect.objectContaining({ id: 1, name: "BOGO sale" }));
    expect(screen.getByRole("button", { name: "Not eligible" })).toBeDisabled();
  });

  it("applies an eligible bundle offer but disables one that has not reached its tier", () => {
    const onApplyBundle = jest.fn();
    render(<CartOffersModal
      {...commonProps}
      bundleOffers={[
        {
          id: 5,
          name: "Three-asset offer",
          status: "active",
          metadata: {
            start_date: "2020-01-01",
            discount_tiers: [{ asset_count: 3, discount_percent: 10 }],
          },
        },
        {
          id: 6,
          name: "Five-asset offer",
          status: "active",
          metadata: {
            start_date: "2020-01-01",
            discount_tiers: [{ asset_count: 5, discount_percent: 15 }],
          },
        },
      ]}
      onApplyBundle={onApplyBundle}
    />);

    expect(screen.getByRole("button", { name: "Applied" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Not eligible" })).toBeDisabled();
    expect(screen.getByText(/add 2 more paid assets/i)).toBeInTheDocument();
  });
});
