import axios from "axios";
import { loadCartItems, saveCartItems } from "./cartPersistence";

jest.mock("axios");

describe("loadCartItems strict readiness mode", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
  });

  it("accepts a valid empty local cart", async () => {
    await expect(loadCartItems({ strict: true })).resolves.toEqual([]);
  });

  it("rejects malformed local cart data only in strict mode", async () => {
    localStorage.setItem("customer-cart", "{bad json");
    await expect(loadCartItems({ strict: true })).rejects.toThrow();
    await expect(loadCartItems()).resolves.toEqual([]);
  });

  it("does not convert malformed or failed server responses to empty success in strict mode", async () => {
    localStorage.setItem("token", "session-token");
    localStorage.setItem("customer-cart", JSON.stringify([{ id: 1 }]));
    axios.get.mockResolvedValueOnce({ data: { items: {} } });
    await expect(loadCartItems({ strict: true })).rejects.toThrow("Cart response was invalid.");

    axios.get.mockRejectedValueOnce(new Error("Network Error"));
    await expect(loadCartItems({ strict: true })).rejects.toThrow("Network Error");
    await expect(loadCartItems()).resolves.toEqual([{ id: 1 }]);
  });

  it("reports failed server cart saves in strict mode without changing the existing fallback", async () => {
    localStorage.setItem("token", "session-token");
    axios.post.mockRejectedValueOnce(new Error("Network Error"));
    await expect(saveCartItems([{ id: 1 }], { strict: true })).rejects.toThrow("Network Error");
    expect(JSON.parse(localStorage.getItem("customer-cart"))).toEqual([{ id: 1 }]);

    axios.post.mockRejectedValueOnce(new Error("Network Error"));
    await expect(saveCartItems([{ id: 2 }])).resolves.toBe(true);
  });
});
