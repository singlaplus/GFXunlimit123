import { getApiBaseUrl } from "./apiBaseUrl";

describe("API base URL configuration", () => {
  test("keeps localhost as the explicit development and test fallback", () => {
    expect(getApiBaseUrl({ NODE_ENV: "development" })).toBe("http://localhost:5000");
    expect(getApiBaseUrl({ NODE_ENV: "test" })).toBe("http://localhost:5000");
  });

  test("uses a configured URL and normalizes trailing slashes", () => {
    expect(getApiBaseUrl({
      NODE_ENV: "production",
      REACT_APP_API_BASE_URL: "https://api.example.test/v1/",
    })).toBe("https://api.example.test/v1");
  });

  test("rejects missing production and malformed or unsafe URLs", () => {
    expect(() => getApiBaseUrl({ NODE_ENV: "production" }))
      .toThrow("REACT_APP_API_BASE_URL must be configured for production builds.");
    for (const value of ["not a URL", "ftp://api.example.test", "https://user:pass@api.example.test", "https://api.example.test?debug=1"]) {
      expect(() => getApiBaseUrl({ NODE_ENV: "production", REACT_APP_API_BASE_URL: value }))
        .toThrow("REACT_APP_API_BASE_URL must be a valid HTTP(S) URL.");
    }
  });
});
