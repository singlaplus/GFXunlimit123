import { render, screen, waitFor } from "@testing-library/react";
import axios from "axios";
import AdminContributorsPage from "./AdminContributorsPage";
import { useStartupReadiness } from "../startup/StartupReadinessProvider";

jest.mock("axios");
jest.mock("../startup/StartupReadinessProvider", () => ({
  useStartupReadiness: jest.fn(),
}));

describe("AdminContributorsPage startup readiness", () => {
  const reportResource = jest.fn();
  let retryKey;

  beforeEach(() => {
    jest.clearAllMocks();
    retryKey = 0;
    useStartupReadiness.mockImplementation(() => ({
      reportResource,
      retryKey,
      routeId: "admin-contributors-route",
    }));
    axios.get.mockResolvedValue({ data: [] });
  });

  it("treats a valid empty response as ready", async () => {
    render(<AdminContributorsPage />);

    await waitFor(() => {
      expect(reportResource).toHaveBeenCalledWith(
        "adminContributors",
        "ready",
        "",
        "admin-contributors-route"
      );
    });
    expect(screen.getByText("No contributors found.")).toBeInTheDocument();
  });

  it("rejects malformed responses and retries the existing GET", async () => {
    axios.get.mockResolvedValueOnce({ data: { users: [] } });
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
    const view = render(<AdminContributorsPage />);

    await waitFor(() => {
      expect(reportResource).toHaveBeenCalledWith(
        "adminContributors",
        "error",
        "Unable to load contributors. Please retry.",
        "admin-contributors-route"
      );
    });
    expect(screen.queryByText("No contributors found.")).not.toBeInTheDocument();

    axios.get.mockResolvedValueOnce({ data: [] });
    retryKey = 1;
    view.rerender(<AdminContributorsPage />);
    await waitFor(() => {
      expect(reportResource).toHaveBeenCalledWith(
        "adminContributors",
        "ready",
        "",
        "admin-contributors-route"
      );
    });
    expect(axios.get).toHaveBeenCalledTimes(2);
    consoleError.mockRestore();
  });
});
