import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import axios from "axios";
import { getSingleImage } from "../services/api";
import { getRelatedImages, viewImageRequest } from "../services/imageService";
import AssetPage from "./AssetPage";
import { StartupReadinessProvider } from "../startup/StartupReadinessProvider";

jest.mock("react-router-dom", () => ({
  useLocation: () => ({ pathname: "/asset/example-42", search: "", key: "asset-test" }),
  useNavigate: () => jest.fn(),
}));

jest.mock("axios");
jest.mock("../components/AssetWatermark", () => ({
  __esModule: true,
  default: ({ width, height }) => (
    <div data-testid="asset-watermark" data-width={width} data-height={height} />
  ),
}));
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
      if (url.includes("/video-previews")) {
        return Promise.resolve({
          status: 200,
          data: {
            frames: [{ index: 1, timestamp: 2.5, url: "/api/assets/42/video-previews/frame/1" }],
            optimizedVideo: { url: "/api/assets/42/video-previews/optimized" },
          },
        });
      }
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
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Asset not found.")).toBeInTheDocument();
    await waitFor(() => expect(getSingleImage).toHaveBeenCalledTimes(2));
    expect(viewImageRequest).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });

  it("switches between the optimized public video and generated thumbnail frames", async () => {
    getRelatedImages.mockResolvedValue({ data: [] });
    getSingleImage.mockResolvedValue({
      status: 200,
      data: { id: 42, filename: "clip.mp4", status: "approved", title: "Video clip" },
    });
    const { container } = render(
      <StartupReadinessProvider>
        <AssetPage imageId="42" darkMode={false} />
      </StartupReadinessProvider>
    );

    const video = await waitFor(() => {
      const element = container.querySelector('video[aria-label="Video clip video preview"]');
      expect(element).toHaveAttribute("src", expect.stringContaining("/api/assets/42/video-previews/optimized"));
      return element;
    });
    expect(container.querySelectorAll('[data-testid="asset-watermark"]')).toHaveLength(1);
    expect(video).toHaveAttribute(
      "controlslist",
      "nodownload nofullscreen noremoteplayback noplaybackrate"
    );
    expect(video).toHaveAttribute("disablepictureinpicture");
    expect(video).toHaveAttribute("disableremoteplayback");
    expect(video).toHaveAttribute("poster", expect.stringContaining("/api/assets/42/video-previews/frame/1"));
    const play = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(video, "play", { configurable: true, value: play });
    fireEvent.click(container.querySelector(".asset-video-play-overlay"));
    expect(play).toHaveBeenCalledTimes(1);
    fireEvent.play(video);
    expect(container.querySelector(".asset-video-play-overlay")).not.toBeInTheDocument();
    fireEvent.pause(video);
    expect(container.querySelector(".asset-video-play-overlay")).toBeInTheDocument();

    const previewOptions = container.querySelector('[aria-label="Video preview options"]');
    expect(previewOptions).toBeInTheDocument();
    expect(previewOptions.querySelector('[data-testid="asset-watermark"]')).not.toBeInTheDocument();
    const videoOption = previewOptions.querySelector('button[aria-label="Generated video preview"]');
    const frameOption = previewOptions.querySelector('[aria-label="Preview thumbnail at 2.5 seconds"]');
    expect(videoOption.querySelector("video")).toHaveAttribute(
      "src",
      expect.stringContaining("/api/assets/42/video-previews/optimized")
    );
    expect(container.querySelector('img[alt="Video frame at 2.5 seconds"]')).toHaveAttribute(
      "src",
      expect.stringContaining("/api/assets/42/video-previews/frame/1")
    );
    expect(container.querySelector('[aria-label^="Remove "]')).not.toBeInTheDocument();
    expect(videoOption).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(frameOption);
    expect(container.querySelector('video[aria-label="Video clip video preview"]')).not.toBeInTheDocument();
    expect(container.querySelector('img[alt="Video clip"]')).toHaveAttribute(
      "src",
      expect.stringContaining("/api/assets/42/video-previews/frame/1")
    );
    expect(container.querySelectorAll('[data-testid="asset-watermark"]')).toHaveLength(1);
    fireEvent.click(videoOption);
    expect(container.querySelector('video[aria-label="Video clip video preview"]')).toHaveAttribute(
      "src",
      expect.stringContaining("/api/assets/42/video-previews/optimized")
    );
  });

  it("loads private pending-video previews with authentication and offers both generated choices", async () => {
    localStorage.setItem("token", "admin-token");
    getRelatedImages.mockResolvedValue({ data: [] });
    getSingleImage.mockResolvedValue({
      status: 200,
      data: { id: 42, filename: "clip.mov", status: "pending", title: "Pending video" },
    });
    const defaultGet = axios.get.getMockImplementation();
    axios.get.mockImplementation((url, config = {}) => {
      if (url.endsWith("/me")) {
        return Promise.resolve({ status: 200, data: { id: 1, role: "admin" } });
      }
      if (url.endsWith("/favorites")) {
        return Promise.resolve({ status: 200, data: [] });
      }
      if (url.endsWith("/video-previews")) {
        return Promise.resolve({
          status: 200,
          data: {
            frames: [{ index: 1, timestamp: 2.5, url: "/api/assets/42/video-previews/frame/1" }],
            optimizedVideo: { url: "/api/assets/42/video-previews/optimized" },
          },
        });
      }
      if (url.endsWith("/video-previews/frame/1") || url.endsWith("/video-previews/optimized")) {
        const type = url.endsWith("/optimized") ? "video/mp4" : "image/webp";
        return Promise.resolve({ status: 200, data: new Blob([url], { type }) });
      }
      return defaultGet(url, config);
    });
    const createObjectURLDescriptor = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
    const revokeObjectURLDescriptor = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: jest.fn((blob) => blob.type === "video/mp4" ? "blob:generated-video" : "blob:generated-frame"),
    });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: jest.fn() });

    let unmount;
    try {
      const rendered = render(
        <StartupReadinessProvider>
          <AssetPage imageId="42" darkMode={false} />
        </StartupReadinessProvider>
      );
      const { container } = rendered;
      unmount = rendered.unmount;

      await waitFor(() => {
        expect(container.querySelector('video[aria-label="Pending video video preview"]')).toHaveAttribute(
          "src",
          "blob:generated-video"
        );
        expect(container.querySelector('[aria-label="Preview thumbnail at 2.5 seconds"]')).toBeInTheDocument();
      });
      expect(container.querySelector('[data-testid="asset-watermark"]')).not.toBeInTheDocument();
      expect(container.querySelector('[aria-label="Remove generated video preview"]')).toBeInTheDocument();
      expect(container.querySelector('[aria-label="Remove thumbnail at 2.5 seconds"]')).toBeInTheDocument();
      expect(axios.get).toHaveBeenCalledWith(
        expect.stringContaining("/api/assets/42/video-previews/frame/1"),
        expect.objectContaining({
          headers: { Authorization: "Bearer admin-token" },
          responseType: "blob",
        })
      );
      expect(axios.get).toHaveBeenCalledWith(
        expect.stringContaining("/api/assets/42/video-previews/optimized"),
        expect.objectContaining({
          headers: { Authorization: "Bearer admin-token" },
          responseType: "blob",
        })
      );
      expect(container.querySelector(
        '[aria-label="Video preview options"] button[aria-label="Generated video preview"] video'
      )).toHaveAttribute("src", "blob:generated-video");
    } finally {
      unmount?.();
      if (createObjectURLDescriptor) {
        Object.defineProperty(URL, "createObjectURL", createObjectURLDescriptor);
      } else {
        delete URL.createObjectURL;
      }
      if (revokeObjectURLDescriptor) {
        Object.defineProperty(URL, "revokeObjectURL", revokeObjectURLDescriptor);
      } else {
        delete URL.revokeObjectURL;
      }
    }
  });

  it("keeps preview choices hidden when a video has no generated previews", async () => {
    getRelatedImages.mockResolvedValue({ data: [] });
    getSingleImage.mockResolvedValue({
      status: 200,
      data: { id: 42, filename: "clip.mp4", status: "approved", title: "Video clip" },
    });
    const defaultGet = axios.get.getMockImplementation();
    axios.get.mockImplementation((url, config) => {
      if (url.endsWith("/video-previews")) {
        return Promise.resolve({
          status: 200,
          data: { frames: [], optimizedVideo: null, originalVideoUrl: "" },
        });
      }
      return defaultGet(url, config);
    });
    const { container } = render(
      <StartupReadinessProvider>
        <AssetPage imageId="42" darkMode={false} />
      </StartupReadinessProvider>
    );

    await waitFor(() => {
      expect(axios.get).toHaveBeenCalledWith(
        expect.stringContaining("/api/assets/42/video-previews"),
        expect.anything()
      );
    });
    expect(container.querySelector("video")).toBeInTheDocument();
    expect(container.querySelector('[aria-label="Video preview options"]')).not.toBeInTheDocument();
  });

  it("lets only an authenticated admin delete generated thumbnails and video previews", async () => {
    localStorage.setItem("token", "admin-token");
    let frameExists = true;
    let optimizedVideoExists = true;
    getRelatedImages.mockResolvedValue({ data: [] });
    getSingleImage.mockResolvedValue({
      status: 200,
      data: { id: 42, filename: "clip.mp4", status: "approved", title: "Video clip" },
    });
    const defaultGet = axios.get.getMockImplementation();
    axios.get.mockImplementation((url, config) => {
      if (url.endsWith("/me")) {
        return Promise.resolve({ status: 200, data: { id: 1, role: "admin" } });
      }
      if (url.endsWith("/favorites")) {
        return Promise.resolve({ status: 200, data: [] });
      }
      if (url.endsWith("/video-previews")) {
        return Promise.resolve({
          status: 200,
          data: {
            frames: frameExists
              ? [{ index: 1, timestamp: 2.5, url: "/api/assets/42/video-previews/frame/1" }]
              : [],
            optimizedVideo: optimizedVideoExists
              ? { url: "/api/assets/42/video-previews/optimized" }
              : null,
            originalVideoUrl: "/api/images/42?original=true",
          },
        });
      }
      return defaultGet(url, config);
    });
    axios.delete.mockImplementation((url) => {
      if (url.endsWith("/frame/1")) frameExists = false;
      if (url.endsWith("/optimized")) optimizedVideoExists = false;
      return Promise.resolve({ status: 200, data: { deleted: true } });
    });

    const { container } = render(
      <StartupReadinessProvider>
        <AssetPage imageId="42" darkMode={false} />
      </StartupReadinessProvider>
    );

    const removeFrame = await waitFor(() => {
      const button = container.querySelector('[aria-label="Remove thumbnail at 2.5 seconds"]');
      expect(button).toBeInTheDocument();
      return button;
    });
    fireEvent.click(removeFrame);
    await waitFor(() => {
      expect(axios.delete).toHaveBeenCalledWith(
        expect.stringContaining("/api/assets/42/video-previews/frame/1"),
        expect.objectContaining({ headers: { Authorization: "Bearer admin-token" } })
      );
      expect(container.querySelector('[aria-label="Remove thumbnail at 2.5 seconds"]')).not.toBeInTheDocument();
    });

    const removeVideo = container.querySelector('[aria-label="Remove generated video preview"]');
    expect(removeVideo).toBeInTheDocument();
    fireEvent.click(removeVideo);
    await waitFor(() => {
      expect(axios.delete).toHaveBeenCalledWith(
        expect.stringContaining("/api/assets/42/video-previews/optimized"),
        expect.objectContaining({ headers: { Authorization: "Bearer admin-token" } })
      );
      expect(container.querySelector('[aria-label="Remove generated video preview"]')).not.toBeInTheDocument();
    });
  });
});
