import { act, render, screen, waitFor } from "@testing-library/react";
import axios from "axios";
import Profile, { formatAccountCreatedDate, formatAccountAge } from "./Profile";
import { useStartupReadiness } from "../startup/StartupReadinessProvider";

jest.mock("axios");
jest.mock("./AdminPanel", () => () => null);
jest.mock("../startup/StartupReadinessProvider", () => ({
  useStartupReadiness: jest.fn(),
}));

describe("account age formatting", () => {
  it("formats the creation date and age from calendar dates", () => {
    expect(formatAccountCreatedDate("2024-02-10T00:00:00.000Z")).toBe("10 Feb 2024");
    expect(formatAccountAge(
      "2024-02-10T00:00:00.000Z",
      new Date("2026-11-24T00:00:00.000Z")
    )).toBe("2 years, 9 months");
  });

  it("handles missing and future creation dates safely", () => {
    expect(formatAccountCreatedDate(null)).toBe("Unavailable");
    expect(formatAccountAge(
      "2027-01-01T00:00:00.000Z",
      new Date("2026-11-24T00:00:00.000Z")
    )).toBe("Unavailable");
  });
});

describe("Profile startup readiness", () => {
  const reportResource = jest.fn();
  let retryKey;
  let resolveProfile;
  let resolveStats;

  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    retryKey = 0;
    useStartupReadiness.mockImplementation(() => ({
      reportResource,
      retryKey,
      routeId: "profile-route",
    }));
    axios.get.mockImplementation((url) => new Promise((resolve) => {
      if (url.endsWith("/profile/stats")) resolveStats = resolve;
      else resolveProfile = resolve;
    }));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("waits for the existing profile and contributor stats requests before reporting readiness", async () => {
    render(<Profile />);

    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(reportResource).toHaveBeenCalledWith("profile", "loading", "", "profile-route");
    expect(axios.get).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/Credits:/)).not.toBeInTheDocument();

    await act(async () => {
      resolveProfile({
        data: { id: 8, username: "contributor", email: "user@example.com", role: "contributor", credits: 0 },
      });
      resolveStats({
        data: {
          approved_images: 0,
          pending_images: 0,
          rejected_images: 0,
          top_downloads: 0,
          top_views: 0,
          top_likes: 0,
          total_uploads: 0,
          total_likes: 0,
          total_views: 0,
          total_downloads: 0,
          total_earnings: 0,
        },
      });
    });

    await waitFor(() => {
      expect(reportResource).toHaveBeenLastCalledWith("profile", "ready", "", "profile-route");
    });
    expect(screen.getByText(/Credits:/)).toBeInTheDocument();
    expect(axios.get).toHaveBeenCalledTimes(2);
  });

  it("reports contributor stats failure and reloads only the existing GET requests on retry", async () => {
    axios.get.mockImplementationOnce(() => Promise.resolve({
      data: { id: 8, username: "contributor", email: "user@example.com", role: "contributor", credits: 12 },
    }));
    axios.get.mockImplementationOnce(() => Promise.reject(new Error("Stats unavailable")));

    const view = render(<Profile />);
    await waitFor(() => {
      expect(reportResource).toHaveBeenLastCalledWith(
        "profile",
        "error",
        "Unable to load your profile. Please retry.",
        "profile-route"
      );
    });

    axios.get.mockImplementation((url) => Promise.resolve({
      data: url.endsWith("/profile/stats")
        ? {
            total_uploads: 0,
            approved_images: 0,
            pending_images: 0,
            rejected_images: 0,
            total_likes: 0,
            total_views: 0,
            total_downloads: 0,
            total_earnings: 0,
            top_downloads: 0,
            top_views: 0,
            top_likes: 0,
          }
        : { id: 8, username: "contributor", email: "user@example.com", role: "contributor", credits: 12 },
    }));
    retryKey = 1;
    view.rerender(<Profile />);

    await waitFor(() => {
      expect(reportResource).toHaveBeenLastCalledWith("profile", "ready", "", "profile-route");
    });
    expect(axios.get).toHaveBeenCalledTimes(4);
  });

  it("automatically retries transient profile failures until the request succeeds", async () => {
    jest.useFakeTimers();
    let profileAttempts = 0;
    axios.get.mockImplementation((url) => {
      if (url.endsWith("/profile/stats")) {
        return Promise.resolve({
          data: {
            approved_images: 0,
            pending_images: 0,
            rejected_images: 0,
            top_downloads: 0,
            top_views: 0,
            top_likes: 0,
            total_uploads: 0,
            total_likes: 0,
            total_views: 0,
            total_downloads: 0,
            total_earnings: 0,
          },
        });
      }

      profileAttempts += 1;
      if (profileAttempts === 1) {
        return Promise.reject(Object.assign(new Error("Network Error"), { code: "ERR_NETWORK" }));
      }
      return Promise.resolve({
        data: { id: 8, username: "customer", email: "user@example.com", role: "customer", credits: 12 },
      });
    });

    render(<Profile />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(reportResource).toHaveBeenLastCalledWith(
      "profile",
      "error",
      "Unable to load your profile. Please retry.",
      "profile-route"
    );
    expect(profileAttempts).toBe(1);

    await act(async () => {
      jest.advanceTimersByTime(1000);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(reportResource).toHaveBeenLastCalledWith("profile", "ready", "", "profile-route");
    expect(screen.getByText("User Profile")).toBeInTheDocument();
    expect(profileAttempts).toBe(2);
  });

  it("does not automatically retry profile authorization failures", async () => {
    jest.useFakeTimers();
    axios.get.mockRejectedValue({ response: { status: 401 } });

    render(<Profile />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(reportResource).toHaveBeenLastCalledWith(
      "profile",
      "error",
      "Unable to load your profile. Please retry.",
      "profile-route"
    );
    expect(axios.get).toHaveBeenCalledTimes(2);

    act(() => jest.advanceTimersByTime(30000));
    expect(axios.get).toHaveBeenCalledTimes(2);
  });
});
