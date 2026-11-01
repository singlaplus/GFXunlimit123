jest.mock("axios", () => {
  const get = jest.fn();
  const responseHandlers = [];
  return {
    __esModule: true,
    default: {
      create: jest.fn(() => ({
        get,
        post: jest.fn(),
        put: jest.fn(),
        interceptors: {
          request: { use: jest.fn() },
          response: { use: (onSuccess, onError) => responseHandlers.push({ onSuccess, onError }) },
        },
      })),
    },
    mockGet: get,
    mockResponseHandlers: responseHandlers,
  };
});

import { getSingleImage } from "./api";
const mockGet = jest.requireMock("axios").mockGet;
const mockResponseHandlers = jest.requireMock("axios").mockResponseHandlers;

describe("getSingleImage", () => {
  beforeEach(() => {
    localStorage.clear();
    mockGet.mockClear();
  });

  it("includes the active session token for private asset details", () => {
    localStorage.setItem("token", "test-session-token");

    getSingleImage(208);

    expect(mockGet).toHaveBeenCalledWith("/images/208", {
      headers: { Authorization: "Bearer test-session-token" },
    });
  });

  it("does not add an authorization header for logged-out public asset details", () => {
    getSingleImage(196);

    expect(mockGet).toHaveBeenCalledWith("/images/196", { headers: {} });
  });

  it("keeps network errors rejected instead of converting them to empty responses", async () => {
    const networkError = Object.assign(new Error("Network Error"), { code: "ERR_NETWORK" });
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

    await expect(mockResponseHandlers[0].onError(networkError)).rejects.toBe(networkError);

    warn.mockRestore();
  });
});
