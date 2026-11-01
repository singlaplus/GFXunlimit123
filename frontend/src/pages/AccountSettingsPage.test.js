import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import axios from "axios";
import AccountSettingsPage from "./AccountSettingsPage";

jest.mock("axios");

describe("AccountSettingsPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    localStorage.setItem("token", "test-token");
  });

  it("waits for profile and statistics before showing account values", async () => {
    let resolveProfile;
    let resolveStats;
    axios.get.mockImplementation((url) => new Promise((resolve) => {
      if (url.endsWith("/profile/stats")) resolveStats = resolve;
      else resolveProfile = resolve;
    }));

    render(<AccountSettingsPage username="contributor" />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading account settings");
    expect(screen.queryByRole("button", { name: "Save settings" })).not.toBeInTheDocument();
    expect(axios.get).toHaveBeenCalledTimes(2);

    resolveProfile({ data: { id: 12, email: "", username: "contributor" } });
    resolveStats({ data: { total_uploads: "0" } });

    expect(await screen.findByRole("button", { name: "Save settings" })).toBeInTheDocument();
    expect(screen.getByText("0 assets uploaded")).toBeInTheDocument();
    expect(screen.getByLabelText("Email address")).toHaveValue("");
    expect(axios.get).toHaveBeenCalledTimes(2);
  });

  it("shows a visible error and retries the existing profile and stats loaders", async () => {
    axios.get
      .mockRejectedValueOnce({ response: { status: 503 } })
      .mockResolvedValueOnce({ data: { total_uploads: 3 } })
      .mockResolvedValueOnce({ data: { id: 12, email: "user@example.com", username: "contributor" } })
      .mockResolvedValueOnce({ data: { total_uploads: 3 } });

    render(<AccountSettingsPage username="contributor" />);

    expect(await screen.findByRole("alert")).toHaveTextContent("HTTP 503");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByRole("button", { name: "Save settings" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("user@example.com")).toBeInTheDocument();
    expect(axios.get).toHaveBeenCalledTimes(4);
  });

  it("does not accept malformed statistics as successful zero values", async () => {
    axios.get.mockImplementation((url) => (
      url.endsWith("/profile/stats")
        ? Promise.resolve({ data: {} })
        : Promise.resolve({ data: { id: 12, email: "user@example.com", username: "contributor" } })
    ));

    render(<AccountSettingsPage username="contributor" />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Account settings data was invalid");
    expect(screen.queryByText("0 assets uploaded")).not.toBeInTheDocument();
    await waitFor(() => expect(axios.get).toHaveBeenCalledTimes(2));
  });
});
