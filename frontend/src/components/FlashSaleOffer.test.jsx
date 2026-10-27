import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import axios from "axios";
import FlashSaleOffer from "./FlashSaleOffer";

jest.mock("axios");

describe("FlashSaleOffer", () => {
  beforeEach(() => {
    localStorage.removeItem("appliedFlashSale");
    axios.get.mockResolvedValue({
      data: {
        sales: [{
          id: 12,
          name: "Buy One Get Two",
          discount_rule: "BOG2",
          featured_placement: "homepage",
          metadata: {}
        }],
        categories: [],
        collections: []
      }
    });
  });

  it("automatically applies the best eligible BOG2 assets and allows manual removal", async () => {
    const onChange = jest.fn();
    const items = [
      { id: 1, title: "Asset One", unitPrice: 100 },
      { id: 2, title: "Asset Two", unitPrice: 50 },
      { id: 3, title: "Asset Three", unitPrice: 25 },
      { id: 4, title: "Asset Four", unitPrice: 10 }
    ];

    render(<FlashSaleOffer items={items} subscriptionRestricted={false} onChange={onChange} variant="cart" />);

    expect(await screen.findByText("Buy one, get two")).toBeInTheDocument();
    expect(await screen.findByText("Flash Sale BOG2 applied")).toBeInTheDocument();
    expect(screen.getByText("APPLIED")).toBeInTheDocument();
    await waitFor(() => {
      expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
        sale: expect.objectContaining({ id: 12 }),
        selectedAssetIds: ["1", "2", "3"],
        discount: 75
      }));
    });
    await waitFor(() => expect(screen.getByText("Charged")).toBeInTheDocument());
    expect(screen.getAllByText("Free")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Remove Flash Sale" }));
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(null));
    expect(JSON.parse(localStorage.getItem("appliedFlashSale"))).toEqual({
      dismissedForCartSignature: "1,2,3,4"
    });

    expect(screen.getByText("Flash Sale Available")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Apply now" }));
    await waitFor(() => {
      expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
        sale: expect.objectContaining({ id: 12 }),
        selectedAssetIds: ["1", "2", "3"],
        discount: 75
      }));
    });
    expect(await screen.findByText("Flash Sale BOG2 applied")).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("appliedFlashSale"))).toEqual({
      saleId: 12,
      selectedAssetIds: ["1", "2", "3"]
    });
  });

  it("shows a premium applied summary for percentage discounts in the cart", async () => {
    axios.get.mockResolvedValueOnce({
      data: {
        sales: [{
          id: 13,
          name: "Weekend Sale",
          discount_rule: "percentage",
          featured_placement: "homepage",
          metadata: { discount_value: 10 }
        }],
        categories: [],
        collections: []
      }
    });

    render(
      <FlashSaleOffer
        items={[{ id: 1, title: "Asset One", unitPrice: 100 }]}
        subscriptionRestricted={false}
        onChange={jest.fn()}
        variant="cart"
        currency="USD"
      />
    );

    expect(await screen.findByText("Flash Sale discount applied")).toBeInTheDocument();
    expect(screen.getByText("10% off eligible assets")).toBeInTheDocument();
    expect(screen.getByText("-$10.00")).toBeInTheDocument();
    expect(screen.getByLabelText("Flash Sale")).toHaveClass("flash-sale-cart-card");
  });

  it("uses premium styling when the selected BOGO assets no longer match the cart", async () => {
    const items = [
      { id: 1, title: "Asset One", unitPrice: 100 },
      { id: 2, title: "Asset Two", unitPrice: 50 },
      { id: 3, title: "Asset Three", unitPrice: 25 },
      { id: 4, title: "Asset Four", unitPrice: 10 }
    ];
    const { rerender } = render(
      <FlashSaleOffer items={items} subscriptionRestricted={false} onChange={jest.fn()} variant="cart" />
    );

    expect(await screen.findByText("Flash Sale BOG2 applied")).toBeInTheDocument();
    rerender(
      <FlashSaleOffer
        items={items.filter((item) => item.id !== 3)}
        subscriptionRestricted={false}
        onChange={jest.fn()}
        variant="cart"
      />
    );

    const dialog = await screen.findByRole("dialog", { name: "Your selection has changed" });
    expect(dialog).toHaveClass("flash-sale-dialog-backdrop");
    expect(screen.getByText("FLASH SALE UPDATE")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Remove Flash Sale" })).toHaveClass("flash-sale-dialog-remove");
    expect(within(dialog).getByRole("button", { name: "Choose assets" })).toHaveClass("flash-sale-dialog-choose");
  });

  it("does not apply BOG5 until the cart meets its six-asset requirement after removal", async () => {
    axios.get.mockResolvedValueOnce({
      data: {
        sales: [{
          id: 16,
          name: "Buy One Get Five",
          discount_rule: "BOG5",
          featured_placement: "homepage",
          metadata: {}
        }],
        categories: [],
        collections: []
      }
    });
    const items = Array.from({ length: 6 }, (_, index) => ({
      id: index + 1,
      title: `Asset ${index + 1}`,
      unitPrice: 100 - index * 10
    }));
    const onChange = jest.fn();
    const { rerender } = render(
      <FlashSaleOffer items={items} subscriptionRestricted={false} onChange={onChange} variant="cart" />
    );

    expect(await screen.findByText("Flash Sale BOG5 applied")).toBeInTheDocument();
    rerender(
      <FlashSaleOffer items={items.slice(0, 5)} subscriptionRestricted={false} onChange={onChange} variant="cart" />
    );
    const changedSelectionDialog = await screen.findByRole("dialog", { name: "Your selection has changed" });
    fireEvent.click(within(changedSelectionDialog).getByRole("button", { name: "Remove Flash Sale" }));

    const availableCard = await screen.findByLabelText("Flash Sale Available");
    expect(availableCard).toHaveTextContent("Add 1 more eligible asset to your cart (6 total) to unlock BOG5.");
    expect(within(availableCard).queryByRole("button", { name: "Apply now" })).not.toBeInTheDocument();
    expect(onChange).toHaveBeenLastCalledWith(null);

    rerender(<FlashSaleOffer items={items} subscriptionRestricted={false} onChange={onChange} variant="cart" />);
    expect(await screen.findByText("Flash Sale BOG5 applied")).toBeInTheDocument();
    await waitFor(() => {
      expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
        sale: expect.objectContaining({ id: 16 }),
        selectedAssetIds: ["1", "2", "3", "4", "5", "6"],
        discount: 350
      }));
    });
  });

  it("tells customers how many more eligible assets to add for a BOGO offer", async () => {
    axios.get.mockResolvedValueOnce({
      data: {
        sales: [{
          id: 15,
          name: "Buy One Get One",
          discount_rule: "BOGO",
          featured_placement: "homepage",
          metadata: {}
        }],
        categories: [],
        collections: []
      }
    });

    const onChange = jest.fn();
    const { rerender } = render(
      <FlashSaleOffer
        items={[{ id: 1, title: "Asset One", unitPrice: 100 }]}
        subscriptionRestricted={false}
        onChange={onChange}
        variant="cart"
      />
    );

    const availableOffer = await screen.findByLabelText("Flash Sale Available");
    expect(availableOffer).toHaveTextContent("Flash Sale BOGO available");
    expect(availableOffer).toHaveTextContent("Add 1 more eligible asset to your cart (2 total) to unlock BOGO.");

    rerender(
      <FlashSaleOffer
        items={[
          { id: 1, title: "Asset One", unitPrice: 100 },
          { id: 2, title: "Asset Two", unitPrice: 50 }
        ]}
        subscriptionRestricted={false}
        onChange={onChange}
        variant="cart"
      />
    );
    await waitFor(() => {
      expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
        sale: expect.objectContaining({ id: 15 }),
        selectedAssetIds: ["1", "2"],
        discount: 50
      }));
    });
  });

  it("shows the applied amount for fixed-amount cart discounts", async () => {
    axios.get.mockResolvedValueOnce({
      data: {
        sales: [{
          id: 14,
          name: "Fixed Sale",
          discount_rule: "fixed_amount",
          featured_placement: "homepage",
          metadata: { discount_value: 25 }
        }],
        categories: [],
        collections: []
      }
    });

    render(
      <FlashSaleOffer
        items={[{ id: 1, title: "Asset One", unitPrice: 100 }]}
        subscriptionRestricted={false}
        onChange={jest.fn()}
        variant="cart"
        currency="USD"
      />
    );

    expect(await screen.findByText("Flash Sale discount applied")).toBeInTheDocument();
    expect(screen.getByText("Fixed amount off eligible assets")).toBeInTheDocument();
    expect(screen.getByText("-$25.00")).toBeInTheDocument();
  });

  it("does not display Flash Sales to a subscription-restricted customer", () => {
    render(<FlashSaleOffer items={[{ id: 1, unitPrice: 100 }]} subscriptionRestricted onChange={jest.fn()} />);

    expect(screen.queryByLabelText("Flash Sale")).not.toBeInTheDocument();
  });
});
