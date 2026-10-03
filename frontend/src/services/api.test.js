jest.mock("axios", () => {
  const get = jest.fn();
  return {
    __esModule: true,
    default: {
      create: jest.fn(() => ({
        get,
        post: jest.fn(),
        put: jest.fn(),
        interceptors: {
          request: { use: jest.fn() },
          response: { use: jest.fn() },
        },
      })),
    },
    mockGet: get,
  };
});

import { getSingleImage } from "./api";
const mockGet = jest.requireMock("axios").mockGet;

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
});
