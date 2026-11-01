import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import axios from "axios";
import { getSingleImage } from "../services/api";
import { viewImageRequest } from "../services/imageService";
import AssetPage from "./AssetPage";
import { StartupReadinessProvider } from "../startup/StartupReadinessProvider";

jest.mock("react-router-dom", () => ({
  useLocation: () => ({ pathname: "/asset/example-42", search: "", key: "asset-test" }),
  useNavigate: () => jest.fn(),
}));

jest.mock("axios");
jest.mock("../services/api", () => ({
  getSingleImage: jest.fn(),
}));
jest.mock("../services/imageService", () => ({
  getRelatedImages: jest.fn(),
  likeImageRequest: jest.fn(),
  viewImageRequest: jest.fn(),
  addFavoriteRequest: jest.fn(),
}));

describe("AssetPage startup readiness", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    axios.get.mockImplementation((url) => {
      if (url.endsWith("/health")) {
        return Promise.resolve({ status: 200, data: [{ now: "2026-11-01T12:00:00.000Z" }] });
      }
      if (url.endsWith("/me")) return Promise.reject({ response: { status: 401 } });
      return Promise.resolve({ status: 200, data: {} });
    });
    viewImageRequest.mockResolvedValue({});
  });

  it("retries asset details without repeating the side-effecting view request", async () => {
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
    getSingleImage
      .mockRejectedValueOnce(new Error("Asset endpoint unavailable"))
      .mockResolvedValueOnce({ status: 200, data: {} });

    render(
      <StartupReadinessProvider>
        <AssetPage imageId="42" darkMode={false} />
      </StartupReadinessProvider>
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load this asset");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("Asset not found.")).toBeInTheDocument();
    await waitFor(() => expect(getSingleImage).toHaveBeenCalledTimes(2));
    expect(viewImageRequest).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });
});
