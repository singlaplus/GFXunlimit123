import { fireEvent, render, screen } from "@testing-library/react";
import axios from "axios";
import MyDownloads from "./MyDownloads";

jest.mock("axios");
jest.mock("react-router-dom", () => ({
  useLocation: () => ({ pathname: "/downloads" }),
  useNavigate: () => jest.fn(),
}));

describe("MyDownloads", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    localStorage.setItem("token", "test-token");
  });

  it("waits for customer downloads and does not wait for optional legacy history", async () => {
    let resolvePrimary;
    let resolveLegacy;
    axios.get.mockImplementation((url) => {
      if (url.endsWith("/my-customer-downloads")) {
        return new Promise((resolve) => { resolvePrimary = resolve; });
      }
      if (url.endsWith("/downloads")) {
        return new Promise((resolve) => { resolveLegacy = resolve; });
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });

    render(<MyDownloads />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading downloads");
    expect(screen.queryByText("No downloads yet.")).not.toBeInTheDocument();
    expect(axios.get).toHaveBeenCalledTimes(1);

    resolvePrimary({ data: [] });
    expect(await screen.findByText("No downloads yet.")).toBeInTheDocument();
    expect(axios.get).toHaveBeenCalledTimes(2);
    resolveLegacy({ data: [] });
  });

  it("shows primary request failures, retries the primary loader, and accepts valid empty results", async () => {
    axios.get
      .mockRejectedValueOnce(new Error("Network Error"))
      .mockResolvedValueOnce({ data: [] })
      .mockRejectedValueOnce(new Error("Optional legacy history unavailable"));

    render(<MyDownloads />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Network Error");
    expect(screen.queryByText("No downloads yet.")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("No downloads yet.")).toBeInTheDocument();
    expect(axios.get.mock.calls.filter(([url]) => url.endsWith("/my-customer-downloads"))).toHaveLength(2);
  });

  it("rejects malformed primary responses instead of showing an empty state", async () => {
    axios.get.mockResolvedValueOnce({ data: { downloads: [] } });

    render(<MyDownloads />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Downloads response was invalid");
    expect(screen.queryByText("No downloads yet.")).not.toBeInTheDocument();
    expect(axios.get).toHaveBeenCalledTimes(1);
  });

  it("preserves login gating and pagination for customer download records", async () => {
    localStorage.removeItem("token");
    const { unmount } = render(<MyDownloads />);
    expect(await screen.findByText(/You must be logged in/)).toBeInTheDocument();
    expect(axios.get).not.toHaveBeenCalled();
    unmount();

    localStorage.setItem("token", "test-token");
    axios.get.mockImplementation((url) => (
      url.endsWith("/my-customer-downloads")
        ? Promise.resolve({
          data: Array.from({ length: 21 }, (_, index) => ({
            id: index + 1,
            image_id: index + 1,
            title: `Download ${index + 1}`,
            is_active: false,
          })),
        })
        : Promise.resolve({ data: [] })
    ));
    render(<MyDownloads />);

    expect(await screen.findByText("Download 1")).toBeInTheDocument();
    expect(screen.queryByText("Download 21")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(await screen.findByText("Download 21")).toBeInTheDocument();
    expect(axios.get.mock.calls.filter(([url]) => url.endsWith("/my-customer-downloads"))).toHaveLength(1);
  });
});
