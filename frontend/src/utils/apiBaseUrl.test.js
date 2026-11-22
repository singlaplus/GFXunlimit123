import { getApiBaseUrl } from "./apiBaseUrl";

describe("API base URL configuration", () => {
  test("keeps localhost as the explicit development and test fallback", () => {
    expect(getApiBaseUrl({ NODE_ENV: "development" }, null)).toBe("http://localhost:5000");
    expect(getApiBaseUrl({ NODE_ENV: "test" })).toBe("http://localhost:5000");
  });

  test("uses the frontend origin so the development proxy can reach the backend", () => {
    expect(getApiBaseUrl(
      { NODE_ENV: "development" },
      { origin: "http://192.168.1.25:3000", hostname: "192.168.1.25" }
    )).toBe("http://192.168.1.25:3000");
  });

  test("replaces a configured loopback API URL for remote browsers", () => {
    expect(getApiBaseUrl(
      { NODE_ENV: "development", REACT_APP_API_BASE_URL: "http://localhost:5000" },
      { origin: "http://192.168.1.25:3000", hostname: "192.168.1.25" }
    )).toBe("http://192.168.1.25:3000");
  });

  test("uses the browser origin for production builds served alongside the API", () => {
    expect(getApiBaseUrl(
      { NODE_ENV: "production" },
      { origin: "https://stocksite.example", hostname: "stocksite.example" }
    )).toBe("https://stocksite.example");
  });

  test("uses a configured URL and normalizes trailing slashes", () => {
    expect(getApiBaseUrl({
      NODE_ENV: "production",
      REACT_APP_API_BASE_URL: "https://api.example.test/v1/",
    })).toBe("https://api.example.test/v1");
  });

  test("rejects missing production and malformed or unsafe URLs", () => {
    expect(() => getApiBaseUrl({ NODE_ENV: "production" }, null))
      .toThrow("REACT_APP_API_BASE_URL must be configured for production builds.");
    for (const value of ["not a URL", "ftp://api.example.test", "https://user:pass@api.example.test", "https://api.example.test?debug=1"]) {
      expect(() => getApiBaseUrl({ NODE_ENV: "production", REACT_APP_API_BASE_URL: value }))
        .toThrow("REACT_APP_API_BASE_URL must be a valid HTTP(S) URL.");
    }
  });
});
