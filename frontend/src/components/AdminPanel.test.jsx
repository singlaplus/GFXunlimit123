import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import AdminPanel from "./AdminPanel";
import { buildAnimatedCountSteps, getAnimatedCountDuration, getAnimatedCountIncrement, renderTaxFormTemplate } from "./AdminPanel";
import { useLocation } from "react-router-dom";
import axios from "axios";
import { toast } from "react-toastify";
import { useStartupReadiness } from "../startup/StartupReadinessProvider";

const mockReportResource = jest.fn();

jest.mock("react-router-dom", () => ({
  useLocation: jest.fn()
}), { virtual: true });

jest.mock("axios");

jest.mock("../startup/StartupReadinessProvider", () => ({
  useStartupReadiness: jest.fn(),
}));

jest.mock("./Pagination", () => ({ currentPage, setCurrentPage }) => (
  <div data-testid="pagination">
    <button type="button" onClick={() => setCurrentPage(currentPage + 1)}>Next page</button>
  </div>
));

describe("AdminPanel collection controls", () => {
  it("uses irregular count-up increments at the requested magnitude", () => {
    expect(getAnimatedCountIncrement(100, 1)).toBe(1);
    expect(getAnimatedCountIncrement(101, 1)).toBeGreaterThanOrEqual(8);
    expect(getAnimatedCountIncrement(101, 1)).toBeLessThanOrEqual(12);
    expect(getAnimatedCountIncrement(1001, 1)).toBeGreaterThanOrEqual(85);
    expect(getAnimatedCountIncrement(1001, 1)).toBeLessThanOrEqual(115);
    expect(getAnimatedCountIncrement(1001, 1)).not.toBe(getAnimatedCountIncrement(1001, 2));
    expect(getAnimatedCountIncrement(10001, 1)).toBeGreaterThanOrEqual(850);
    expect(getAnimatedCountIncrement(100001, 1)).toBeGreaterThanOrEqual(8500);
    expect(getAnimatedCountIncrement(1000001, 1)).toBeGreaterThanOrEqual(85000);
  });

  it("distributes count-up steps across a two-second animation and reaches the exact total", () => {
    const steps = buildAnimatedCountSteps(145);

    expect(steps.length).toBe(15);
    expect(steps.reduce((total, step) => total + step, 0)).toBe(145);
    expect(new Set(steps).size).toBeGreaterThan(1);
    expect(buildAnimatedCountSteps(0)).toEqual([]);
  });

  it("uses longer count-up durations for larger asset totals", () => {
    expect(getAnimatedCountDuration(1000)).toBe(2000);
    expect(getAnimatedCountDuration(1001)).toBe(3000);
    expect(getAnimatedCountDuration(100000)).toBe(3000);
    expect(getAnimatedCountDuration(100001)).toBe(4000);
  });

  beforeEach(() => {
    window.history.pushState({}, "", "/");
    sessionStorage.removeItem("admin-dashboard-section");
    sessionStorage.removeItem("admin-thumbnail-preview-sample-session");
    sessionStorage.removeItem("admin-thumbnail-preview-sample-history");
    localStorage.removeItem("admin-assets-connection-card-count");
    localStorage.removeItem("admin-thumbnails-connection-card-count");
    localStorage.removeItem("adminPromotionsActiveSection");
    localStorage.removeItem("footer-social-links");
    mockReportResource.mockClear();
    useStartupReadiness.mockReturnValue({
      reportResource: mockReportResource,
      retryKey: 0,
      routeId: "",
    });
    useLocation.mockReturnValue({ search: "?tab=controls" });
    axios.get.mockImplementation((url) => {
      if (url.endsWith("/preview-samples/state")) {
        return Promise.resolve({ data: { destinationPath: "", sessionIds: [], sample: null, preview: null } });
      }
      if (url.includes("/admin/thumbnail-generation-settings")) {
        return Promise.resolve({
          data: {
            active: { quality: 37, maxFileSizeKb: 50, dimensionPercent: 20, formats: ["jpg", "png", "eps", "psd"] },
            draft: { quality: 37, maxFileSizeKb: 50, dimensionPercent: 20, formats: ["jpg", "png", "eps", "psd"] },
            pendingActivationAt: null,
          },
        });
      }
      if (url.includes("/admin/redirect-rules")) {
        return Promise.resolve({ data: [] });
      }
      if (url.includes("/admin/categories")) {
        return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      }
      if (url.includes("/admin/collections")) {
        return Promise.resolve({ data: [{ id: 1, name: "Nature" }] });
      }
      return Promise.resolve({ data: [{ id: 1, title: "Live asset", status: "approved", filename: "asset.jpg", category: "Images", keywords: "", description: "", type: "image" }] });
    });
    axios.post.mockResolvedValue({ data: { id: 2, name: "Travel" } });
    axios.put.mockImplementation((url, value) => (
      url.endsWith("/preview-samples/state")
        ? Promise.resolve({
            data: {
              destinationPath: value.destinationPath,
              sessionIds: [],
              sample: null,
              preview: null,
            },
          })
        : Promise.resolve({
            data: {
              active: { quality: 37, maxFileSizeKb: 50, dimensionPercent: 20, formats: ["jpg", "png", "eps", "psd"] },
              draft: { quality: 60, maxFileSizeKb: 50, dimensionPercent: 20, formats: ["jpg", "png", "eps", "psd"] },
              pendingActivationAt: null,
            },
          })
    ));
    axios.delete.mockResolvedValue({ data: { id: 1, name: "Nature" } });
  });

  it("renders the Redirection card in Controls", () => {
    render(<AdminPanel />);

    expect(screen.getByRole("heading", { name: "Redirection" })).toBeInTheDocument();
  });

  it("filters Controls cards by their labels and restores them when cleared", async () => {
    render(<AdminPanel />);

    const search = screen.getByRole("searchbox", { name: "Search controls and settings" });
    const cards = document.querySelectorAll(".admin-controls-page-grid > .admin-panel-card");
    expect(cards.length).toBeGreaterThan(1);

    fireEvent.change(search, { target: { value: "favicon" } });
    await waitFor(() => {
      expect(document.querySelectorAll(".admin-controls-page-grid > .admin-panel-card:not([hidden])").length).toBe(2);
    });

    fireEvent.change(search, { target: { value: "no matching setting" } });
    expect(await screen.findByRole("status")).toHaveTextContent("No matching controls found.");

    fireEvent.change(search, { target: { value: "" } });
    await waitFor(() => {
      expect(document.querySelectorAll(".admin-controls-page-grid > .admin-panel-card:not([hidden])").length).toBe(cards.length);
    });
  });

  it("renders and counts up the thumbnail generation quality settings in Controls", async () => {
    render(<AdminPanel />);

    expect(screen.getByRole("heading", { name: "Thumbnail Generation Quality Settings" })).toBeInTheDocument();
    const settings = screen.getByRole("group", { name: "Current thumbnail generation settings" });
    expect(within(settings).getByText("WebP quality")).toBeInTheDocument();
    expect(within(settings).getByText("Maximum size")).toBeInTheDocument();
    expect(within(settings).getByText("Dimensions")).toBeInTheDocument();
    expect(within(settings).getAllByRole("tooltip")).toHaveLength(3);

    await waitFor(() => {
      expect(within(settings).getByText("37")).toBeInTheDocument();
      expect(within(settings).getByText("50")).toBeInTheDocument();
      expect(within(settings).getByText("20")).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it("opens the new and existing upload settings URLs from the thumbnail card", () => {
    render(<AdminPanel />);

    fireEvent.click(screen.getByRole("button", { name: "New Upload Setting" }));
    expect(window.location.href).toContain("?tab=controls/thumbnailgeneration_newsettings");

    fireEvent.click(screen.getByRole("button", { name: "Existing Upload Setting" }));
    expect(window.location.href).toContain("?tab=controls/thumbnailgeneration_existingsettings");
  });

  it("renders the new upload settings page for its Controls tab URL", () => {
    useLocation.mockReturnValue({ search: "?tab=controls/thumbnailgeneration_newsettings" });

    render(<AdminPanel />);

    expect(screen.getByRole("heading", { name: "New Upload Thumbnail Settings", level: 2 })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back to Controls" })).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "WebP quality" })).toHaveAttribute("min", "10");
    expect(screen.getByRole("slider", { name: "WebP quality" })).toHaveAttribute("max", "100");
    expect(screen.getByLabelText("Maximum file size unit")).toHaveValue("KB");
    expect(screen.queryByText(/total assets:/i)).not.toBeInTheDocument();
  });

  it("shows effective live thumbnail settings separately for each format", async () => {
    useLocation.mockReturnValue({ search: "?tab=controls/thumbnailgeneration_newsettings" });
    const previousGet = axios.get.getMockImplementation();
    const videoSettings = {
      quality: 78,
      maxFileSizeKb: 300,
      dimensionPercent: 55,
      multipleVideoThumbnails: true,
      includeVideoPreview: true,
      generateOptimizedVideoPreview: true,
      videoQuality: 84,
      videoMaxHeight: 480,
      videoMaxFileSizeMb: 3,
    };
    const formatSettings = {
      jpg: { quality: 61, maxFileSizeKb: 120, dimensionPercent: 40 },
      eps: { quality: 61, maxFileSizeKb: 120, dimensionPercent: 40 },
      video: videoSettings,
    };
    axios.get.mockImplementation((url, ...args) => (
      url.includes("/admin/thumbnail-generation-settings")
        ? Promise.resolve({
            data: {
              active: {
                quality: 61,
                maxFileSizeKb: 120,
                dimensionPercent: 40,
                formats: ["jpg", "eps", "video"],
                formatSettings,
              },
              draft: {
                quality: 61,
                maxFileSizeKb: 120,
                dimensionPercent: 40,
                formats: ["jpg", "eps", "video"],
                formatSettings,
              },
              pendingActivationAt: null,
            },
          })
        : previousGet(url, ...args)
    ));

    render(<AdminPanel />);

    const currentSettings = screen.getByRole("region", { name: "Current active thumbnail settings" });
    const jpgSettings = within(currentSettings).getByRole("group", { name: "JPG / JPEG live settings" });
    const pngSettings = within(currentSettings).getByRole("group", { name: "PNG live settings" });
    const epsSettings = within(currentSettings).getByRole("group", { name: "EPS live settings" });
    const psdSettings = within(currentSettings).getByRole("group", { name: "PSD live settings" });
    const videoLiveSettings = within(currentSettings).getByRole("group", { name: "Video live settings" });
    const readRows = (card, selector) => Array.from(card.querySelectorAll(selector), (row) => row.textContent);

    await waitFor(() => {
      expect(readRows(jpgSettings, ".thumbnail-live-card__settings-rows > p")).toEqual([
        "Quality: 61",
        "Maximum size: 120 KB",
        "Dimensions: 40%",
      ]);
    });
    expect(readRows(jpgSettings, ".thumbnail-live-card__settings-rows > p")).toEqual([
      "Quality: 61",
      "Maximum size: 120 KB",
      "Dimensions: 40%",
    ]);
    expect(within(jpgSettings).queryByText("Custom settings applied")).not.toBeInTheDocument();
    expect(readRows(epsSettings, ".thumbnail-live-card__settings-rows > p")).toEqual([
      "Quality: 61",
      "Maximum size: 120 KB",
      "Dimensions: 40%",
    ]);
    expect(readRows(videoLiveSettings, ".thumbnail-live-card__video-details > p")).toEqual([
      "Thumbnail settings",
      "Image quality: 78",
      "Maximum thumbnail size: 300 KB",
      "Thumbnail dimensions: 55%",
      "Multiple thumbnails: On",
      "Video settings",
      "Playable preview: On",
      "Optimized MP4: On",
      "Video quality: 84",
      "Maximum resolution: 480p",
      "Maximum video size: 3 MB",
    ]);
    expect(readRows(pngSettings, ".thumbnail-live-card__settings-rows > p")).toEqual([
      "Quality: 37",
      "Maximum size: 50 KB",
      "Dimensions: 20%",
    ]);
    expect(within(pngSettings).getByText("Default settings in use")).toBeInTheDocument();
    expect(readRows(psdSettings, ".thumbnail-live-card__settings-rows > p")).toEqual([
      "Quality: 37",
      "Maximum size: 50 KB",
      "Dimensions: 20%",
    ]);
  });

  it("refreshes the current live settings when a scheduled activation completes", async () => {
    useLocation.mockReturnValue({ search: "?tab=controls/thumbnailgeneration_newsettings" });
    const previousGet = axios.get.getMockImplementation();
    const pendingSettings = {
      active: { quality: 37, maxFileSizeKb: 50, dimensionPercent: 20, formats: ["jpg", "png", "eps", "video"] },
      draft: {
        quality: 90,
        maxFileSizeKb: 50,
        dimensionPercent: 30,
        formats: ["psd"],
        formatSettings: { psd: { quality: 90, maxFileSizeKb: 50, dimensionPercent: 30 } },
      },
      pendingActivationAt: new Date(Date.now() - 1000).toISOString(),
    };
    const activatedSettings = {
      ...pendingSettings,
      active: pendingSettings.draft,
      pendingActivationAt: null,
    };
    let settingsRequestCount = 0;
    axios.get.mockImplementation((url, ...args) => (
      url.includes("/admin/thumbnail-generation-settings")
        ? Promise.resolve({
            data: settingsRequestCount++ === 0 ? pendingSettings : activatedSettings,
          })
        : previousGet(url, ...args)
    ));

    render(<AdminPanel />);

    const currentSettings = screen.getByRole("region", { name: "Current active thumbnail settings" });
    const psdSettings = within(currentSettings).getByRole("group", { name: "PSD live settings" });
    expect(await within(psdSettings).findByText("Quality 90 · Maximum 50 KB · Dimensions 30%")).toBeInTheDocument();
    expect(settingsRequestCount).toBeGreaterThanOrEqual(2);
  });

  it("selects one default format for legacy settings responses", async () => {
    useLocation.mockReturnValue({ search: "?tab=controls/thumbnailgeneration_newsettings" });
    const previousGet = axios.get.getMockImplementation();
    axios.get.mockImplementation((url, ...args) => (
      url.includes("/admin/thumbnail-generation-settings")
        ? Promise.resolve({
            data: {
              active: { quality: 37, maxFileSizeKb: 50, dimensionPercent: 20 },
              draft: { quality: 37, maxFileSizeKb: 50, dimensionPercent: 20 },
              pendingActivationAt: null,
            },
          })
        : previousGet(url, ...args)
    ));

    render(<AdminPanel />);

    await waitFor(() => expect(screen.getByRole("slider", { name: "WebP quality" })).toBeEnabled());
    expect(screen.getByLabelText("JPG / JPEG")).toBeChecked();
    expect(screen.getByLabelText("PNG")).not.toBeChecked();
    expect(screen.getByLabelText("EPS")).not.toBeChecked();
    expect(screen.getByLabelText("PSD")).not.toBeChecked();
    expect(screen.getByLabelText("Video")).not.toBeChecked();
  });

  it("opens a modal to choose a server folder and applies the selected path", async () => {
    useLocation.mockReturnValue({ search: "?tab=controls/thumbnailgeneration_newsettings" });
    const previousGet = axios.get.getMockImplementation();
    axios.get.mockImplementation((url, config = {}) => (
      url.includes("/admin/thumbnail-generation-settings/preview-folders")
        ? Promise.resolve({
            data: config.params?.path
              ? { path: config.params.path, parentPath: null, directories: [] }
              : { path: null, roots: [{ name: "Sample previews", path: "/srv/sample-previews" }] },
          })
        : previousGet(url, config)
    ));

    render(<AdminPanel />);

    await waitFor(() => expect(screen.getByRole("slider", { name: "WebP quality" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Browse folders" }));

    const folderDialog = await screen.findByRole("dialog", { name: "Choose a server folder" });
    expect(folderDialog).toHaveAttribute("aria-modal", "true");
    fireEvent.click(within(folderDialog).getByRole("button", { name: "Sample previews — /srv/sample-previews" }));

    expect(await within(folderDialog).findByText("Current folder: /srv/sample-previews")).toBeInTheDocument();
    fireEvent.click(within(folderDialog).getByRole("button", { name: "Use current folder" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByLabelText("Sample and preview destination path")).toHaveValue("/srv/sample-previews");
    expect(screen.getByRole("region", { name: "Step 2: Upload sample file" })).toBeInTheDocument();
  });

  it("applies the existing sample state returned when saving its destination", async () => {
    useLocation.mockReturnValue({ search: "?tab=controls/thumbnailgeneration_newsettings" });
    const previousPut = axios.put.getMockImplementation();
    axios.put.mockImplementation((url, value, ...args) => (
      url.endsWith("/preview-samples/state")
        ? Promise.resolve({
            data: {
              destinationPath: value.destinationPath,
              sessionIds: ["existing-session"],
              sample: {
                id: "existing-session",
                sourcePath: "/srv/sample-previews/sample.png",
                outputPath: "/srv/sample-previews/sample-preview.webp",
                format: "png",
              },
              preview: null,
            },
          })
        : previousPut(url, value, ...args)
    ));

    render(<AdminPanel />);

    await waitFor(() => expect(screen.getByRole("slider", { name: "WebP quality" })).toBeEnabled());
    fireEvent.change(screen.getByLabelText("Sample and preview destination path"), {
      target: { value: "/srv/sample-previews" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Use this path" }));

    expect(await screen.findByText(/Original: \/srv\/sample-previews\/sample\.png/)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Step 3: Generate preview" })).toBeInTheDocument();
    expect(screen.getByLabelText("Sample and preview destination path")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Manual clean and start again" })).toBeInTheDocument();
  });

  it("shows upload byte progress while a sample file is being sent", async () => {
    useLocation.mockReturnValue({ search: "?tab=controls/thumbnailgeneration_newsettings" });
    let reportProgress;
    let completeUpload;
    axios.post.mockImplementation((url, _data, config = {}) => (
      url.endsWith("/preview-samples")
        ? new Promise((resolve) => {
            reportProgress = config.onUploadProgress;
            completeUpload = () => resolve({
              data: {
                id: "progress-session",
                sourcePath: "/srv/sample-previews/sample.jpg",
                outputPath: "/srv/sample-previews/sample-preview.webp",
                sessionIds: ["progress-session"],
              },
            });
          })
        : Promise.resolve({ data: {} })
    ));

    render(<AdminPanel />);

    await waitFor(() => expect(screen.getByRole("slider", { name: "WebP quality" })).toBeEnabled());
    fireEvent.change(screen.getByLabelText("Sample and preview destination path"), {
      target: { value: "/srv/sample-previews" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Use this path" }));
    await screen.findByText("Destination folder is ready.");
    fireEvent.change(screen.getByLabelText(/Select a JPG, PNG, EPS, PSD, or video file/), {
      target: { files: [new File(["sample"], "sample.jpg", { type: "image/jpeg" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Upload sample file" }));

    reportProgress({ loaded: 25, total: 100 });
    const progress = await screen.findByLabelText("Sample file upload progress");
    await waitFor(() => expect(progress).toHaveValue(25));
    const uploadCall = axios.post.mock.calls.find(([url]) => url.endsWith("/preview-samples"));
    expect(uploadCall[2]).toEqual(expect.objectContaining({ skipGlobalLoading: true }));

    completeUpload();
    expect(await screen.findByText(/Original: \/srv\/sample-previews\/sample\.jpg/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Sample file upload progress")).not.toBeInTheDocument();
  });

  it("shows the server-reported percentage while generating a sample preview", async () => {
    useLocation.mockReturnValue({ search: "?tab=controls/thumbnailgeneration_newsettings" });
    let finishGeneration;
    const defaultGet = axios.get.getMockImplementation();
    axios.get.mockImplementation((url, ...args) => (
      url.endsWith("/progress")
        ? Promise.resolve({ data: { percent: 42, status: "processing" } })
        : defaultGet(url, ...args)
    ));
    axios.post.mockImplementation((url) => {
      if (url.endsWith("/preview-samples")) {
        return Promise.resolve({
          data: {
            id: "generation-session",
            sourcePath: "/srv/sample-previews/sample.jpg",
            outputPath: "/srv/sample-previews/sample-preview.webp",
            sessionIds: ["generation-session"],
          },
        });
      }
      if (url.endsWith("/generate")) {
        return new Promise((resolve) => {
          finishGeneration = () => resolve({
            data: {
              outputPath: "/srv/sample-previews/sample-preview.webp",
              preview: "data:image/webp;base64,sample",
              width: 100,
              height: 50,
              sizeBytes: 1000,
              quality: 37,
            },
          });
        });
      }
      return Promise.resolve({ data: {} });
    });

    render(<AdminPanel />);

    await waitFor(() => expect(screen.getByRole("slider", { name: "WebP quality" })).toBeEnabled());
    fireEvent.change(screen.getByLabelText("Sample and preview destination path"), {
      target: { value: "/srv/sample-previews" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Use this path" }));
    await screen.findByText("Destination folder is ready.");
    fireEvent.change(screen.getByLabelText(/Select a JPG, PNG, EPS, PSD, or video file/), {
      target: { files: [new File(["sample"], "sample.jpg", { type: "image/jpeg" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Upload sample file" }));
    await screen.findByText(/Original: \/srv\/sample-previews\/sample\.jpg/);
    fireEvent.click(screen.getByRole("button", { name: "Generate preview file" }));

    const progress = await screen.findByLabelText("Preview generation progress");
    expect(await screen.findByText("42%")).toBeInTheDocument();
    expect(progress).toHaveValue(42);
    expect(screen.getByText("Generating preview on the server. Larger videos may take longer.")).toBeInTheDocument();
    const generateCall = axios.post.mock.calls.find(([url]) => url.endsWith("/generate"));
    expect(generateCall[2]).toEqual(expect.objectContaining({ skipGlobalLoading: true }));
    const progressCall = axios.get.mock.calls.find(([url]) => url.endsWith("/progress"));
    expect(progressCall[1]).toEqual(expect.objectContaining({ skipGlobalLoading: true }));

    finishGeneration();
    expect(await screen.findByText(/Generated files: \/srv\/sample-previews\/sample-preview\.webp/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Preview generation progress")).not.toBeInTheDocument();
  });

  it("asks before renaming a duplicate sample filename and uploads the confirmed name", async () => {
    useLocation.mockReturnValue({ search: "?tab=controls/thumbnailgeneration_newsettings" });
    let uploadCount = 0;
    axios.post.mockImplementation((url) => {
      if (!url.endsWith("/preview-samples")) return Promise.resolve({ data: {} });
      uploadCount += 1;
      if (uploadCount <= 2) {
        return Promise.reject({
          response: {
            data: {
              code: "SAMPLE_FILENAME_EXISTS",
              existingFilename: "ankit.jpg",
              suggestedFilename: "ankit1.jpg",
              error: "A file named ankit.jpg already exists in the selected folder.",
            },
          },
        });
      }
      return Promise.resolve({
        data: {
          id: "renamed-session",
          originalFilename: "ankit1.jpg",
          sourcePath: "/srv/sample-previews/ankit1.jpg",
          outputPath: "/srv/sample-previews/ankit1-preview.webp",
          sessionIds: ["renamed-session"],
        },
      });
    });

    render(<AdminPanel />);

    await waitFor(() => expect(screen.getByRole("slider", { name: "WebP quality" })).toBeEnabled());
    fireEvent.change(screen.getByLabelText("Sample and preview destination path"), {
      target: { value: "/srv/sample-previews" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Use this path" }));
    await screen.findByText("Destination folder is ready.");
    fireEvent.change(screen.getByLabelText(/Select a JPG, PNG, EPS, PSD, or video file/), {
      target: { files: [new File(["sample"], "ankit.jpg", { type: "image/jpeg" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Upload sample file" }));

    const renameDialog = await screen.findByRole("dialog", { name: "This filename already exists" });
    expect(renameDialog).toHaveTextContent("Rename the new file to “ankit1.jpg” and upload it?");
    expect(uploadCount).toBe(1);
    const initialUpload = axios.post.mock.calls.filter(([url]) => url.endsWith("/preview-samples"))[0][1];
    expect(initialUpload.get("filename")).toBeNull();
    fireEvent.click(within(renameDialog).getByRole("button", { name: "Cancel upload" }));
    expect(screen.queryByRole("dialog", { name: "This filename already exists" })).not.toBeInTheDocument();
    expect(uploadCount).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "Upload sample file" }));
    const confirmDialog = await screen.findByRole("dialog", { name: "This filename already exists" });
    fireEvent.click(within(confirmDialog).getByRole("button", { name: "Rename and upload" }));

    expect(await screen.findByText(/Original: \/srv\/sample-previews\/ankit1\.jpg/)).toBeInTheDocument();
    const confirmedUpload = axios.post.mock.calls.filter(([url]) => url.endsWith("/preview-samples"))[2];
    expect(confirmedUpload[1].get("filename")).toBe("ankit1.jpg");
  });

  it("applies video settings to video sample uploads", async () => {
    useLocation.mockReturnValue({ search: "?tab=controls/thumbnailgeneration_newsettings" });
    axios.post.mockImplementation((url) => {
      if (url.endsWith("/preview-samples")) {
        return Promise.resolve({
          data: {
            id: "video-session",
            originalFilename: "clip.mp4",
            sourcePath: "/srv/sample-previews/clip.mp4",
            outputPath: "/srv/sample-previews/clip-preview.webp",
            format: "video",
            sessionIds: ["video-session"],
          },
        });
      }
      if (url.endsWith("/generate")) {
        const previews = [0, 3.3, 6.7].map((timestamp, index) => ({
          filename: `clip-preview-${index + 1}.webp`,
          outputPath: `/srv/sample-previews/clip-preview-${index + 1}.webp`,
          preview: `data:image/webp;base64,${index}`,
          width: 100,
          height: 50,
          sizeBytes: 1000,
          quality: 37,
          timestamp,
        }));
        return Promise.resolve({
          data: {
            ...previews[0],
            previews,
            videoPreview: true,
            videoPreviewUrl: "/admin/thumbnail-generation-settings/preview-samples/video-session/original?token=sample-token",
            optimizedVideo: {
              outputPath: "/srv/sample-previews/clip-preview.mp4",
              width: 640,
              height: 360,
              sizeBytes: 1500000,
            },
            optimizedVideoUrl: "/admin/thumbnail-generation-settings/preview-samples/video-session/optimized?token=sample-token",
          },
        });
      }
      return Promise.resolve({ data: {} });
    });

    render(<AdminPanel />);

    await waitFor(() => expect(screen.getByRole("slider", { name: "WebP quality" })).toBeEnabled());
    expect(screen.getByLabelText("Video")).not.toBeChecked();
    fireEvent.click(screen.getByLabelText("Video"));
    fireEvent.click(screen.getByLabelText("Generate multiple video thumbnails"));
    fireEvent.click(screen.getByLabelText("Include playable video preview"));
    fireEvent.click(screen.getByLabelText("Generate optimized video preview"));
    expect(screen.getByLabelText("Maximum video file size (MB)")).toHaveValue(2);
    fireEvent.change(screen.getByLabelText("Sample and preview destination path"), {
      target: { value: "/srv/sample-previews" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Use this path" }));
    await screen.findByText("Destination folder is ready.");
    fireEvent.change(screen.getByLabelText(/Select a JPG, PNG, EPS, PSD, or video file/), {
      target: { files: [new File(["video"], "clip.mp4", { type: "video/mp4" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Upload sample file" }));

    expect(await screen.findByText(/Original: \/srv\/sample-previews\/clip\.mp4/)).toBeInTheDocument();
    const upload = axios.post.mock.calls.find(([url]) => url.endsWith("/preview-samples"))[1];
    expect(upload.get("file").name).toBe("clip.mp4");
    fireEvent.click(screen.getByRole("button", { name: "Generate preview file" }));
    expect(await screen.findByAltText("Generated thumbnail preview 3")).toBeInTheDocument();
    expect(screen.getByLabelText("Optimized video preview")).toHaveAttribute(
      "src",
      expect.stringContaining("/preview-samples/video-session/optimized?token=sample-token")
    );
    expect(screen.getByText("Optimized video file: /srv/sample-previews/clip-preview.mp4")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download optimized MP4" })).toHaveAttribute(
      "href",
      expect.stringContaining("/preview-samples/video-session/optimized?token=sample-token&download=true")
    );
  });

  it("shows generated frames when the optimized video exceeds its size limit", async () => {
    useLocation.mockReturnValue({ search: "?tab=controls/thumbnailgeneration_newsettings" });
    const previews = [0, 3.3, 6.7].map((timestamp, index) => ({
      filename: `clip-preview-${index + 1}.webp`,
      outputPath: `/srv/sample-previews/clip-preview-${index + 1}.webp`,
      preview: `data:image/webp;base64,${index}`,
      width: 100,
      height: 50,
      sizeBytes: 1000,
      quality: 37,
      timestamp,
    }));
    axios.post.mockImplementation((url) => {
      if (url.endsWith("/preview-samples")) {
        return Promise.resolve({
          data: {
            id: "video-size-limit-session",
            originalFilename: "clip.mp4",
            sourcePath: "/srv/sample-previews/clip.mp4",
            outputPath: "/srv/sample-previews/clip-preview.webp",
            format: "video",
            sessionIds: ["video-size-limit-session"],
          },
        });
      }
      if (url.endsWith("/generate")) {
        return Promise.resolve({
          data: {
            ...previews[0],
            previews,
            videoPreview: true,
            videoPreviewUrl: "/admin/thumbnail-generation-settings/preview-samples/video-size-limit-session/original?token=sample-token",
            optimizedVideo: null,
            optimizedVideoWarning: "The 1 MB limit is too small for this video's duration.",
          },
        });
      }
      return Promise.resolve({ data: {} });
    });

    render(<AdminPanel />);

    await waitFor(() => expect(screen.getByRole("slider", { name: "WebP quality" })).toBeEnabled());
    fireEvent.click(screen.getByLabelText("Video"));
    fireEvent.change(screen.getByLabelText("Sample and preview destination path"), {
      target: { value: "/srv/sample-previews" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Use this path" }));
    await screen.findByText("Destination folder is ready.");
    fireEvent.change(screen.getByLabelText(/Select a JPG, PNG, EPS, PSD, or video file/), {
      target: { files: [new File(["video"], "clip.mp4", { type: "video/mp4" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Upload sample file" }));
    await screen.findByText(/Original: \/srv\/sample-previews\/clip\.mp4/);
    fireEvent.click(screen.getByRole("button", { name: "Generate preview file" }));

    expect(await screen.findByAltText("Generated thumbnail preview 3")).toBeInTheDocument();
    expect(screen.getByText(/Thumbnail frames were generated, but no optimized MP4 was created/)).toBeInTheDocument();
  });

  it("runs the sample preview flow in order and cleans both saved files", async () => {
    useLocation.mockReturnValue({ search: "?tab=controls/thumbnailgeneration_newsettings" });
    let previewState = { destinationPath: "", sessionIds: [], sample: null, preview: null };
    const previousGet = axios.get.getMockImplementation();
    axios.get.mockImplementation((url, config = {}) => (
      url.endsWith("/preview-samples/state")
        ? Promise.resolve({ data: previewState })
        : url.includes("/admin/thumbnail-generation-settings/preview-folders")
          ? Promise.resolve({ data: { path: config.params?.path || "/srv/sample-previews", parentPath: null, directories: [] } })
          : previousGet(url, config)
    ));
    axios.post.mockImplementation((url) => {
      if (url.endsWith("/preview-samples")) {
        previewState = {
          destinationPath: "/srv/sample-previews",
          sessionIds: ["sample-session"],
          sample: { id: "sample-session" },
          preview: null,
        };
        return Promise.resolve({
            data: {
              id: "sample-session",
                sessionIds: ["sample-session"],
              sourcePath: "/srv/sample-previews/sample.png",
              outputPath: "/srv/sample-previews/sample-preview.webp",
            },
          });
      }
      if (url.endsWith("/generate")) {
        return Promise.resolve({
              data: {
                format: "webp",
                width: 100,
                height: 50,
                quality: 60,
                sizeBytes: 1200,
                preview: "data:image/webp;base64,",
                filename: "sample-preview.webp",
                outputPath: "/srv/sample-previews/sample-preview.webp",
              },
            });
      }
      return Promise.resolve({ data: {} });
    });
    axios.delete.mockResolvedValue({ data: { cleaned: true } });

    render(<AdminPanel />);

    await waitFor(() => expect(screen.getByRole("slider", { name: "WebP quality" })).toBeEnabled());
    fireEvent.click(screen.getByLabelText("PNG"));
    expect(screen.getByRole("region", { name: "Step 1: Set sample destination" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Step 2: Upload sample file" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Step 3: Generate preview" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Step 4: Download generated preview" })).not.toBeInTheDocument();
    fireEvent.change(await screen.findByLabelText("WebP quality"), { target: { value: "60" } });
    fireEvent.change(screen.getByLabelText("Sample and preview destination path"), {
      target: { value: "/srv/sample-previews" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Use this path" }));
    await screen.findByText("Destination folder is ready.");
    expect(screen.getByRole("region", { name: "Step 2: Upload sample file" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Step 3: Generate preview" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Select a JPG, PNG, EPS, PSD, or video file/), {
      target: { files: [new File(["sample"], "sample.png", { type: "image/png" })] },
    });
    expect(screen.queryByRole("region", { name: "Step 3: Generate preview" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Upload sample file" }));

    await screen.findByText(/Original: \/srv\/sample-previews\/sample\.png/);
    expect(screen.getByRole("region", { name: "Step 3: Generate preview" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Step 4: Download generated preview" })).not.toBeInTheDocument();
    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining("/admin/thumbnail-generation-settings/preview-samples"),
      expect.any(FormData),
      expect.any(Object)
    );
    fireEvent.click(screen.getByRole("button", { name: "Generate preview file" }));

    expect(await screen.findByAltText("Generated thumbnail preview")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Step 4: Download generated preview" })).toBeInTheDocument();
    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining("/admin/thumbnail-generation-settings/preview-samples/sample-session/generate"),
      {
        settings: expect.objectContaining({
          quality: 60,
          maxFileSizeKb: 50,
          dimensionPercent: 20,
          formats: ["png"],
          formatSettings: expect.objectContaining({
            png: expect.objectContaining({ quality: 60, maxFileSizeKb: 50, dimensionPercent: 20 }),
          }),
        }),
      },
      expect.any(Object)
    );
    expect(screen.getByRole("link", { name: "Download generated preview" })).toHaveAttribute("download", "sample-preview.webp");

    fireEvent.click(screen.getByRole("button", { name: "Manual clean and start again" }));
    await waitFor(() => {
      expect(axios.delete).toHaveBeenCalledWith(
        expect.stringContaining("/admin/thumbnail-generation-settings/preview-samples/sample-session"),
        expect.any(Object)
      );
      expect(screen.getByLabelText("Sample and preview destination path")).toHaveValue("");
    });
    expect(screen.queryByRole("region", { name: "Step 2: Upload sample file" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Step 3: Generate preview" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Step 4: Download generated preview" })).not.toBeInTheDocument();
  });

  it("starts a new test in the same folder and keeps old files until manual clean", async () => {
    useLocation.mockReturnValue({ search: "?tab=controls/thumbnailgeneration_newsettings" });
    let uploadCount = 0;
    let previewState = { destinationPath: "", sessionIds: [], sample: null, preview: null };
    const previousGet = axios.get.getMockImplementation();
    axios.get.mockImplementation((url, config = {}) => (
      url.endsWith("/preview-samples/state")
        ? Promise.resolve({ data: previewState })
        : url.includes("/preview-folders")
          ? Promise.resolve({ data: { path: config.params?.path || "/srv/sample-previews", parentPath: null, directories: [] } })
          : previousGet(url, config)
    ));
    axios.post.mockImplementation((url) => {
      if (url.endsWith("/preview-samples")) {
        uploadCount += 1;
        const id = `sample-session-${uploadCount}`;
        previewState = {
          destinationPath: "/srv/sample-previews",
          sessionIds: [...previewState.sessionIds, id],
          sample: { id },
          preview: null,
        };
        return Promise.resolve({
          data: {
            id,
            sessionIds: previewState.sessionIds,
            sourcePath: `/srv/sample-previews/sample-${uploadCount}.png`,
            outputPath: `/srv/sample-previews/sample-${uploadCount}-preview.webp`,
          },
        });
      }
      if (url.endsWith("/generate")) {
        const sampleNumber = url.includes("sample-session-1") ? 1 : 2;
        return Promise.resolve({
          data: {
            format: "webp",
            width: 100,
            height: 50,
            quality: 60,
            sizeBytes: 1200,
            preview: "data:image/webp;base64,",
            filename: `sample-${sampleNumber}-preview.webp`,
            outputPath: `/srv/sample-previews/sample-${sampleNumber}-preview.webp`,
          },
        });
      }
      if (url.endsWith("/preview-samples/new-test")) {
        previewState = {
          ...previewState,
          sample: null,
          preview: null,
        };
        return Promise.resolve({ data: previewState });
      }
      return Promise.resolve({ data: {} });
    });

    render(<AdminPanel />);

    await waitFor(() => expect(screen.getByRole("slider", { name: "WebP quality" })).toBeEnabled());
    fireEvent.click(screen.getByLabelText("PNG"));
    const destinationInput = screen.getByLabelText("Sample and preview destination path");
    fireEvent.change(destinationInput, { target: { value: "/srv/sample-previews" } });
    fireEvent.click(screen.getByRole("button", { name: "Use this path" }));
    await screen.findByText("Destination folder is ready.");

    const uploadSample = async (filename) => {
      fireEvent.change(screen.getByLabelText(/Select a JPG, PNG, EPS, PSD, or video file/), {
        target: { files: [new File(["sample"], filename, { type: "image/png" })] },
      });
      fireEvent.click(screen.getByRole("button", { name: "Upload sample file" }));
      await screen.findByText(new RegExp(`Original: \\/srv\\/sample-previews\\/${filename}`));
      fireEvent.click(screen.getByRole("button", { name: "Generate preview file" }));
      await screen.findByAltText("Generated thumbnail preview");
    };

    await uploadSample("sample-1.png");
    await waitFor(() => expect(screen.getByRole("button", { name: "New test" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "New test" }));

    await waitFor(() => expect(screen.queryByRole("button", { name: "New test" })).not.toBeInTheDocument());
    expect(screen.getByLabelText("Sample and preview destination path")).toHaveValue("/srv/sample-previews");
    expect(screen.getByLabelText("Sample and preview destination path")).toBeDisabled();
    expect(screen.getByRole("region", { name: "Step 2: Upload sample file" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Step 3: Generate preview" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Step 4: Download generated preview" })).not.toBeInTheDocument();
    expect(axios.delete).not.toHaveBeenCalled();
    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining("/preview-samples/new-test"),
      {},
      expect.any(Object)
    );

    await uploadSample("sample-2.png");
    await waitFor(() => expect(screen.getByRole("button", { name: "Manual clean and start again" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Manual clean and start again" }));

    await waitFor(() => {
      expect(axios.delete).toHaveBeenCalledTimes(3);
      expect(screen.getByLabelText("Sample and preview destination path")).toHaveValue("");
    });
    expect(axios.delete).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("/preview-samples/sample-session-2"),
      expect.any(Object)
    );
    expect(axios.delete).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("/preview-samples/sample-session-1"),
      expect.any(Object)
    );
    expect(axios.delete).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("/preview-samples/state"),
      expect.any(Object)
    );
  });

  it("restores the selected folder and manual-clean history after a new test", async () => {
    useLocation.mockReturnValue({ search: "?tab=controls/thumbnailgeneration_newsettings" });
    sessionStorage.setItem("admin-thumbnail-preview-sample-history", JSON.stringify(["retained-session"]));
    let previewState = { destinationPath: "", sessionIds: [], sample: null, preview: null };
    const previousGet = axios.get.getMockImplementation();
    axios.get.mockImplementation((url, config) => (
      url.endsWith("/preview-samples/state")
        ? Promise.resolve({ data: previewState })
        : previousGet(url, config)
    ));
    axios.post.mockImplementation((url) => {
      if (url.endsWith("/preview-samples/import")) {
        previewState = {
          destinationPath: "/srv/sample-previews",
          sessionIds: ["retained-session"],
          sample: null,
          preview: null,
        };
        return Promise.resolve({ data: previewState });
      }
      return Promise.resolve({ data: {} });
    });

    render(<AdminPanel />);

    expect(await screen.findByLabelText("Sample and preview destination path")).toHaveValue("/srv/sample-previews");
    expect(screen.getByRole("region", { name: "Step 2: Upload sample file" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Step 3: Generate preview" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Sample and preview destination path")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Manual clean and start again" })).toBeInTheDocument();
    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining("/preview-samples/import"),
      { sessionIds: ["retained-session"], currentSessionId: null },
      expect.any(Object)
    );

    fireEvent.click(screen.getByRole("button", { name: "Manual clean and start again" }));

    await waitFor(() => {
      expect(axios.delete).toHaveBeenCalledWith(
        expect.stringContaining("/preview-samples/retained-session"),
        expect.any(Object)
      );
      expect(screen.getByLabelText("Sample and preview destination path")).toHaveValue("");
    });
  });

  it("restores the user preview session from server state without browser storage", async () => {
    useLocation.mockReturnValue({ search: "?tab=controls/thumbnailgeneration_newsettings" });
    const previousGet = axios.get.getMockImplementation();
    axios.get.mockImplementation((url, config) => (
      url.endsWith("/preview-samples/state")
        ? Promise.resolve({
            data: {
              destinationPath: "/srv/sample-previews",
              sessionIds: ["restored-session"],
              sample: {
                id: "restored-session",
                originalFilename: "sample.png",
                previewFilename: "sample-preview.webp",
                destinationPath: "/srv/sample-previews",
                sourcePath: "/srv/sample-previews/sample.png",
                outputPath: "/srv/sample-previews/sample-preview.webp",
                format: "png",
              },
              preview: {
                format: "webp",
                width: 100,
                height: 50,
                quality: 37,
                sizeBytes: 1200,
                filename: "sample-preview.webp",
                outputPath: "/srv/sample-previews/sample-preview.webp",
                preview: "data:image/webp;base64,",
              },
            },
          })
        : previousGet(url, config)
    ));

    render(<AdminPanel />);

    expect(await screen.findByText(/Original: \/srv\/sample-previews\/sample\.png/)).toBeInTheDocument();
    expect(await screen.findByAltText("Generated thumbnail preview")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download generated preview" })).toHaveAttribute("download", "sample-preview.webp");
    expect(axios.post).not.toHaveBeenCalledWith(
      expect.stringContaining("/preview-samples/import"),
      expect.anything(),
      expect.anything()
    );
  });

  it("selects one format at a time while preserving enabled formats", async () => {
    useLocation.mockReturnValue({ search: "?tab=controls/thumbnailgeneration_newsettings" });
    axios.put.mockImplementation((url, draft) => Promise.resolve({
      data: {
        active: { quality: 37, maxFileSizeKb: 50, dimensionPercent: 20, formats: ["jpg", "png", "eps", "psd"] },
        draft,
        pendingActivationAt: null,
      },
    }));

    render(<AdminPanel />);

    await waitFor(() => expect(screen.getByRole("slider", { name: "WebP quality" })).toBeEnabled());
    const formatGroup = screen.getByRole("radiogroup", { name: "Apply settings to one file format" });
    expect(within(formatGroup).getAllByRole("radio").filter((radio) => radio.checked)).toHaveLength(1);
    fireEvent.click(screen.getByLabelText("EPS"));
    expect(screen.getByLabelText("JPG / JPEG")).not.toBeChecked();
    expect(screen.getByLabelText("EPS")).toBeChecked();
    expect(within(formatGroup).getAllByRole("radio").filter((radio) => radio.checked)).toHaveLength(1);
    fireEvent.change(screen.getByRole("slider", { name: "WebP quality" }), { target: { value: "42" } });

    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => {
      expect(axios.put).toHaveBeenCalledWith(
        expect.stringContaining("/admin/thumbnail-generation-settings/draft"),
        expect.objectContaining({
          quality: 42,
          maxFileSizeKb: 50,
          dimensionPercent: 20,
          formats: ["jpg", "png", "eps", "psd"],
          formatSettings: expect.objectContaining({
            jpg: expect.objectContaining({ quality: 37, maxFileSizeKb: 50, dimensionPercent: 20 }),
            eps: expect.objectContaining({ quality: 42, maxFileSizeKb: 50, dimensionPercent: 20 }),
          }),
        }),
        expect.any(Object)
      );
    });
  });

  it("selects the matching format when a sample file is chosen", async () => {
    useLocation.mockReturnValue({ search: "?tab=controls/thumbnailgeneration_newsettings" });
    const previousGet = axios.get.getMockImplementation();
    const draft = {
      quality: 73,
      maxFileSizeKb: 140,
      dimensionPercent: 60,
      formats: ["png"],
      formatSettings: {
        jpg: { quality: 55, maxFileSizeKb: 90, dimensionPercent: 35 },
        png: { quality: 73, maxFileSizeKb: 140, dimensionPercent: 60 },
      },
    };
    axios.get.mockImplementation((url, ...args) => (
      url.endsWith("/preview-samples/state")
        ? Promise.resolve({
            data: { destinationPath: "/srv/sample-previews", sessionIds: [], sample: null, preview: null },
          })
        : url.endsWith("/admin/thumbnail-generation-settings")
          ? Promise.resolve({
              data: {
                active: { quality: 37, maxFileSizeKb: 50, dimensionPercent: 20, formats: ["jpg"] },
                draft,
                pendingActivationAt: null,
              },
            })
          : previousGet(url, ...args)
    ));

    render(<AdminPanel />);

    await waitFor(() => {
      expect(screen.getByLabelText("PNG")).toBeChecked();
      expect(screen.getByRole("slider", { name: "WebP quality" })).toHaveValue("73");
    });
    fireEvent.change(screen.getByLabelText(/Select a JPG, PNG, EPS, PSD, or video file/), {
      target: { files: [new File(["sample"], "sample.jpg", { type: "image/jpeg" })] },
    });

    expect(screen.getByLabelText("JPG / JPEG")).toBeChecked();
    expect(screen.getByLabelText("PNG")).not.toBeChecked();
    expect(screen.getByRole("slider", { name: "WebP quality" })).toHaveValue("55");
  });

  it("loads and saves draft values independently for each format", async () => {
    useLocation.mockReturnValue({ search: "?tab=controls/thumbnailgeneration_newsettings" });
    const formatSettings = {
      jpg: { quality: 55, maxFileSizeKb: 90, dimensionPercent: 35 },
      png: { quality: 73, maxFileSizeKb: 140, dimensionPercent: 60 },
      eps: { quality: 37, maxFileSizeKb: 50, dimensionPercent: 20 },
      psd: { quality: 37, maxFileSizeKb: 50, dimensionPercent: 20 },
      video: {
        quality: 66,
        maxFileSizeKb: 100,
        dimensionPercent: 45,
        multipleVideoThumbnails: true,
        includeVideoPreview: true,
        generateOptimizedVideoPreview: true,
        videoQuality: 84,
        videoMaxHeight: 480,
        videoMaxFileSizeMb: 3,
      },
    };
    const draft = {
      quality: 55,
      maxFileSizeKb: 90,
      dimensionPercent: 35,
      formats: ["jpg", "png"],
      formatSettings,
    };
    const active = {
      quality: 37,
      maxFileSizeKb: 50,
      dimensionPercent: 20,
      formats: ["jpg", "png", "eps", "psd"],
    };
    axios.get.mockImplementation((url) => {
      if (url.endsWith("/preview-samples/state")) {
        return Promise.resolve({ data: { destinationPath: "", sessionIds: [], sample: null, preview: null } });
      }
      if (url.includes("/admin/thumbnail-generation-settings")) {
        return Promise.resolve({ data: { active, draft, pendingActivationAt: null } });
      }
      if (url.includes("/admin/redirect-rules")) return Promise.resolve({ data: [] });
      if (url.includes("/admin/categories")) return Promise.resolve({ data: [] });
      if (url.includes("/admin/collections")) return Promise.resolve({ data: [] });
      return Promise.resolve({ data: [{ id: 1, title: "Live asset", status: "approved", filename: "asset.jpg" }] });
    });
    axios.put.mockImplementation((url, value) => Promise.resolve({
      data: { active, draft: value, pendingActivationAt: null },
    }));

    render(<AdminPanel />);

    await waitFor(() => {
      expect(screen.getByRole("slider", { name: "WebP quality" })).toHaveValue("55");
    });
    fireEvent.click(screen.getByLabelText("PNG"));
    expect(screen.getByRole("slider", { name: "WebP quality" })).toHaveValue("73");
    expect(screen.getByLabelText("Maximum file size")).toHaveValue(140);
    expect(screen.getByLabelText("Dimensions (% of source)")).toHaveValue(60);
    fireEvent.change(screen.getByRole("slider", { name: "WebP quality" }), { target: { value: "74" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => {
      expect(axios.put).toHaveBeenCalledWith(
        expect.stringContaining("/admin/thumbnail-generation-settings/draft"),
        expect.objectContaining({
          formats: ["jpg", "png"],
          formatSettings: expect.objectContaining({
            jpg: formatSettings.jpg,
            png: expect.objectContaining({ ...formatSettings.png, quality: 74 }),
          }),
        }),
        expect.any(Object)
      );
    });
    axios.put.mockClear();

    fireEvent.click(screen.getByLabelText("Video"));
    expect(screen.getByLabelText("PNG")).not.toBeChecked();
    expect(screen.getByLabelText("Video")).toBeChecked();
    expect(screen.getByLabelText("Generate multiple video thumbnails")).toBeChecked();
    expect(screen.getByLabelText("Video quality")).toHaveValue("84");
    expect(screen.getByLabelText("Maximum video resolution")).toHaveValue("480");
    expect(screen.getByLabelText("Maximum video file size (MB)")).toHaveValue(3);
    fireEvent.change(screen.getByLabelText("Video quality"), { target: { value: "86" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => {
      expect(axios.put).toHaveBeenCalledWith(
        expect.stringContaining("/admin/thumbnail-generation-settings/draft"),
        expect.objectContaining({
          formatSettings: expect.objectContaining({
            jpg: formatSettings.jpg,
            png: expect.objectContaining({ ...formatSettings.png, quality: 74 }),
            video: expect.objectContaining({ ...formatSettings.video, videoQuality: 86 }),
          }),
          formats: ["jpg", "png", "video"],
        }),
        expect.any(Object)
      );
    });
    expect(screen.getByLabelText("Video quality")).toHaveValue("86");
    fireEvent.click(screen.getByLabelText("PNG"));
    expect(screen.getByRole("slider", { name: "WebP quality" })).toHaveValue("74");
    fireEvent.click(screen.getByLabelText("JPG / JPEG"));
    expect(screen.getByRole("slider", { name: "WebP quality" })).toHaveValue("55");
    expect(screen.getByLabelText("Maximum file size")).toHaveValue(90);
    fireEvent.click(screen.getByLabelText("Video"));
    expect(screen.getByLabelText("Video quality")).toHaveValue("86");
  });

  it("shows optional video outputs only when Video is selected and saves both toggles", async () => {
    useLocation.mockReturnValue({ search: "?tab=controls/thumbnailgeneration_newsettings" });
    axios.put.mockImplementation((url, draft) => Promise.resolve({
      data: {
        active: { quality: 37, maxFileSizeKb: 50, dimensionPercent: 20, formats: ["jpg", "png", "eps", "psd"] },
        draft,
        pendingActivationAt: null,
      },
    }));

    render(<AdminPanel />);

    await waitFor(() => expect(screen.getByRole("slider", { name: "WebP quality" })).toBeEnabled());
    expect(screen.queryByRole("group", { name: "Video output options" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Video"));
    expect(screen.getByRole("group", { name: "Video output options" })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Generate multiple video thumbnails"));
    fireEvent.click(screen.getByLabelText("Include playable video preview"));
    fireEvent.click(screen.getByLabelText("Generate optimized video preview"));
    fireEvent.change(screen.getByLabelText("Video quality"), { target: { value: "72" } });
    fireEvent.change(screen.getByLabelText("Maximum video resolution"), { target: { value: "480" } });
    fireEvent.change(screen.getByLabelText("Maximum video file size (MB)"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => {
      expect(axios.put).toHaveBeenCalledWith(
        expect.stringContaining("/admin/thumbnail-generation-settings/draft"),
        expect.objectContaining({
          quality: 37,
          maxFileSizeKb: 50,
          dimensionPercent: 20,
          formats: ["jpg", "png", "eps", "psd", "video"],
          multipleVideoThumbnails: true,
          includeVideoPreview: true,
          generateOptimizedVideoPreview: true,
          videoQuality: 72,
          videoMaxHeight: 480,
          videoMaxFileSizeMb: 1,
          formatSettings: expect.objectContaining({
            video: expect.objectContaining({
              quality: 37,
              multipleVideoThumbnails: true,
              includeVideoPreview: true,
              generateOptimizedVideoPreview: true,
              videoQuality: 72,
              videoMaxHeight: 480,
              videoMaxFileSizeMb: 1,
            }),
          }),
        }),
        expect.any(Object)
      );
    });
    expect(screen.getByLabelText("Generate multiple video thumbnails")).toBeChecked();
    expect(screen.getByLabelText("Include playable video preview")).toBeChecked();
    expect(screen.getByLabelText("Generate optimized video preview")).toBeChecked();
    expect(screen.getByLabelText("Video quality")).toHaveValue("72");
    expect(screen.getByLabelText("Maximum video resolution")).toHaveValue("480");
    expect(screen.getByLabelText("Maximum video file size (MB)")).toHaveValue(1);
  });

  it("converts MB file-size input to KB when saving settings", async () => {
    useLocation.mockReturnValue({ search: "?tab=controls/thumbnailgeneration_newsettings" });
    axios.put.mockImplementation((url, draft) => Promise.resolve({
      data: {
        active: { quality: 37, maxFileSizeKb: 50, dimensionPercent: 20, formats: ["jpg", "png", "eps", "psd"] },
        draft,
        pendingActivationAt: null,
      },
    }));

    render(<AdminPanel />);

    await waitFor(() => expect(screen.getByRole("slider", { name: "WebP quality" })).toBeEnabled());
    fireEvent.change(screen.getByLabelText("Maximum file size unit"), { target: { value: "MB" } });
    expect(screen.getByLabelText("Maximum file size")).toHaveValue(0.04883);
    fireEvent.change(screen.getByLabelText("Maximum file size"), { target: { value: "1.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => {
      expect(axios.put).toHaveBeenCalledWith(
        expect.stringContaining("/admin/thumbnail-generation-settings/draft"),
        expect.objectContaining({
          quality: 37,
          maxFileSizeKb: 1536,
          dimensionPercent: 20,
          formats: ["jpg", "png", "eps", "psd"],
          formatSettings: expect.objectContaining({
            jpg: expect.objectContaining({ quality: 37, maxFileSizeKb: 1536, dimensionPercent: 20 }),
          }),
        }),
        expect.any(Object)
      );
    });
  });

  it("does not allow the selected format to be unchecked", async () => {
    useLocation.mockReturnValue({ search: "?tab=controls/thumbnailgeneration_newsettings" });

    render(<AdminPanel />);

    await waitFor(() => expect(screen.getByRole("slider", { name: "WebP quality" })).toBeEnabled());
    const formatGroup = screen.getByRole("radiogroup", { name: "Apply settings to one file format" });
    fireEvent.click(screen.getByLabelText("JPG / JPEG"));
    expect(screen.getByLabelText("JPG / JPEG")).toBeChecked();
    fireEvent.click(screen.getByLabelText("Video"));
    expect(screen.getByLabelText("JPG / JPEG")).not.toBeChecked();
    expect(screen.getByLabelText("Video")).toBeChecked();
    expect(within(formatGroup).getAllByRole("radio").filter((radio) => radio.checked)).toHaveLength(1);
    fireEvent.click(screen.getByLabelText("Video"));
    expect(screen.getByLabelText("Video")).toBeChecked();
  });

  it("saves dirty settings and activates them immediately", async () => {
    const successToast = jest.spyOn(toast, "success").mockImplementation(() => {});
    useLocation.mockReturnValue({ search: "?tab=controls/thumbnailgeneration_newsettings" });
    axios.post.mockImplementation((url) => (
      url.endsWith("/activation")
        ? Promise.resolve({
            data: {
              active: { quality: 60, maxFileSizeKb: 50, dimensionPercent: 20, formats: ["jpg", "png", "eps", "psd"] },
              draft: { quality: 60, maxFileSizeKb: 50, dimensionPercent: 20, formats: ["jpg", "png", "eps", "psd"] },
              pendingActivationAt: null,
            },
          })
        : Promise.resolve({ data: {} })
    ));

    render(<AdminPanel />);

    await waitFor(() => expect(screen.getByRole("slider", { name: "WebP quality" })).toBeEnabled());
    fireEvent.change(screen.getByRole("slider", { name: "WebP quality" }), { target: { value: "42" } });
    fireEvent.click(screen.getByRole("button", { name: "Save and activate now" }));
    expect(axios.put).toHaveBeenCalledWith(
      expect.stringContaining("/admin/thumbnail-generation-settings/draft"),
      expect.objectContaining({
        quality: 42,
        maxFileSizeKb: 50,
        dimensionPercent: 20,
        formats: ["jpg", "png", "eps", "psd"],
        formatSettings: expect.objectContaining({
          jpg: expect.objectContaining({ quality: 42, maxFileSizeKb: 50, dimensionPercent: 20 }),
        }),
      }),
      expect.any(Object)
    );
    const activeJpgSettings = screen.getByRole("group", { name: "JPG / JPEG live settings" });
    expect(await within(activeJpgSettings).findByText("Quality 60 · Maximum 50 KB · Dimensions 20%")).toBeInTheDocument();
    expect(screen.queryByText(/Settings go live in/)).not.toBeInTheDocument();
    expect(successToast).toHaveBeenCalledWith("JPG / JPEG settings saved and activated successfully.");
    successToast.mockRestore();
  });

  it("shows active live thumbnail settings for every format on the existing upload settings tab", async () => {
    useLocation.mockReturnValue({ search: "?tab=controls/thumbnailgeneration_existingsettings" });
    const assets = Array.from({ length: 26 }, (_, index) => ({
      id: index + 1,
      title: index === 0 ? "Aurora artwork" : `Asset ${index + 1}`,
      collection: index === 0 ? "Nature" : `Collection ${index + 1}`,
      filename: index === 0 ? "aurora.psd" : "asset.jpeg",
      created_at: index === 25 ? null : index === 0 ? "2026-11-20T12:00:00.000Z" : "2026-11-19T12:00:00.000Z",
      thumbnail_quality: index === 25 ? null : 80 + (index % 10),
      status: index === 0 || index === 25 ? "approved" : "pending",
    }));
    axios.get.mockImplementation((url) => (
      url.includes("/admin/thumbnail-generation-settings")
        ? Promise.resolve({
            data: {
              active: {
                formats: ["jpg", "png", "eps", "psd", "video"],
                formatSettings: {
                  jpg: { quality: 71, maxFileSizeKb: 101, dimensionPercent: 41 },
                  png: { quality: 72, maxFileSizeKb: 102, dimensionPercent: 42 },
                  eps: { quality: 73, maxFileSizeKb: 103, dimensionPercent: 43 },
                  psd: { quality: 74, maxFileSizeKb: 104, dimensionPercent: 44 },
                  video: {
                    quality: 75,
                    maxFileSizeKb: 105,
                    dimensionPercent: 45,
                    multipleVideoThumbnails: true,
                    includeVideoPreview: true,
                    generateOptimizedVideoPreview: true,
                    videoQuality: 83,
                    videoMaxHeight: 1080,
                    videoMaxFileSizeMb: 6,
                  },
                },
              },
            },
          })
        : url.endsWith("/admin/images")
          ? Promise.resolve({ data: assets })
          : url.includes("/images?limit=1000&page=1")
            ? Promise.resolve({ data: { images: [assets[0]] } })
          : Promise.resolve({ data: { destinationPath: "", sessionIds: [], sample: null, preview: null } })
    ));

    render(<AdminPanel />);

    expect(screen.getByRole("heading", { name: "Existing Upload Setting", level: 2 })).toBeInTheDocument();
    const liveSettings = screen.getByRole("region", { name: "Current live thumbnail settings" });
    expect(await within(liveSettings).findByRole("group", { name: "JPG / JPEG live settings" })).toHaveTextContent("Quality: 71");
    expect(within(liveSettings).getByRole("group", { name: "PNG live settings" })).toHaveTextContent("Quality: 72");
    expect(within(liveSettings).getByRole("group", { name: "EPS live settings" })).toHaveTextContent("Quality: 73");
    expect(within(liveSettings).getByRole("group", { name: "PSD live settings" })).toHaveTextContent("Quality: 74");
    expect(within(liveSettings).getByRole("group", { name: "Video live settings" })).toHaveTextContent("Video quality: 83");
    expect(within(liveSettings).getByRole("group", { name: "Video live settings" })).toHaveTextContent("Maximum resolution: 1080p");
    expect(screen.queryByRole("region", { name: "Previous shared thumbnail settings" })).not.toBeInTheDocument();

    const assetsTable = screen.getByRole("table", { name: "All assets" });
    expect(await within(assetsTable).findByRole("row", { name: /^1 Aurora artwork Nature PSD Nov 20, 2026 80% Live/ })).toBeInTheDocument();
    expect(within(assetsTable).queryByRole("row", { name: /Asset 21/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(await within(assetsTable).findByRole("row", { name: /^21 Asset 21 Collection 21 JPG \/ JPEG Nov 19, 2026 80% Not live/ })).toBeInTheDocument();
    expect(await within(assetsTable).findByRole("row", { name: /^26 Asset 26 Collection 26 JPG \/ JPEG — Not recorded Not live/ })).toBeInTheDocument();
    expect(screen.queryByText(/total assets:/i)).not.toBeInTheDocument();

    fireEvent.change(within(assetsTable).getByRole("searchbox", { name: "Search title" }), {
      target: { value: "Aurora" },
    });
    expect(await within(assetsTable).findByRole("row", { name: /^1 Aurora artwork Nature PSD Nov 20, 2026 80% Live/ })).toBeInTheDocument();
    expect(within(assetsTable).queryByRole("row", { name: /Asset 2/ })).not.toBeInTheDocument();
    fireEvent.change(within(assetsTable).getByRole("searchbox", { name: "Search title" }), {
      target: { value: "" },
    });

    fireEvent.change(within(assetsTable).getByRole("searchbox", { name: "Search collection" }), {
      target: { value: "Collection 26" },
    });
    expect(await within(assetsTable).findByRole("row", { name: /^1 Asset 26 Collection 26 JPG \/ JPEG — Not recorded Not live/ })).toBeInTheDocument();
    fireEvent.change(within(assetsTable).getByRole("searchbox", { name: "Search collection" }), {
      target: { value: "" },
    });

    fireEvent.change(within(assetsTable).getByRole("searchbox", { name: "Search file type" }), {
      target: { value: "PSD" },
    });
    expect(await within(assetsTable).findByRole("row", { name: /^1 Aurora artwork Nature PSD Nov 20, 2026 80% Live/ })).toBeInTheDocument();
    fireEvent.change(within(assetsTable).getByRole("searchbox", { name: "Search file type" }), {
      target: { value: "" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Sort by title ascending" }));
    expect(assetsTable.querySelector('th[aria-sort="ascending"]')).toHaveTextContent("Title");
    expect(within(assetsTable).getAllByRole("row")[1]).toHaveTextContent("Asset 2");
    fireEvent.click(screen.getByRole("button", { name: "Sort by title descending" }));
    expect(within(assetsTable).getAllByRole("row")[1]).toHaveTextContent("Aurora artwork");

    fireEvent.click(screen.getByRole("button", { name: "Sort by collection ascending" }));
    expect(within(assetsTable).getAllByRole("row")[1]).toHaveTextContent("Collection 2");
    fireEvent.click(screen.getByRole("button", { name: "Sort by collection descending" }));
    expect(within(assetsTable).getAllByRole("row")[1]).toHaveTextContent("Aurora artwork");

    fireEvent.click(screen.getByRole("button", { name: "Sort by file type ascending" }));
    expect(within(assetsTable).getAllByRole("row")[1]).toHaveTextContent("JPG / JPEG");
    fireEvent.click(screen.getByRole("button", { name: "Sort by file type descending" }));
    expect(within(assetsTable).getAllByRole("row")[1]).toHaveTextContent("Aurora artwork");

    fireEvent.click(screen.getByRole("button", { name: "Sort by uploaded date ascending" }));
    expect(assetsTable.querySelector('th[aria-sort="ascending"]')).toHaveTextContent("Uploaded date");
    expect(within(assetsTable).getAllByRole("row")[1]).toHaveTextContent("Asset 2");
    fireEvent.click(screen.getByRole("button", { name: "Sort by uploaded date descending" }));
    expect(within(assetsTable).getAllByRole("row")[1]).toHaveTextContent("Aurora artwork");

    fireEvent.click(screen.getByRole("button", { name: "Sort by thumbnail quality ascending" }));
    expect(assetsTable.querySelector('th[aria-sort="ascending"]')).toHaveTextContent("Thumbnail quality");
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(await within(assetsTable).findByRole("row", { name: /^26 Asset 26 Collection 26 JPG \/ JPEG — Not recorded Not live/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sort by thumbnail quality descending" }));
    expect(within(assetsTable).getAllByRole("row")[1]).toHaveTextContent("Asset 10");

    fireEvent.click(screen.getByRole("button", { name: "Sort by live status ascending" }));
    expect(within(assetsTable).getAllByRole("row")[1]).toHaveTextContent("Asset 2");
    fireEvent.click(screen.getByRole("button", { name: "Sort by live status descending" }));
    expect(within(assetsTable).getAllByRole("row")[1]).toHaveTextContent("Aurora artwork");

    axios.post.mockResolvedValue({ status: 202, data: { id: 1, thumbnail_status: "PROCESSING" } });
    const firstAssetRow = within(assetsTable).getByRole("row", { name: /Aurora artwork/ });
    const regenerateButton = within(firstAssetRow).getByRole("button", {
      name: "Regenerate thumbnail for Aurora artwork",
    });
    fireEvent.click(regenerateButton);
    expect(await within(firstAssetRow).findByText("Regeneration queued.")).toBeInTheDocument();
    expect(regenerateButton).toBeDisabled();
    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining("/images/1/thumbnail/retry"),
      {},
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });

  it("opens an asset thumbnail when its title is clicked", async () => {
    useLocation.mockReturnValue({ search: "?tab=controls/thumbnailgeneration_existingsettings" });
    const asset = {
      id: 1,
      title: "Previewable asset",
      filename: "preview.jpg",
      status: "approved",
    };
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/thumbnail-generation-settings")) {
        return Promise.resolve({ data: { active: { formats: [], formatSettings: {} } } });
      }
      if (url.endsWith("/admin/images")) return Promise.resolve({ data: [asset] });
      if (url.includes("/images?limit=1000&page=1")) {
        return Promise.resolve({ data: { images: [asset] } });
      }
      if (url.includes("/api/assets/1/thumbnail")) {
        return Promise.resolve({ data: new Blob(["thumbnail"], { type: "image/webp" }) });
      }
      return Promise.resolve({ data: [] });
    });

    const createObjectURLDescriptor = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
    const revokeObjectURLDescriptor = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: jest.fn(() => "blob:asset-thumbnail-preview"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: jest.fn(),
    });
    let unmount;
    try {
      ({ unmount } = render(<AdminPanel />));
      fireEvent.click(await screen.findByRole("button", { name: "Previewable asset" }));

      const dialog = await screen.findByRole("dialog", { name: "Previewable asset" });
      expect(await within(dialog).findByRole("img", { name: "Previewable asset" })).toHaveAttribute(
        "src",
        "blob:asset-thumbnail-preview"
      );
      expect(axios.get).toHaveBeenCalledWith(
        expect.stringContaining("/api/assets/1/thumbnail"),
        expect.objectContaining({
          responseType: "blob",
        })
      );

      fireEvent.click(within(dialog).getByRole("button", { name: "Close thumbnail preview" }));
      expect(screen.queryByRole("dialog", { name: "Previewable asset" })).not.toBeInTheDocument();
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

  it("shows total, active, and disabled redirect counts in the Controls card", async () => {
    axios.get.mockImplementation((url) => (
      url.includes("/admin/redirect-rules")
        ? Promise.resolve({
            data: [
              { id: 1, redirect_from: "/active-one", redirect_to: "/target", enabled: true },
              { id: 2, redirect_from: "/disabled", redirect_to: "/target", enabled: false },
              { id: 3, redirect_from: "/active-default", redirect_to: "/target" }
            ]
          })
        : Promise.resolve({ data: [] })
    ));

    render(<AdminPanel />);

    const counts = await screen.findByRole("group", { name: "Redirection link counts" });
    expect(within(counts).getByText("3")).toBeInTheDocument();
    expect(within(counts).getByText("Total links")).toBeInTheDocument();
    expect(within(counts).getByText("2")).toBeInTheDocument();
    expect(within(counts).getByText("Active")).toBeInTheDocument();
    expect(within(counts).getByText("1")).toBeInTheDocument();
    expect(within(counts).getByText("Disabled")).toBeInTheDocument();
  });

  it("opens the Redirection Links page from the Redirection card", () => {
    render(<AdminPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Link", exact: true }));

    expect(window.location.href).toContain("?tab=controls/redirection_links");
  });

  it("renders the Redirection Links page at its Controls tab URL", () => {
    useLocation.mockReturnValue({ search: "?tab=controls/redirection_links" });

    render(<AdminPanel />);

    expect(screen.getByRole("heading", { name: "Redirection Links", level: 2 })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back to Controls" })).toBeInTheDocument();
    expect(screen.queryByText(/total assets:/i)).not.toBeInTheDocument();
  });

  it("saves a Redirection From and Redirect To pair", async () => {
    useLocation.mockReturnValue({ search: "?tab=controls/redirection_links" });
    axios.get.mockImplementation((url) => (
      url.includes("/admin/redirect-rules")
        ? Promise.resolve({ data: [] })
        : Promise.resolve({ data: [] })
    ));
    axios.post.mockResolvedValue({
      data: {
        id: 1,
        redirect_from: "/old-page",
        redirect_to: "/new-page",
        created_at: "2026-11-20T12:00:00.000Z"
      }
    });

    render(<AdminPanel />);

    fireEvent.change(screen.getByLabelText("Redirect From"), { target: { value: "/old-page" } });
    fireEvent.change(screen.getByLabelText("Redirect To"), { target: { value: "/new-page" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Redirect" }));

    await waitFor(() => {
      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining("/admin/redirect-rules"),
        { redirect_from: "/old-page", redirect_to: "/new-page" },
        expect.anything()
      );
    });
    expect(await screen.findByText("/old-page")).toBeInTheDocument();
    expect(screen.getByText("→ /new-page")).toBeInTheDocument();
    expect(screen.getByTestId("pagination")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Date" })).toBeInTheDocument();
    const savedRedirectRow = screen.getByRole("row", { name: /\/old-page/ });
    const savedDate = within(savedRedirectRow).getByText(/2026/);
    expect(savedDate.tagName).toBe("TIME");
    expect(savedDate).toHaveAttribute("dateTime", "2026-11-20T12:00:00.000Z");
  });

  it("searches saved redirects across both fields or a selected field", async () => {
    useLocation.mockReturnValue({ search: "?tab=controls/redirection_links" });
    axios.get.mockImplementation((url) => (
      url.includes("/admin/redirect-rules")
        ? Promise.resolve({
            data: [
              { id: 1, redirect_from: "/summer-sale", redirect_to: "/shop/summer" },
              { id: 2, redirect_from: "/winter-sale", redirect_to: "/shop/winter" }
            ]
          })
        : Promise.resolve({ data: [] })
    ));

    render(<AdminPanel />);

    expect(await screen.findByText("/summer-sale")).toBeInTheDocument();
    expect(screen.getByText("/winter-sale")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "S.No." })).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /1 \/summer-sale/ })).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /2 \/winter-sale/ })).toBeInTheDocument();
    expect(screen.getByLabelText("Search saved redirects")).toHaveAttribute("placeholder", "Search paths or destination URLs");

    fireEvent.change(screen.getByLabelText("Search saved redirects"), { target: { value: "summer" } });
    expect(screen.getByText("/summer-sale")).toBeInTheDocument();
    expect(screen.queryByText("/winter-sale")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search redirects in"), { target: { value: "to" } });
    expect(screen.getByLabelText("Search saved redirects")).toHaveAttribute("placeholder", "Search destination URLs");
    fireEvent.change(screen.getByLabelText("Search saved redirects"), { target: { value: "shop/winter" } });
    expect(screen.getByText("/winter-sale")).toBeInTheDocument();
    expect(screen.getByText("→ /shop/winter")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search redirects in"), { target: { value: "from" } });
    expect(screen.getByLabelText("Search saved redirects")).toHaveAttribute("placeholder", "Search source paths");
    expect(screen.getByText("No matching redirects")).toBeInTheDocument();
  });

  it("sorts saved redirects by date in ascending and descending order", async () => {
    useLocation.mockReturnValue({ search: "?tab=controls/redirection_links" });
    axios.get.mockImplementation((url) => (
      url.includes("/admin/redirect-rules")
        ? Promise.resolve({
            data: [
              { id: 2, redirect_from: "/newer", redirect_to: "/target", created_at: "2026-11-20T12:00:00.000Z" },
              { id: 1, redirect_from: "/older", redirect_to: "/target", created_at: "2026-11-18T12:00:00.000Z" },
              { id: 3, redirect_from: "/undated", redirect_to: "/target" }
            ]
          })
        : Promise.resolve({ data: [] })
    ));

    render(<AdminPanel />);

    expect(await screen.findByText("/newer")).toBeInTheDocument();
    const dateSortButton = screen.getByRole("button", { name: "Sort by date ascending" });
    fireEvent.click(dateSortButton);
    let rows = screen.getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("/older");
    expect(rows[1]).toHaveTextContent("/newer");
    expect(rows[2]).toHaveTextContent("/undated");

    fireEvent.click(screen.getByRole("button", { name: "Sort by date descending" }));
    rows = screen.getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("/newer");
    expect(rows[1]).toHaveTextContent("/older");
    expect(rows[2]).toHaveTextContent("/undated");
  });

  it("shows 20 redirect rows per page and continues serial numbers on the next page", async () => {
    useLocation.mockReturnValue({ search: "?tab=controls/redirection_links" });
    axios.get.mockImplementation((url) => (
      url.includes("/admin/redirect-rules")
        ? Promise.resolve({
            data: Array.from({ length: 21 }, (_, index) => ({
              id: index + 1,
              redirect_from: `/redirect-${index + 1}`,
              redirect_to: "/destination",
              created_at: `2026-11-${String(index + 1).padStart(2, "0")}T12:00:00.000Z`
            }))
          })
        : Promise.resolve({ data: [] })
    ));

    render(<AdminPanel />);

    expect(await screen.findByText("/redirect-1")).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(21);
    expect(screen.getByTestId("pagination")).toBeInTheDocument();
    expect(within(screen.getAllByRole("row")[20]).getByText("20")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    const pageRows = screen.getAllByRole("row");
    expect(pageRows).toHaveLength(2);
    expect(pageRows[1]).toHaveTextContent("/redirect-21");
    expect(within(pageRows[1]).getByText("21")).toBeInTheDocument();
  });

  it("exports the currently filtered redirect rows as CSV", async () => {
    useLocation.mockReturnValue({ search: "?tab=controls/redirection_links" });
    const originalCreateObjectURL = window.URL.createObjectURL;
    const originalRevokeObjectURL = window.URL.revokeObjectURL;
    const originalBlob = global.Blob;
    const createObjectURLMock = jest.fn(() => "blob:redirects.csv");
    window.URL.createObjectURL = createObjectURLMock;
    window.URL.revokeObjectURL = jest.fn();
    global.Blob = jest.fn((parts, options) => ({
      text: jest.fn().mockResolvedValue(Array.isArray(parts) ? parts.join("") : String(parts)),
      type: options.type
    }));
    const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    axios.get.mockImplementation((url) => (
      url.includes("/admin/redirect-rules")
        ? Promise.resolve({
            data: [
              { id: 1, redirect_from: "/keep-me", redirect_to: "/destination", created_at: "2026-11-20T12:00:00.000Z" },
              { id: 2, redirect_from: "/exclude-me", redirect_to: "/destination", created_at: "2026-11-19T12:00:00.000Z", enabled: false }
            ]
          })
        : Promise.resolve({ data: [] })
    ));

    try {
      render(<AdminPanel />);

      expect(await screen.findByText("/keep-me")).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText("Search saved redirects"), { target: { value: "keep" } });
      const exportButton = screen.getByRole("button", { name: "Export 1 redirect as CSV" });
      expect(screen.getByLabelText("Search saved redirects").closest(".redirection-search-toolbar")).toContainElement(exportButton);
      fireEvent.click(exportButton);

      await waitFor(() => {
        expect(createObjectURLMock).toHaveBeenCalled();
        expect(clickSpy).toHaveBeenCalled();
      });

      const csvText = await createObjectURLMock.mock.calls[0][0].text();
      expect(csvText).toContain("S.No.,Redirect From,Redirect To,Date,Status");
      expect(csvText).toContain('"1","/keep-me"');
      expect(csvText).toContain("Active");
      expect(csvText).not.toContain("/exclude-me");
    } finally {
      window.URL.createObjectURL = originalCreateObjectURL;
      window.URL.revokeObjectURL = originalRevokeObjectURL;
      global.Blob = originalBlob;
      clickSpy.mockRestore();
    }
  });

  it("disables and re-enables a saved redirect", async () => {
    useLocation.mockReturnValue({ search: "?tab=controls/redirection_links" });
    axios.get.mockImplementation((url) => (
      url.includes("/admin/redirect-rules")
        ? Promise.resolve({
            data: [{ id: 7, redirect_from: "/legacy", redirect_to: "/new", enabled: true }]
          })
        : Promise.resolve({ data: [] })
    ));
    axios.put.mockResolvedValue({
      data: { id: 7, redirect_from: "/legacy", redirect_to: "/new", enabled: false }
    });

    render(<AdminPanel />);

    fireEvent.click(await screen.findByRole("button", { name: "Disable redirect /legacy" }));
    await waitFor(() => {
      expect(axios.put).toHaveBeenCalledWith(
        expect.stringContaining("/admin/redirect-rules/7/enabled"),
        { enabled: false },
        expect.anything()
      );
    });
    expect(await screen.findByText("Disabled")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enable redirect /legacy" })).toBeInTheDocument();

    axios.put.mockResolvedValueOnce({
      data: { id: 7, redirect_from: "/legacy", redirect_to: "/new", enabled: true }
    });
    fireEvent.click(screen.getByRole("button", { name: "Enable redirect /legacy" }));
    await waitFor(() => expect(axios.put).toHaveBeenLastCalledWith(
      expect.stringContaining("/admin/redirect-rules/7/enabled"),
      { enabled: true },
      expect.anything()
    ));
    expect(await screen.findByText("Active")).toBeInTheDocument();
  });

  it("reports selected users readiness from one validated request and retries GET-only", async () => {
    window.history.pushState({}, "", "/admin");
    localStorage.setItem("userRole", "admin");
    useLocation.mockReturnValue({ pathname: "/admin", search: "?tab=users" });
    useStartupReadiness.mockReturnValue({
      reportResource: mockReportResource,
      retryKey: 0,
      routeId: "admin-panel-test",
    });
    let usersAttempt = 0;
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/users")) {
        usersAttempt += 1;
        if (usersAttempt < 3) return Promise.reject(new Error("Unavailable"));
        return Promise.resolve({ data: [] });
      }
      return Promise.resolve({ data: [] });
    });

    const view = render(<AdminPanel />);
    await waitFor(() => {
      expect(mockReportResource).toHaveBeenCalledWith(
        "adminUsers",
        "error",
        "Unable to load users right now. Please retry.",
        "admin-panel-test"
      );
    });
    expect(axios.get.mock.calls.filter(([url]) => url.includes("/admin/users"))).toHaveLength(1);

    useStartupReadiness.mockReturnValue({
      reportResource: mockReportResource,
      retryKey: 1,
      routeId: "admin-panel-test",
    });
    view.rerender(<AdminPanel />);
    await waitFor(() => {
      expect(mockReportResource.mock.calls.filter(([, status]) => status === "error")).toHaveLength(2);
      expect(mockReportResource).toHaveBeenLastCalledWith(
        "adminUsers",
        "error",
        "Unable to load users right now. Please retry.",
        "admin-panel-test"
      );
    });
    expect(axios.get.mock.calls.filter(([url]) => url.includes("/admin/users"))).toHaveLength(2);

    useStartupReadiness.mockReturnValue({
      reportResource: mockReportResource,
      retryKey: 2,
      routeId: "admin-panel-test",
    });
    view.rerender(<AdminPanel />);
    await waitFor(() => {
      expect(mockReportResource).toHaveBeenLastCalledWith("adminUsers", "ready", "", "admin-panel-test");
    });
    expect(axios.get.mock.calls.filter(([url]) => url.includes("/admin/users"))).toHaveLength(3);
    expect(screen.getByText("No users found.")).toBeInTheDocument();
    expect(axios.post).not.toHaveBeenCalled();
    expect(axios.put).not.toHaveBeenCalled();
    expect(axios.patch).not.toHaveBeenCalled();
    expect(axios.delete).not.toHaveBeenCalled();
  });

  it("reloads the admin route when navigating back to the same tab", async () => {
    window.history.pushState({}, "", "/admin");
    localStorage.setItem("userRole", "admin");
    useLocation.mockReturnValue({ pathname: "/admin", search: "?tab=promotions", key: "promotions-first" });
    useStartupReadiness.mockReturnValue({
      reportResource: mockReportResource,
      retryKey: 0,
      routeId: "promotions-first",
    });

    const view = render(<AdminPanel />);

    await waitFor(() => {
      expect(mockReportResource).toHaveBeenCalledWith(
        "adminRoute",
        "ready",
        "",
        "promotions-first"
      );
    });
    expect(axios.get.mock.calls.filter(([url]) => url.includes("/admin/images"))).toHaveLength(1);

    useLocation.mockReturnValue({ pathname: "/admin", search: "?tab=promotions", key: "promotions-second" });
    useStartupReadiness.mockReturnValue({
      reportResource: mockReportResource,
      retryKey: 0,
      routeId: "promotions-second",
    });

    view.rerender(<AdminPanel />);
    await waitFor(() => {
      expect(mockReportResource).toHaveBeenCalledWith(
        "adminRoute",
        "ready",
        "",
        "promotions-second"
      );
    });
    expect(axios.get.mock.calls.filter(([url]) => url.includes("/admin/images"))).toHaveLength(2);
  });

  it("loads each essential administrator dashboard count once before readiness", async () => {
    window.history.pushState({}, "", "/admin");
    localStorage.setItem("userRole", "admin");
    useLocation.mockReturnValue({ pathname: "/admin", search: "?tab=admin_dashboard" });
    useStartupReadiness.mockReturnValue({
      reportResource: mockReportResource,
      retryKey: 0,
      routeId: "admin-dashboard-test",
    });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/images")) return Promise.resolve({ data: [{ id: 1, status: "pending" }] });
      if (url.includes("/admin/users")) return Promise.resolve({ data: [{ id: 2, role: "customer" }] });
      if (url.includes("/admin/collections")) return Promise.resolve({ data: [{ id: 3, name: "Nature" }] });
      return Promise.resolve({ data: [] });
    });

    render(<AdminPanel />);

    await waitFor(() => {
      expect(mockReportResource).toHaveBeenCalledWith("adminDashboard", "ready", "", "admin-dashboard-test");
      expect(mockReportResource).toHaveBeenCalledWith("adminDashboardUsers", "ready", "", "admin-dashboard-test");
      expect(mockReportResource).toHaveBeenCalledWith("adminDashboardCollections", "ready", "", "admin-dashboard-test");
    });
    expect(axios.get.mock.calls.filter(([url]) => url.includes("/admin/images"))).toHaveLength(1);
    expect(axios.get.mock.calls.filter(([url]) => url.includes("/admin/users"))).toHaveLength(1);
    expect(axios.get.mock.calls.filter(([url]) => url.includes("/admin/collections"))).toHaveLength(1);
    expect(axios.get.mock.calls.some(([url]) => url.includes("/images?limit=1000&page=1"))).toBe(false);
    expect(axios.get.mock.calls.some(([url]) => url.includes("/admin/categories"))).toBe(false);
  });

  it("does not treat a malformed users response as readiness success", async () => {
    window.history.pushState({}, "", "/admin");
    localStorage.setItem("userRole", "admin");
    useLocation.mockReturnValue({ pathname: "/admin", search: "?tab=users" });
    useStartupReadiness.mockReturnValue({
      reportResource: mockReportResource,
      retryKey: 0,
      routeId: "admin-panel-test",
    });
    axios.get.mockImplementation((url) => (
      url.includes("/admin/users")
        ? Promise.resolve({ data: { users: [] } })
        : Promise.resolve({ data: [] })
    ));

    render(<AdminPanel />);

    await waitFor(() => {
      expect(mockReportResource).toHaveBeenCalledWith(
        "adminUsers",
        "error",
        "Unable to load users right now. Please retry.",
        "admin-panel-test"
      );
    });
    expect(mockReportResource).not.toHaveBeenCalledWith("adminUsers", "ready", "", "admin-panel-test");
  });

  it("reports selected admin account readiness and retries its existing GET owner", async () => {
    window.history.pushState({}, "", "/admin");
    localStorage.setItem("userRole", "admin");
    useLocation.mockReturnValue({ pathname: "/admin", search: "?tab=myaccount" });
    useStartupReadiness.mockReturnValue({
      reportResource: mockReportResource,
      retryKey: 0,
      routeId: "admin-account-test",
    });
    axios.get.mockImplementation((url) => (
      url.endsWith("/profile")
        ? Promise.reject(new Error("Unavailable"))
        : Promise.resolve({ data: [] })
    ));

    const view = render(<AdminPanel />);
    await waitFor(() => {
      expect(mockReportResource).toHaveBeenCalledWith(
        "adminMyAccount",
        "error",
        "Unable to load account details right now. Please retry.",
        "admin-account-test"
      );
    });
    expect(axios.get.mock.calls.filter(([url]) => url.endsWith("/profile"))).toHaveLength(1);
    const sharedLookupCalls = axios.get.mock.calls.filter(([url]) => (
      url.includes("/admin/categories") || url.includes("/admin/collections")
    )).length;

    axios.get.mockImplementation((url) => (
      url.endsWith("/profile")
        ? Promise.resolve({ data: { id: 8, username: "admin", email: "admin@example.com" } })
        : Promise.resolve({ data: [] })
    ));
    useStartupReadiness.mockReturnValue({
      reportResource: mockReportResource,
      retryKey: 1,
      routeId: "admin-account-test",
    });
    view.rerender(<AdminPanel />);

    await waitFor(() => {
      expect(mockReportResource).toHaveBeenLastCalledWith("adminMyAccount", "ready", "", "admin-account-test");
    });
    expect(axios.get.mock.calls.filter(([url]) => url.endsWith("/profile"))).toHaveLength(2);
    expect(axios.get.mock.calls.filter(([url]) => (
      url.includes("/admin/categories") || url.includes("/admin/collections")
    ))).toHaveLength(sharedLookupCalls);
    expect(axios.post).not.toHaveBeenCalled();
    expect(axios.put).not.toHaveBeenCalled();
    expect(axios.patch).not.toHaveBeenCalled();
    expect(axios.delete).not.toHaveBeenCalled();
  });

  it("renders collection controls without approval or rejection actions", async () => {
    render(<AdminPanel />);

    expect(await screen.findByText(/active collections/i)).toBeInTheDocument();
    expect(screen.queryByText(/^approve$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^reject$/i)).not.toBeInTheDocument();
    expect(screen.getByText(/manage categories/i)).toBeInTheDocument();
  });

  it("renders the Links and sitemap card with matching buttons", async () => {
    render(<AdminPanel />);

    expect(await screen.findByRole("heading", { name: "Links and sitemap" })).toBeInTheDocument();
    const linksCard = screen.getByRole("heading", { name: "Links and sitemap" }).closest(".admin-panel-card");
    expect(within(linksCard).getByRole("button", { name: "Links" })).toBeInTheDocument();
    expect(within(linksCard).getByRole("button", { name: "Sitemap" })).toBeInTheDocument();
  });

  it("sets social links through the add-link dialog without expanding the card", async () => {
    render(<AdminPanel />);

    const socialCard = screen.getByRole("heading", { name: "Social Media" }).closest(".admin-panel-card");
    expect(socialCard).toHaveClass("admin-panel-card");

    fireEvent.change(within(socialCard).getByRole("combobox", { name: "Social media platform 4" }), {
      target: { value: "linkedin" },
    });
    fireEvent.click(within(socialCard).getByRole("button", { name: "Add link for LinkedIn" }));

    const dialog = screen.getByRole("dialog", { name: "Set social media link" });
    fireEvent.change(within(dialog).getByLabelText("Link URL"), {
      target: { value: "https://www.linkedin.com/company/example" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Set link" }));

    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem("footer-social-links"))[3]).toEqual({
        platform: "linkedin",
        url: "https://www.linkedin.com/company/example",
      });
    });
    expect(within(socialCard).getByRole("button", { name: "Edit link for LinkedIn" })).toBeInTheDocument();
    expect(socialCard).toHaveClass("admin-panel-card");
  });

  it.each([
    ["links", "Links"],
    ["sitemap", "Sitemap"],
  ])("renders the dedicated %s page", async (tab, heading) => {
    useLocation.mockReturnValue({ search: `?tab=${tab}` });

    render(<AdminPanel />);

    expect(await screen.findByRole("heading", { name: heading, level: 2 })).toBeInTheDocument();
    const backButton = screen.getByRole("button", { name: "Back to Controls" });
    expect(screen.getByRole("heading", { name: heading, level: 2 }).parentElement).toContainElement(backButton);
    expect(backButton.parentElement).toHaveStyle({ display: "flex", justifyContent: "space-between" });
    expect(screen.queryByText(/total assets:/i)).not.toBeInTheDocument();
    if (tab === "sitemap") {
      const pageHeading = screen.getByRole("heading", { name: heading, level: 2 });
      const page = screen.getByRole("region", { name: "Sitemap page" });
      const cards = page.querySelectorAll(".admin-panel-card");
      expect(cards).toHaveLength(3);
      expect(page).toHaveStyle({ display: "flex", flexWrap: "wrap", gap: "20px" });
      cards.forEach((card) => {
        expect(card.style.flexBasis).toBe("calc(33.333% - 14px)");
      });
    }
  });

  it("loads and saves the sitemap file path", async () => {
    const sitemapFilePath = "/srv/www/public";
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/sitemap-settings")) {
        return Promise.resolve({ data: { path: `${sitemapFilePath}/sitemap.xml` } });
      }
      return Promise.resolve({ data: [] });
    });
    axios.put.mockResolvedValue({ data: { path: sitemapFilePath } });
    useLocation.mockReturnValue({ search: "?tab=sitemap" });

    render(<AdminPanel />);

    const pathInput = await screen.findByRole("textbox", { name: "Sitemap storage directory" });
    expect(pathInput).toHaveValue(sitemapFilePath);
    fireEvent.click(screen.getByRole("button", { name: "Save Sitemap Path" }));

    await waitFor(() => expect(axios.put).toHaveBeenCalledWith(
      expect.stringContaining("/admin/sitemap-settings"),
      { path: sitemapFilePath },
      expect.objectContaining({ headers: expect.any(Object) })
    ));
    expect(await screen.findByRole("status")).toHaveTextContent("Sitemap path saved.");
  });

  it("retries a failed sitemap settings GET without repeating mutations", async () => {
    let settingsAttempt = 0;
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/sitemap-settings")) {
        settingsAttempt += 1;
        return settingsAttempt === 1
          ? Promise.reject(new Error("Unavailable"))
          : Promise.resolve({ data: { path: "/srv/www/public" } });
      }
      return Promise.resolve({ data: [] });
    });
    useLocation.mockReturnValue({ pathname: "/admin", search: "?tab=sitemap" });

    render(<AdminPanel />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load the sitemap path.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByLabelText("Sitemap storage directory")).toHaveValue("/srv/www/public"));
    expect(settingsAttempt).toBe(2);
    expect(axios.post).not.toHaveBeenCalled();
    expect(axios.put).not.toHaveBeenCalled();
    expect(axios.patch).not.toHaveBeenCalled();
    expect(axios.delete).not.toHaveBeenCalled();
  });

  it("browses server folders and selects the directory path only", async () => {
    axios.get.mockImplementation((url, config) => {
      if (url.includes("/admin/sitemap-settings")) {
        return Promise.resolve({ data: { path: "" } });
      }
      if (url.includes("/admin/assets/folder-browser")) {
        if (config?.params?.path === "/srv/www") {
          return Promise.resolve({
            data: {
              path: "/srv/www",
              parentPath: "/srv",
              directories: [{ name: "public", path: "/srv/www/public" }],
            },
          });
        }
        return Promise.resolve({ data: { roots: [{ name: "Web Root", path: "/srv/www" }] } });
      }
      return Promise.resolve({ data: [] });
    });
    useLocation.mockReturnValue({ search: "?tab=sitemap" });

    render(<AdminPanel />);

    fireEvent.click(await screen.findByRole("button", { name: "Browse" }));
    fireEvent.click(await screen.findByRole("button", { name: /Web Root/ }));
    fireEvent.click(await screen.findByRole("button", { name: /public/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Use this folder" }));

    expect(screen.getByRole("textbox", { name: "Sitemap storage directory" })).toHaveValue("/srv/www/public");
  });

  it("shows the SERVER error when deleting a pending asset fails", async () => {
    useLocation.mockReturnValue({ search: "?status=pending" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/images")) {
        return Promise.resolve({ data: [{ id: 262, title: "demonew", status: "pending", filename: "demonew.jpg" }] });
      }
      if (url.includes("/images?limit=1000&page=1")) {
        return Promise.resolve({ data: { images: [] } });
      }
      return Promise.resolve({ data: [] });
    });
    axios.delete.mockRejectedValue({
      response: { status: 503, data: { error: "SERVER asset lifecycle service is unavailable." } },
    });
    const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);
    const toastErrorSpy = jest.spyOn(toast, "error").mockImplementation(() => {});

    render(<AdminPanel />);

    fireEvent.click(await screen.findByRole("button", { name: "Active" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Select Status" }), {
      target: { value: "delete" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() => expect(axios.delete).toHaveBeenCalledWith(
      expect.stringContaining("/images/262"),
      expect.objectContaining({ headers: expect.any(Object) })
    ));
    await waitFor(() => expect(toastErrorSpy).toHaveBeenCalledWith("SERVER asset lifecycle service is unavailable."));

    confirmSpy.mockRestore();
    toastErrorSpy.mockRestore();
  });

  it("shows the SERVER error when approving a pending asset fails", async () => {
    useLocation.mockReturnValue({ search: "?status=pending" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/images")) {
        return Promise.resolve({ data: [{ id: 262, title: "demonew", status: "pending", filename: "demonew.jpg" }] });
      }
      if (url.includes("/images?limit=1000&page=1")) {
        return Promise.resolve({ data: { images: [] } });
      }
      return Promise.resolve({ data: [] });
    });
    axios.put.mockRejectedValue({
      response: { status: 401, data: { error: "The SERVER rejected this backend token." } },
    });
    const toastErrorSpy = jest.spyOn(toast, "error").mockImplementation(() => {});

    render(<AdminPanel />);

    fireEvent.click(await screen.findByRole("button", { name: "Active" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() => expect(axios.put).toHaveBeenCalledWith(
      expect.stringContaining("/admin/approve/262"),
      {},
      expect.objectContaining({ headers: expect.any(Object) })
    ));
    await waitFor(() => expect(toastErrorSpy).toHaveBeenCalledWith("The SERVER rejected this backend token."));

    toastErrorSpy.mockRestore();
  });

  it("uses dark-friendly styling in the controls tab when dark mode is active", async () => {
    document.body.classList.add("dark-mode");
    useLocation.mockReturnValue({ search: "?tab=controls" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/categories")) {
        return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      }
      if (url.includes("/admin/collections")) {
        return Promise.resolve({ data: [{ id: 1, name: "Nature" }] });
      }
      return Promise.resolve({ data: [] });
    });

    render(<AdminPanel />);

    const manageCard = (await screen.findByRole("heading", { name: /manage categories/i })).closest(".admin-panel-card");
    expect(manageCard).toHaveStyle({ color: "#f8fafc" });
    expect(screen.getByPlaceholderText(/new category name/i)).toHaveStyle({ background: "#0f172a", color: "#f8fafc" });

    document.body.classList.remove("dark-mode");
  });

  it("shows category management controls in the controls tab", async () => {
    render(<AdminPanel />);

    expect(await screen.findByText(/manage categories/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/new category name/i)).toBeInTheDocument();
  });

  it("shows no category preview in the manage categories card when no categories exist", async () => {
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/categories")) {
        return Promise.resolve({ data: [] });
      }
      return Promise.resolve({ data: [] });
    });

    render(<AdminPanel />);

    expect(await screen.findByRole("heading", { name: /manage categories/i })).toBeInTheDocument();
    expect(screen.queryByText(/images/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no categories yet/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/unnamed category/i)).not.toBeInTheDocument();
  });

  it("closes category dialogs from their close buttons and backdrops", async () => {
    render(<AdminPanel />);

    fireEvent.click(await screen.findByRole("button", { name: /view categories/i }));
    const categoriesDialog = screen.getByRole("dialog", { name: /categories/i });
    fireEvent.click(within(categoriesDialog).getByRole("button", { name: /modify/i }));

    const editDialog = screen.getByRole("dialog", { name: /edit category/i });
    fireEvent.click(within(editDialog).getByRole("button", { name: /close edit category/i }));
    expect(screen.queryByRole("dialog", { name: /edit category/i })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: /categories/i })).toBeInTheDocument();

    fireEvent.click(within(categoriesDialog).getByRole("button", { name: /modify/i }));
    fireEvent.click(screen.getByRole("dialog", { name: /edit category/i }));
    expect(screen.queryByRole("dialog", { name: /edit category/i })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: /categories/i })).toBeInTheDocument();

    fireEvent.click(within(categoriesDialog).getByRole("button", { name: /close categories/i }));
    expect(screen.queryByRole("dialog", { name: /categories/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /view categories/i }));
    const reopenedCategoriesDialog = screen.getByRole("dialog", { name: /categories/i });
    fireEvent.click(reopenedCategoriesDialog);
    expect(screen.queryByRole("dialog", { name: /categories/i })).not.toBeInTheDocument();
  });

  it("closes the collection dialog from its close button or backdrop", async () => {
    render(<AdminPanel />);

    const collectionsCard = (await screen.findByRole("heading", { name: /active collections/i })).closest(".admin-panel-card");
    fireEvent.click(within(collectionsCard).getByRole("button", { name: /view collections/i }));
    let collectionsDialog = await screen.findByRole("dialog", { name: /collections/i });
    const collectionsPanel = collectionsDialog.querySelector("h3").parentElement.parentElement;
    fireEvent.click(within(collectionsPanel).getByRole("button", { name: /close collections/i }));
    expect(screen.queryByRole("dialog", { name: /collections/i })).not.toBeInTheDocument();

    fireEvent.click(within(collectionsCard).getByRole("button", { name: /view collections/i }));
    collectionsDialog = await screen.findByRole("dialog", { name: /collections/i });
    fireEvent.click(collectionsDialog);
    expect(screen.queryByRole("dialog", { name: /collections/i })).not.toBeInTheDocument();
  });

  it("shows success toasts after adding and deleting a collection", async () => {
    const successToast = jest.spyOn(toast, "success");
    render(<AdminPanel />);

    fireEvent.change(screen.getByPlaceholderText(/new collection name/i), { target: { value: "Travel" } });
    fireEvent.click(screen.getByRole("button", { name: /^add collection$/i }));
    await waitFor(() => expect(successToast).toHaveBeenCalledWith("Collection added successfully."));

    const collectionsCard = screen.getByRole("heading", { name: /active collections/i }).closest(".admin-panel-card");
    fireEvent.click(within(collectionsCard).getByRole("button", { name: /view collections/i }));
    const collectionsDialog = await screen.findByRole("dialog", { name: /collections/i });
    fireEvent.click(within(collectionsDialog).getAllByRole("button", { name: /delete/i })[0]);
    await waitFor(() => expect(successToast).toHaveBeenCalledWith("Collection deleted successfully."));

    successToast.mockRestore();
  });

  it("shows a success toast after saving a category rename", async () => {
    axios.put.mockResolvedValue({ data: { id: 1, name: "Abstracts" } });
    const successToast = jest.spyOn(toast, "success");
    render(<AdminPanel />);

    fireEvent.click(await screen.findByRole("button", { name: /view categories/i }));
    const categoriesDialog = screen.getByRole("dialog", { name: /categories/i });
    fireEvent.click(within(categoriesDialog).getByRole("button", { name: /modify/i }));
    fireEvent.change(screen.getByRole("textbox", { name: /category name/i }), { target: { value: "Abstracts" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(successToast).toHaveBeenCalledWith("Category saved successfully."));
    expect(await screen.findByText("Abstracts")).toBeInTheDocument();
    successToast.mockRestore();
  });

  it("shows success toasts after adding and deleting a category", async () => {
    const successToast = jest.spyOn(toast, "success");
    render(<AdminPanel />);

    fireEvent.change(screen.getByPlaceholderText(/new category name/i), { target: { value: "Travel" } });
    fireEvent.click(screen.getByRole("button", { name: /add category/i }));
    await waitFor(() => expect(successToast).toHaveBeenCalledWith("Category added successfully."));

    fireEvent.click(screen.getByRole("button", { name: /view categories/i }));
    const categoriesDialog = screen.getByRole("dialog", { name: /categories/i });
    fireEvent.click(within(categoriesDialog).getAllByRole("button", { name: /delete/i })[0]);
    await waitFor(() => expect(successToast).toHaveBeenCalledWith("Category deleted successfully."));

    successToast.mockRestore();
  });

  it("renders the admin dashboard overview tab", async () => {
    useLocation.mockReturnValue({ search: "?tab=admin_dashboard" });
    render(<AdminPanel />);

    expect(await screen.findByRole("heading", { name: /^dashboard$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^dashboard$/i })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: /contributor approval/i }));
    expect(await screen.findByRole("heading", { name: /contributor approval/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /customer approval/i }));
    expect(await screen.findByRole("heading", { name: /customer approval/i })).toBeInTheDocument();
  });

  it("shows request ages and lets admins view, approve, or reject pending users", async () => {
    const createdAt = new Date(Date.now() - (3.5 * 60 * 60 * 1000)).toISOString();
    window.history.pushState({}, "", "/admin?tab=admin_dashboard");
    localStorage.setItem("userRole", "admin");
    useLocation.mockReturnValue({ pathname: "/admin", search: "?tab=admin_dashboard" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/users")) {
        return Promise.resolve({ data: [
          { id: 21, full_name: "Creator Request", username: "creator-request", email: "creator@example.com", role: "contributor", status: "pending", created_at: createdAt },
          { id: 22, full_name: "Customer Request", username: "customer-request", email: "customer@example.com", role: "customer", status: "pending", created_at: createdAt }
        ] });
      }
      if (url.includes("/admin/images")) return Promise.resolve({ data: [] });
      if (url.includes("/admin/collections")) return Promise.resolve({ data: [] });
      return Promise.resolve({ data: [] });
    });
    axios.put.mockResolvedValue({ data: { status: "active" } });

    render(<AdminPanel />);
    fireEvent.click(await screen.findByRole("button", { name: /contributor approval/i }));
    expect(await screen.findByText("Contributor registration request")).toBeInTheDocument();
    expect(screen.getByText("A new contributor account is awaiting approval.")).toBeInTheDocument();
    expect(await screen.findByText("Requested 3h ago")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View Creator Request" }));
    expect(screen.getByRole("dialog", { name: /contributor registration request/i })).toHaveTextContent("creator@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Close user details" }));
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    await waitFor(() => {
      expect(axios.put).toHaveBeenCalledWith(
        expect.stringContaining("/admin/users/21/reject"),
        {},
        expect.objectContaining({ headers: expect.any(Object) })
      );
    });
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "View Creator Request" })).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /customer approval/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    await waitFor(() => {
      expect(axios.put).toHaveBeenCalledWith(
        expect.stringContaining("/admin/users/22/approve"),
        {},
        expect.objectContaining({ headers: expect.any(Object) })
      );
    });
  });

  it("restores the selected dashboard section on refresh and resets after leaving", async () => {
    window.history.pushState({}, "", "/admin?tab=admin_dashboard");
    useLocation.mockReturnValue({ pathname: "/admin", search: "?tab=admin_dashboard" });
    const originalGetEntriesByType = window.performance.getEntriesByType;
    const navigationEntries = jest.fn().mockReturnValue([{ type: "reload" }]);
    Object.defineProperty(window.performance, "getEntriesByType", {
      configurable: true,
      value: navigationEntries,
    });

    try {
      const firstRender = render(<AdminPanel />);
      fireEvent.click(screen.getByRole("button", { name: /contributor approval/i }));
      expect(await screen.findByRole("heading", { name: /contributor approval/i })).toBeInTheDocument();
      expect(sessionStorage.getItem("admin-dashboard-section")).toBe("contributor-approval");
      firstRender.unmount();

      const secondRender = render(<AdminPanel />);
      expect(await screen.findByRole("heading", { name: /contributor approval/i })).toBeInTheDocument();

      window.history.pushState({}, "", "/home");
      expect(sessionStorage.getItem("admin-dashboard-section")).toBe("contributor-approval");
      secondRender.unmount();
      expect(sessionStorage.getItem("admin-dashboard-section")).toBeNull();
      navigationEntries.mockReturnValue([{ type: "navigate" }]);
      window.history.pushState({}, "", "/admin?tab=admin_dashboard");
      useLocation.mockReturnValue({ pathname: "/admin", search: "?tab=admin_dashboard" });
      render(<AdminPanel />);
      expect(await screen.findByRole("heading", { name: /^dashboard$/i })).toBeInTheDocument();
      expect(sessionStorage.getItem("admin-dashboard-section")).toBeNull();
    } finally {
      if (originalGetEntriesByType) {
        Object.defineProperty(window.performance, "getEntriesByType", {
          configurable: true,
          value: originalGetEntriesByType,
        });
      } else {
        delete window.performance.getEntriesByType;
      }
    }
  });

  it("shows contributor and customer detail cards in the controls tab", async () => {
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/users")) {
        return Promise.resolve({ data: [
          { id: 1, full_name: "Contributor One", username: "contributor1", email: "creator@example.com", role: "contributor", status: "active" },
          { id: 2, full_name: "Customer One", username: "customer1", email: "buyer@example.com", role: "customer", status: "pending" }
        ] });
      }
      if (url.includes("/admin/categories")) return Promise.resolve({ data: [] });
      if (url.includes("/admin/collections")) return Promise.resolve({ data: [] });
      return Promise.resolve({ data: [] });
    });

    render(<AdminPanel />);

    expect(await screen.findByRole("heading", { name: /contributor details/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /customer details/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^view contributors$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^contributor details$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^tax forms$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^customer details$/i })).toBeInTheDocument();
  });

  it("shows database and assets connection cards in the controls tab", async () => {
    render(<AdminPanel />);

    expect(await screen.findByRole("heading", { name: /database connection/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /assets connection/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^database$/i }));
    expect(window.location.href).toContain("tab=controls_database");

    fireEvent.click(screen.getByRole("button", { name: /^assets$/i }));
    expect(window.location.href).toContain("tab=controls_assets");
  });

  it("shows the actual upload folder path on the assets controls page", async () => {
    useLocation.mockReturnValue({ search: "?tab=controls_assets" });
    const serverCardCounts = { assets: 1, thumbnails: 1 };
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/assets/location")) {
        return Promise.resolve({ data: {
          uploadFolderPath: "/Users/gfxunlimit/Documents/stocksite/backend/uploads",
          folderSizeBytes: 783 * 1024 * 1024,
          thumbnailFolderPath: "/Volumes/GFXunlimitThumbnails",
          thumbnailFolderSizeBytes: 2 * 1024 * 1024 * 1024,
          driveFreeBytes: 217 * 1024 * 1024 * 1024,
          connections: { assets: true, thumbnails: true }
        } });
      }
      return Promise.resolve({ data: [] });
    });
    axios.put.mockImplementation((_url, payload) => {
      if (payload?.type && Number.isInteger(payload.count)) {
        serverCardCounts[payload.type] = payload.count;
      }
      return Promise.resolve({ data: { cardCounts: { ...serverCardCounts } } });
    });

    const { unmount } = render(<AdminPanel />);

    expect(await screen.findByText("/Users/gfxunlimit/Documents/stocksite/backend/uploads")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back to Controls" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();
    expect(screen.queryByRole("menu", { name: "Add storage location" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByRole("menu", { name: "Add storage location" })).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu", { name: "Add storage location" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Assets (1/99)" }));
    expect(await screen.findByRole("heading", { name: "Assets (2)" })).toBeInTheDocument();
    const additionalAssetsCard = screen.getByRole("heading", { name: "Assets (2)" }).closest(".admin-panel-card");
    expect(within(additionalAssetsCard).getByText("Original asset storage")).toBeInTheDocument();
    expect(within(additionalAssetsCard).getByText("Folder size")).toBeInTheDocument();
    expect(within(additionalAssetsCard).getByText("Drive free")).toBeInTheDocument();
    expect(within(additionalAssetsCard).getByLabelText("Assets 2 folder path")).toBeEmptyDOMElement();
    expect(within(additionalAssetsCard).getByLabelText("Assets 2 folder size")).toBeEmptyDOMElement();
    expect(within(additionalAssetsCard).queryByRole("button", { name: "Choose folder" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByRole("menuitem", { name: "Assets (2/99)" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "Thumbnails (1/9)" }));
    expect(await screen.findByRole("heading", { name: "Thumbnails (2)" })).toBeInTheDocument();
    const additionalThumbnailsCard = screen.getByRole("heading", { name: "Thumbnails (2)" }).closest(".admin-panel-card");
    const firstAssetCard = screen.getByRole("heading", { name: /^assets \(1\)$/i }).closest(".admin-panel-card");
    const firstThumbnailCard = screen.getByRole("heading", { name: /^thumbnails \(1\)$/i }).closest(".admin-panel-card");
    const storageGrid = firstAssetCard.closest(".storage-connections-grid");
    expect(storageGrid).toHaveStyle({ display: "grid", gridAutoRows: "350px" });
    expect([firstAssetCard, firstThumbnailCard, additionalAssetsCard, additionalThumbnailsCard].map((card) => card.style.width)).toEqual(["100%", "100%", "100%", "100%"]);
    expect([firstAssetCard, firstThumbnailCard, additionalAssetsCard, additionalThumbnailsCard].map((card) => card.style.height)).toEqual(["350px", "350px", "350px", "350px"]);
    expect(firstAssetCard.compareDocumentPosition(firstThumbnailCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(firstThumbnailCard.compareDocumentPosition(additionalAssetsCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(additionalAssetsCard.compareDocumentPosition(additionalThumbnailsCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(Number(additionalAssetsCard.style.order)).toBeGreaterThan(Number(firstThumbnailCard.style.order));
    expect(Number(additionalThumbnailsCard.style.order)).toBeGreaterThan(Number(additionalAssetsCard.style.order));
    expect(within(additionalThumbnailsCard).getByText("Preview image storage")).toBeInTheDocument();
    expect(within(additionalThumbnailsCard).getByText("Folder size")).toBeInTheDocument();
    expect(within(additionalThumbnailsCard).getByLabelText("Thumbnails 2 folder path")).toBeEmptyDOMElement();
    expect(within(additionalThumbnailsCard).getByLabelText("Thumbnails 2 folder size")).toBeEmptyDOMElement();
    expect(within(additionalThumbnailsCard).queryByRole("button", { name: "Choose folder" })).not.toBeInTheDocument();
    expect(screen.getByText("783.00 MB")).toBeInTheDocument();
    expect(screen.getByText("233.00 GB")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^assets \(1\)$/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^thumbnails \(1\)$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Default Assets (1)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Default Thumbnails (1)" })).toBeInTheDocument();
    expect(screen.getByText("/Volumes/GFXunlimitThumbnails")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Browse to choose an Assets folder")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Browse to choose a Thumbnails folder")).toBeInTheDocument();
    expect(screen.getByLabelText("Assets folder")).toHaveValue("");
    expect(screen.getByLabelText("Thumbnails folder")).toHaveValue("");
    expect(screen.getByText("2.00 GB")).toBeInTheDocument();

    unmount();
    render(<AdminPanel />);

    expect(await screen.findByRole("heading", { name: "Assets (2)" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Thumbnails (2)" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByRole("menuitem", { name: "Assets (2/99)" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Thumbnails (2/9)" })).toBeInTheDocument();
  });

  it("uses server storage-card counts instead of each browser's local count", async () => {
    useLocation.mockReturnValue({ search: "?tab=controls_assets" });
    localStorage.setItem("admin-assets-connection-card-count", "2");
    localStorage.setItem("admin-thumbnails-connection-card-count", "1");
    axios.get.mockImplementation((url) => url.includes("/admin/assets/location")
      ? Promise.resolve({ data: {
        connections: { assets: true, thumbnails: true },
        cardCounts: { assets: 4, thumbnails: 3 },
        assetLocations: [{ id: "assets-one", label: "Asset 1", path: "/assets-one" }],
        thumbnailLocations: [{ id: "thumbnails-one", label: "Thumbnail 1", path: "/thumbnails-one" }],
      } })
      : Promise.resolve({ data: [] }));

    render(<AdminPanel />);

    expect(await screen.findByRole("heading", { name: "Assets (4)" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Thumbnails (3)" })).toBeInTheDocument();
    expect(localStorage.getItem("admin-assets-connection-card-count")).toBe("4");
    expect(localStorage.getItem("admin-thumbnails-connection-card-count")).toBe("3");
  });

  it("loads detailed folder sizes for every configured storage card", async () => {
    useLocation.mockReturnValue({ search: "?tab=controls_assets" });
    const assetLocations = [
      { id: "assets-one", label: "Asset 1", path: "/assets-one" },
      { id: "assets-two", label: "Asset 2", path: "/assets-two" },
    ];
    const thumbnailLocations = [
      { id: "thumbnails-one", label: "Thumbnail 1", path: "/thumbnails-one" },
      { id: "thumbnails-two", label: "Thumbnail 2", path: "/thumbnails-two" },
    ];
    axios.get.mockImplementation((url) => url.includes("/admin/assets/location")
      ? Promise.resolve({ data: {
        uploadFolderPath: "/assets-one",
        thumbnailFolderPath: "/thumbnails-one",
        folderSizeBytes: 10 * 1024 * 1024,
        thumbnailFolderSizeBytes: 5 * 1024 * 1024,
        assetLocations: assetLocations.map((location, index) => ({
          ...location,
          folderSizeBytes: (index + 1) * 10 * 1024 * 1024,
          driveFreeBytes: index === 0 ? 221_967_572_992 : 100 * 1024 * 1024,
        })),
        thumbnailLocations: thumbnailLocations.map((location, index) => ({
          ...location,
          folderSizeBytes: (index + 1) * 5 * 1024 * 1024,
          driveFreeBytes: 100 * 1024 * 1024,
        })),
        connections: {
          assets: true,
          thumbnails: true,
          assetLocations,
          thumbnailLocations,
          defaultAssetLocationId: "assets-one",
          defaultThumbnailLocationId: "thumbnails-one",
        },
      } })
      : Promise.resolve({ data: [] }));

    render(<AdminPanel />);

    const secondAssetsHeading = await screen.findByRole("heading", { name: "Assets (2)" });
    const firstAssetsHeading = screen.getByRole("heading", { name: "Assets (1)" });
    const secondThumbnailsHeading = await screen.findByRole("heading", { name: "Thumbnails (2)" });
    const firstThumbnailsHeading = screen.getByRole("heading", { name: "Thumbnails (1)" });
    const secondAssetsCard = secondAssetsHeading.closest(".admin-panel-card");
    const firstAssetsCard = firstAssetsHeading.closest(".admin-panel-card");
    const secondThumbnailsCard = secondThumbnailsHeading.closest(".admin-panel-card");
    const firstThumbnailsCard = firstThumbnailsHeading.closest(".admin-panel-card");
    expect(within(secondAssetsCard).getByLabelText("Assets 2 folder size")).toHaveTextContent("20.00 MB");
    expect(within(firstAssetsCard).getByText("Drive free").parentElement).toHaveTextContent("221.97 GB");
    expect(within(secondAssetsCard).getByLabelText("Assets 2 drive free")).toHaveTextContent("104.86 MB");
    expect(within(secondThumbnailsCard).getByLabelText("Thumbnails 2 folder size")).toHaveTextContent("10.00 MB");
    expect(within(secondThumbnailsCard).getByLabelText("Thumbnails 2 drive free")).toHaveTextContent("104.86 MB");
    expect(within(firstThumbnailsCard).getByLabelText("Thumbnails 1 drive free")).toHaveTextContent("104.86 MB");
  });

  it("deletes an additional storage card and its registered path", async () => {
    useLocation.mockReturnValue({ search: "?tab=controls_assets" });
    const assetLocations = [
      { id: "assets-one", label: "Asset 1", path: "/assets-one", folderSizeBytes: 10, driveFreeBytes: 100 },
      { id: "assets-two", label: "Asset 2", path: "/assets-two", folderSizeBytes: 20, driveFreeBytes: 100 },
    ];
    const thumbnailLocations = [
      { id: "thumbnails-one", label: "Thumbnail 1", path: "/thumbnails-one", folderSizeBytes: 5, driveFreeBytes: 100 },
    ];
    const locationResponse = {
      uploadFolderPath: "/assets-one",
      thumbnailFolderPath: "/thumbnails-one",
      assetLocations,
      thumbnailLocations,
      connections: {
        assetLocations,
        thumbnailLocations,
        defaultAssetLocationId: "assets-one",
        defaultThumbnailLocationId: "thumbnails-one",
      },
    };
    axios.get.mockImplementation((url) => (
      url.includes("/admin/assets/location")
        ? Promise.resolve({ data: locationResponse })
        : Promise.resolve({ data: [] })
    ));
    axios.delete.mockResolvedValue({
      data: {
        connections: {
          ...locationResponse.connections,
          assetLocations: [assetLocations[0]],
        },
        cardConnections: { assets: {}, thumbnails: {} },
      },
    });

    render(<AdminPanel />);

    expect(await screen.findByRole("heading", { name: "Assets (2)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete Assets (2)" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete Assets (1)" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete Assets (2)" }));

    await waitFor(() => {
      expect(axios.delete).toHaveBeenCalledWith(
        expect.stringContaining("/admin/assets/locations"),
        {
          data: { type: "assets", locationId: "assets-two", locationNumber: 2 },
          headers: expect.any(Object),
        }
      );
    });
    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "Assets (2)" })).not.toBeInTheDocument();
      expect(localStorage.getItem("admin-assets-connection-card-count")).toBe("1");
    });
    expect(screen.getByText("/assets-one")).toBeInTheDocument();
  });

  it("updates and displays asset storage connection status from the toggle", async () => {
    useLocation.mockReturnValue({ search: "?tab=controls_assets" });
    axios.get.mockImplementation((url) => url.includes("/admin/assets/location")
      ? Promise.resolve({ data: { uploadFolderPath: "/assets", thumbnailFolderPath: "/thumbnails", connections: { assets: true, thumbnails: true } } })
      : Promise.resolve({ data: [] }));
    axios.put.mockResolvedValue({ data: { connections: { assets: false, thumbnails: true } } });

    render(<AdminPanel />);

    fireEvent.click(await screen.findByRole("button", { name: /^disconnect assets$/i }));

    await waitFor(() => {
      expect(axios.put).toHaveBeenCalledWith(
        expect.stringContaining("/admin/assets/connections"),
        { assets: false },
        expect.objectContaining({ headers: expect.any(Object) })
      );
    });
    expect(await screen.findByRole("button", { name: /^connect assets$/i })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("img", { name: "Assets disconnected" })).toHaveStyle({ color: "#dc2626" });
    expect(screen.getByRole("img", { name: "Thumbnails connected" })).toHaveStyle({ color: "#16a34a" });
  });

  it("saves card-specific connection toggles and shows success toasts", async () => {
    useLocation.mockReturnValue({ search: "?tab=controls_assets" });
    axios.get.mockImplementation((url) => url.includes("/admin/assets/location")
      ? Promise.resolve({ data: {
        uploadFolderPath: "/assets",
        thumbnailFolderPath: "/thumbnails",
        connections: { assets: true, thumbnails: true },
        cardConnections: { assets: {}, thumbnails: {} },
      } })
      : Promise.resolve({ data: [] }));
    axios.put.mockResolvedValue({
      data: { cardConnections: { assets: { "1": false }, thumbnails: {} } },
    });
    const toastSuccessSpy = jest.spyOn(toast, "success").mockImplementation(() => {});

    render(<AdminPanel />);

    fireEvent.click(await screen.findByRole("button", { name: "Disconnect Assets (1)" }));

    await waitFor(() => {
      expect(axios.put).toHaveBeenCalledWith(
        expect.stringContaining("/admin/assets/card-connections"),
        { storage: "assets", locationNumber: 1, connected: false },
        expect.objectContaining({ headers: expect.any(Object) })
      );
    });
    expect(await screen.findByRole("button", { name: "Connect Assets (1)" })).toHaveAttribute("aria-pressed", "false");
    expect(toastSuccessSpy).toHaveBeenCalledWith("Assets (1) marked disconnected.");
    toastSuccessSpy.mockRestore();
  });

  it("shows a hover-only Default button and routes new uploads to the selected asset location", async () => {
    useLocation.mockReturnValue({ search: "?tab=controls_assets" });
    const locationData = {
      uploadFolderPath: "/assets-one",
      thumbnailFolderPath: "/thumbnails-one",
      connections: {
        assets: true,
        thumbnails: true,
        assetLocations: [
          { id: "assets-one", label: "Asset 1", path: "/assets-one", folderSizeBytes: 10, driveFreeBytes: 100 },
          { id: "assets-two", label: "Asset 2", path: "/assets-two", folderSizeBytes: 20, driveFreeBytes: 200 },
        ],
        thumbnailLocations: [
          { id: "thumbnails-one", label: "Thumbnail 1", path: "/thumbnails-one", folderSizeBytes: 5, driveFreeBytes: 100 },
          { id: "thumbnails-two", label: "Thumbnail 2", path: "/thumbnails-two", folderSizeBytes: 6, driveFreeBytes: 200 },
        ],
        defaultAssetLocationId: "assets-one",
        defaultThumbnailLocationId: "thumbnails-one",
      },
    };
    axios.get.mockImplementation((url) => url.includes("/admin/assets/location")
      ? Promise.resolve({ data: locationData })
      : Promise.resolve({ data: [] }));
    axios.put.mockImplementation((_url, payload) => {
      if (payload.type === "assets") {
        locationData.connections.assetRoot = "/assets-two";
        locationData.connections.defaultAssetLocationId = "assets-two";
      } else {
        locationData.connections.thumbnailRoot = "/thumbnails-two";
        locationData.connections.defaultThumbnailLocationId = "thumbnails-two";
      }
      return Promise.resolve({
        data: { connections: locationData.connections, backgroundQueueReady: true },
      });
    });
    const toastSuccessSpy = jest.spyOn(toast, "success").mockImplementation(() => {});

    render(<AdminPanel />);

    const defaultButton = await screen.findByRole("button", { name: "Default Assets (2)" });
    expect(defaultButton).toHaveClass("storage-location-default-button");
    expect(screen.getByLabelText("Assets 2 folder path")).toHaveTextContent("/assets-two");
    fireEvent.click(defaultButton);

    await waitFor(() => {
      expect(axios.put).toHaveBeenCalledWith(
        expect.stringContaining("/admin/assets/locations/default"),
        { type: "assets", locationId: "assets-two" },
        expect.objectContaining({ headers: expect.any(Object) })
      );
    });
    expect(await screen.findByRole("status", { name: "Assets (2) active default" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Default Assets (2)" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Default Assets (1)" })).toBeInTheDocument();
    expect(toastSuccessSpy).toHaveBeenCalledWith("Assets default location selected for new uploads.");

    fireEvent.click(screen.getByRole("button", { name: "Default Thumbnails (2)" }));
    await waitFor(() => {
      expect(axios.put).toHaveBeenCalledWith(
        expect.stringContaining("/admin/assets/locations/default"),
        { type: "thumbnails", locationId: "thumbnails-two" },
        expect.objectContaining({ headers: expect.any(Object) })
      );
    });
    expect(await screen.findByRole("status", { name: "Thumbnails (2) active default" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Default Thumbnails (2)" })).not.toBeInTheDocument();
    expect(toastSuccessSpy).toHaveBeenCalledWith("Thumbnails default location selected for new uploads.");
    toastSuccessSpy.mockRestore();
  });

  it("browses and saves separate storage folders", async () => {
    useLocation.mockReturnValue({ search: "?tab=controls_assets" });
    axios.get.mockImplementation((url, config = {}) => {
      if (url.includes("/admin/assets/folder-browser")) {
        if (config.params?.path === "/storage") {
          return Promise.resolve({ data: {
            path: "/storage",
            parentPath: null,
            directories: [
              { name: "assets-new", path: "/storage/assets-new" },
              { name: "thumbnails-new", path: "/storage/thumbnails-new" },
            ],
          } });
        }
        if (config.params?.path) {
          return Promise.resolve({ data: { path: config.params.path, parentPath: "/storage", directories: [] } });
        }
        return Promise.resolve({ data: { roots: [{ name: "Mounted volume", path: "/storage" }] } });
      }
      if (url.includes("/admin/assets/location")) {
        return Promise.resolve({ data: {
          uploadFolderPath: "/assets-new",
          thumbnailFolderPath: "/thumbnails-new",
          folderSizeBytes: 0,
          thumbnailFolderSizeBytes: 0,
          driveFreeBytes: 0,
          connections: { assets: true, thumbnails: true },
        } });
      }
      return Promise.resolve({ data: [] });
    });
    axios.put.mockResolvedValue({ data: { assetRoot: "/assets-new", thumbnailRoot: "/thumbnails-new" } });

    render(<AdminPanel />);

    fireEvent.click(await screen.findByRole("button", { name: "Browse Assets folder" }));
    expect(screen.getByRole("dialog").parentElement).toHaveStyle({ zIndex: "10001" });
    expect(screen.getByRole("dialog")).toHaveStyle({ gridTemplateRows: "auto auto minmax(0, 1fr)" });
    expect(screen.getByRole("dialog").lastElementChild).toHaveStyle({ minHeight: "0", overflowY: "auto" });
    fireEvent.click(await screen.findByRole("button", { name: /Mounted volume/ }));
    await screen.findByText("/storage");
    fireEvent.click(screen.getByRole("button", { name: "↑ Up" }));
    fireEvent.click(await screen.findByRole("button", { name: /Mounted volume/ }));
    await screen.findByText("/storage");
    fireEvent.click(await screen.findByRole("button", { name: /assets-new/ }));
    await screen.findByText("/storage/assets-new");
    fireEvent.click(screen.getByRole("button", { name: "↑ Up" }));
    await screen.findByText("/storage");
    fireEvent.click(await screen.findByRole("button", { name: /assets-new/ }));
    await screen.findByText("/storage/assets-new");
    fireEvent.click(screen.getByRole("button", { name: "Use this folder" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Browse Thumbnails folder" }));
    fireEvent.click(await screen.findByRole("button", { name: /Mounted volume/ }));
    await screen.findByText("/storage");
    fireEvent.click(await screen.findByRole("button", { name: /thumbnails-new/ }));
    await screen.findByText("/storage/thumbnails-new");
    fireEvent.click(screen.getByRole("button", { name: "Use this folder" }));
    fireEvent.click(screen.getByRole("button", { name: "Save locations" }));

    await waitFor(() => {
      expect(axios.put).toHaveBeenCalledWith(
        expect.stringContaining("/admin/assets/locations"),
        { assetRoot: "/storage/assets-new", thumbnailRoot: "/storage/thumbnails-new" },
        expect.objectContaining({ headers: expect.any(Object) })
      );
    });
    await waitFor(() => {
      expect(screen.getByLabelText("Assets folder")).toHaveValue("/assets-new");
      expect(screen.getByLabelText("Thumbnails folder")).toHaveValue("/thumbnails-new");
    });
  });

  it("assigns a browsed folder to the independently selected storage card", async () => {
    useLocation.mockReturnValue({ search: "?tab=controls_assets" });
    const locationData = {
      uploadFolderPath: "/assets-one",
      thumbnailFolderPath: "/thumbnails-one",
      assetLocations: [{ id: "assets-one", label: "Asset 1", path: "/assets-one" }],
      thumbnailLocations: [{ id: "thumbnails-one", label: "Thumbnail 1", path: "/thumbnails-one" }],
      connections: {
        assetLocations: [{ id: "assets-one", label: "Asset 1", path: "/assets-one" }],
        thumbnailLocations: [{ id: "thumbnails-one", label: "Thumbnail 1", path: "/thumbnails-one" }],
        defaultAssetLocationId: "assets-one",
        defaultThumbnailLocationId: "thumbnails-one",
      },
    };
    const cardCounts = { assets: 1, thumbnails: 1 };
    axios.get.mockImplementation((url, config = {}) => {
      if (url.includes("/admin/assets/location")) return Promise.resolve({ data: locationData });
      if (url.includes("/admin/assets/folder-browser")) {
        if (!config.params?.path) return Promise.resolve({ data: { roots: [{ name: "Mounted volume", path: "/storage" }] } });
        return Promise.resolve({
          data: {
            path: config.params.path,
            parentPath: config.params.path === "/storage" ? null : "/storage",
            directories: config.params.path === "/storage" ? [{ name: "assets-new", path: "/storage/assets-new" }] : [],
          },
        });
      }
      return Promise.resolve({ data: [] });
    });
    axios.put.mockImplementation((_url, payload) => {
      if (_url.includes("/admin/assets/card-counts")) {
        cardCounts[payload.type] = payload.count;
        return Promise.resolve({ data: { cardCounts: { ...cardCounts } } });
      }
      locationData.assetLocations.push({ id: "assets-two", label: "Asset 2", path: payload.path });
      locationData.connections.assetLocations = locationData.assetLocations;
      return Promise.resolve({ data: { connections: locationData.connections, backgroundQueueReady: true } });
    });

    render(<AdminPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Assets (1/99)" }));
    expect(await screen.findByRole("heading", { name: "Assets (2)" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Assets storage card"), { target: { value: "2" } });
    expect(screen.getByLabelText("Thumbnails storage card")).toHaveValue("1");
    fireEvent.click(screen.getByRole("button", { name: "Browse Assets folder" }));
    fireEvent.click(await screen.findByRole("button", { name: /Mounted volume/ }));
    await screen.findByText("/storage");
    fireEvent.click(await screen.findByRole("button", { name: /assets-new/ }));
    await screen.findByText("/storage/assets-new");
    fireEvent.click(screen.getByRole("button", { name: "Use this folder" }));
    expect(screen.getByLabelText("Assets storage card")).toHaveValue("2");
    expect(screen.getByLabelText("Assets folder")).toHaveValue("/storage/assets-new");
    expect(screen.getByRole("button", { name: "Save locations" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Save locations" }));

    await waitFor(() => {
      expect(axios.put).toHaveBeenCalledWith(
        expect.stringContaining("/admin/assets/location-card"),
        { type: "assets", locationNumber: 2, path: "/storage/assets-new" },
        expect.objectContaining({ headers: expect.any(Object) })
      );
    });
    expect(await screen.findByLabelText("Assets 2 folder path")).toHaveTextContent("/storage/assets-new");
  });

  it("shows the actual database data path on the database controls page", async () => {
    useLocation.mockReturnValue({ search: "?tab=controls_database" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/database/location")) {
        return Promise.resolve({ data: { connected: true, databaseName: "stocksite", host: "localhost", port: 5432, databasePath: "F:\\GFXunlimitDatabase", dataDirectory: "F:\\GFXunlimitDatabase", dataDirectoryExists: true, databaseSizeBytes: 512 * 1024 * 1024, databaseBackupFolderExists: true, dataDirectorySizeBytes: 1024 * 1024 * 1024, dataDirectoryFreeBytes: 20 * 1024 * 1024 * 1024, databaseBackupFolder: "/Users/gfxunlimit/Documents/stocksite/Database", databaseBackupFolderSizeBytes: 5 * 1024 * 1024, databaseBackupFolderFreeBytes: 20 * 1024 * 1024 * 1024 } });
      }
      return Promise.resolve({ data: [] });
    });

    render(<AdminPanel />);

    expect(screen.getAllByRole("heading", { name: "Database Connection", level: 2 })).toHaveLength(1);
    expect(await screen.findByText("F:\\GFXunlimitDatabase")).toBeInTheDocument();
    expect(screen.getByText("Database: stocksite")).toBeInTheDocument();
    expect(screen.getByText("Database size: 512.00 MB")).toBeInTheDocument();
    expect(screen.getByText("Host: localhost")).toBeInTheDocument();
    expect(screen.getByText("Port: 5432")).toBeInTheDocument();
    expect(screen.getByText("/Users/gfxunlimit/Documents/stocksite/Database")).toBeInTheDocument();
    expect(screen.getByText("Folder size: 5.00 MB · Drive free space: 20.00 GB")).toBeInTheDocument();
    expect(screen.getByText("Folder size: 1.00 GB · Drive free space: 20.00 GB")).toBeInTheDocument();
  });

  it("shows a connected database when its server data directory is private", async () => {
    useLocation.mockReturnValue({ search: "?tab=controls_database" });
    localStorage.removeItem("token");
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/database/location")) {
        if (!localStorage.getItem("token")) {
          return Promise.reject({ response: { status: 401, data: "Access denied" } });
        }
        return Promise.resolve({ data: {
          connected: true,
          databaseName: "stocksite",
          host: "db.example.com",
          port: 5432,
          databasePath: "D:\\GFXunlimitDatabase",
          dataDirectory: "D:\\GFXunlimitDatabase",
          databasePathSource: "configured",
          dataDirectoryExists: false,
          dataDirectorySizeBytes: null,
          dataDirectoryFreeBytes: null,
          databaseSizeBytes: 2048,
          databasePathError: "Database server does not expose its data directory to this application.",
          databaseBackupFolderExists: false,
          databaseBackupFolder: "/app/Database",
          databaseBackupFolderSizeBytes: 0,
          databaseBackupFolderFreeBytes: 2048
        } });
      }
      return Promise.resolve({ data: [] });
    });

    const { rerender } = render(<AdminPanel />);

    expect(await screen.findByText("Unable to load database connection details. Check your admin session and try again.")).toBeInTheDocument();

    localStorage.setItem("token", "admin-token");
    window.dispatchEvent(new Event("auth-changed"));
    rerender(<AdminPanel />);

    expect(await screen.findByText("Connected")).toBeInTheDocument();
    expect(screen.getByText("Database: stocksite")).toBeInTheDocument();
    expect(screen.getByText("Database size: 2 KB")).toBeInTheDocument();
    expect(screen.getByText("D:\\GFXunlimitDatabase")).toBeInTheDocument();
    expect(screen.getByText("Database data directory (configured fallback)")).toBeInTheDocument();
    expect(screen.getByText("/app/Database")).toBeInTheDocument();
    const folderMetrics = screen.getAllByText(/Folder size:/);
    expect(folderMetrics[0]).toHaveTextContent("Folder size: Unavailable");
    expect(folderMetrics[0]).toHaveTextContent("Drive free space: Unavailable");
    expect(folderMetrics[1]).toHaveTextContent("0 KB (folder not created)");
    expect(folderMetrics[1]).toHaveTextContent("2 KB");
  });

  it("opens the controls tax forms tab with the controls_taxforms route", async () => {
    const originalLocation = window.location;
    const hrefSpy = jest.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...originalLocation,
        href: originalLocation.href,
        origin: originalLocation.origin,
        set href(next) {
          hrefSpy(next);
        },
        get href() {
          return originalLocation.href;
        }
      }
    });

    render(<AdminPanel />);

    try {
      const taxFormsButton = await screen.findByRole("button", { name: /^tax forms$/i });
      fireEvent.click(taxFormsButton);

      const adminBasePath = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm";
      expect(hrefSpy).toHaveBeenCalledWith(`${adminBasePath}?tab=controls_taxforms`);
      expect(new URL(hrefSpy.mock.calls[0][0], originalLocation.href).href).toBe(
        `${originalLocation.origin}${adminBasePath}?tab=controls_taxforms`
      );
    } finally {
      Object.defineProperty(window, "location", {
        configurable: true,
        value: originalLocation
      });
    }
  });

  it("shows submitted contributor tax forms in the controls tax forms tab", async () => {
    useLocation.mockReturnValue({ search: "?tab=controls_taxforms" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/users")) {
        return Promise.resolve({ data: [{
          id: 1,
          full_name: "Submitted Contributor",
          username: "submitted_creator",
          email: "submitted@example.com",
          role: "contributor",
          status: "active",
          tax_form_status: "submitted",
          tax_form_submitted_at: "2026-09-14T10:00:00.000Z",
          tax_form_data: { entityType: "Individual", city: "Patiala", country: "India" }
        }] });
      }
      return Promise.resolve({ data: [] });
    });

    render(<AdminPanel />);

    expect(await screen.findByText("Submitted Contributor")).toBeInTheDocument();
    expect(screen.getByText("submitted")).toBeInTheDocument();
    expect(screen.getByText(/Sep 14, 2026|14 Sep 2026/)).toBeInTheDocument();
    expect(screen.getByText("Individual")).toBeInTheDocument();
    expect(screen.getByText("Patiala, India")).toBeInTheDocument();
  });

  it("shows the expires in countdown in the tax forms table", async () => {
    useLocation.mockReturnValue({ search: "?tab=controls_taxforms" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/users")) {
        return Promise.resolve({ data: [{
          id: 1,
          full_name: "Submitted Contributor",
          username: "submitted_creator",
          email: "submitted@example.com",
          role: "contributor",
          status: "active",
          tax_form_status: "submitted",
          tax_form_submitted_at: "2026-09-14T10:00:00.000Z",
          tax_form_data: { entityType: "Individual", city: "Patiala", country: "India" }
        }] });
      }
      return Promise.resolve({ data: [] });
    });

    render(<AdminPanel />);

    expect(await screen.findByText(/expires in/i)).toBeInTheDocument();
    expect(screen.getByText(/\d+\s+day(s)?\s+left/i)).toBeInTheDocument();
  });

  it("expires the current tax form immediately", async () => {
    useLocation.mockReturnValue({ search: "?tab=controls_taxforms" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/users")) {
        return Promise.resolve({ data: [{
          id: 9,
          full_name: "Expiring Contributor",
          username: "expiring_user",
          email: "expiring@example.com",
          role: "contributor",
          tax_form_status: "submitted",
          tax_form_submitted_at: "2026-09-14T10:00:00.000Z",
          tax_form_data: { entityType: "Individual" }
        }] });
      }
      return Promise.resolve({ data: [] });
    });
    axios.put.mockResolvedValue({ data: { status: "expired" } });

    render(<AdminPanel />);

    fireEvent.click(await screen.findByRole("button", { name: /^expire$/i }));

    await waitFor(() => {
      expect(axios.put).toHaveBeenCalledWith(
        expect.stringContaining("/admin/tax-forms/9/status"),
        { status: "expired" },
        expect.anything()
      );
    });
  });

  it("renders the expired tax form email subject and body with the contributor's expiry date", () => {
    const template = {
      subject: "Your Tax Form Expired on {{expiry_date}}",
      body: "Hello {{contributor_name}}, your tax form expired on {{expiry_date}}."
    };

    const result = renderTaxFormTemplate(template, {
      full_name: "Expired Contributor",
      username: "expired_user",
      email: "expired@example.com",
      tax_form_submitted_at: "2026-09-14T10:00:00.000Z",
      tax_form_data: { formType: "W-8BEN" }
    }, new Date("2026-09-20T00:00:00.000Z"));

    expect(result.subject).toContain("Sep 12, 2027");
    expect(result.subject).toContain("Your Tax Form Expired on");
    expect(result.body).toContain("Expired Contributor");
    expect(result.body).toContain("Sep 12, 2027");
  });

  it("sends the saved approved template email when a tax form is approved", async () => {
    useLocation.mockReturnValue({ search: "?tab=controls_taxforms" });
    localStorage.setItem("taxMailTemplates", JSON.stringify({
      approved: {
        name: "Tax Form Approved",
        subject: "Approved template subject",
        body: "Hello {{contributor_name}} — your tax form for {{form_type}} was approved on {{submission_date}}."
      },
      rejected: {
        name: "Tax Form Requires Revision",
        subject: "Rejected template subject",
        body: "Hello {{contributor_name}} — please revise your form."
      }
    }));
    localStorage.setItem("taxMailSMTPSettings", JSON.stringify({
      smtp_from_name: "Tax Mail",
      smtp_from_email: "tax@gfxunlimit.com",
      smtp_host: "smtp.hostinger.com",
      smtp_port: 465,
      smtp_username: "tax@gfxunlimit.com",
      smtp_password: "secret"
    }));

    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/users")) {
        return Promise.resolve({ data: [{
          id: 7,
          full_name: "Approved Contributor",
          username: "approved_user",
          email: "approved@example.com",
          role: "contributor",
          status: "active",
          tax_form_status: "submitted",
          tax_form_submitted_at: "2026-09-14T10:00:00.000Z",
          tax_form_data: { formType: "W-8BEN" }
        }] });
      }
      if (url.includes("/admin/email/tax-mail-config")) {
        return Promise.resolve({ data: {
          templates: JSON.parse(localStorage.getItem("taxMailTemplates")),
          smtp_settings: { sender_email: "tax@gfxunlimit.com", smtp_host: "smtp.hostinger.com", smtp_port: 465, smtp_user: "tax@gfxunlimit.com", smtp_pass: "secret", smtp_secure: true }
        } });
      }
      return Promise.resolve({ data: [] });
    });
    axios.put.mockResolvedValue({ data: { ok: true } });
    axios.post.mockResolvedValue({ data: { ok: true } });

    render(<AdminPanel />);

    fireEvent.click(await screen.findByRole("button", { name: /approve/i }));

    await waitFor(() => {
      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining("/admin/email/tax-mail/send-test"),
        expect.objectContaining({
          to: "approved@example.com",
          subject: "Approved template subject",
          body: expect.stringContaining("Approved Contributor")
        }),
        expect.anything()
      );
    });

  });

  it("sends the saved reminder template email when the reminder button is clicked", async () => {
    useLocation.mockReturnValue({ search: "?tab=controls_taxforms" });
    localStorage.setItem("taxMailTemplates", JSON.stringify({
      reminder: {
        name: "Tax Form Reminder",
        subject: "Reminder template subject",
        body: "Hello {{contributor_name}} — please submit your {{form_type}} form."
      }
    }));
    localStorage.setItem("taxMailSMTPSettings", JSON.stringify({
      smtp_from_name: "Tax Mail",
      smtp_from_email: "tax@gfxunlimit.com",
      smtp_host: "smtp.hostinger.com",
      smtp_port: 465,
      smtp_username: "tax@gfxunlimit.com",
      smtp_password: "secret"
    }));

    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/users")) {
        return Promise.resolve({ data: [{
          id: 8,
          full_name: "Reminder Contributor",
          username: "reminder_user",
          email: "reminder@example.com",
          role: "contributor",
          status: "active",
          tax_form_status: "submitted",
          tax_form_data: { formType: "W-9" }
        }] });
      }
      if (url.includes("/admin/email/tax-mail-config")) {
        return Promise.resolve({ data: {
          templates: JSON.parse(localStorage.getItem("taxMailTemplates")),
          smtp_settings: { sender_email: "tax@gfxunlimit.com", smtp_host: "smtp.hostinger.com", smtp_port: 465, smtp_user: "tax@gfxunlimit.com", smtp_pass: "secret", smtp_secure: true }
        } });
      }
      return Promise.resolve({ data: [] });
    });
    axios.post.mockResolvedValue({ data: { ok: true } });

    render(<AdminPanel />);

    fireEvent.click(await screen.findByRole("button", { name: /reminder/i }));

    await waitFor(() => {
      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining("/admin/email/tax-mail/send-test"),
        expect.objectContaining({
          to: "reminder@example.com",
          subject: "Reminder template subject",
          body: expect.stringContaining("Reminder Contributor")
        }),
        expect.anything()
      );
    });
  });

  it("searches contributor details by username or email", async () => {
    useLocation.mockReturnValue({ search: "?tab=contributordetails" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/users")) {
        return Promise.resolve({ data: [
          { id: 1, full_name: "Alpha Creator", username: "alpha_creator", email: "alpha@example.com", role: "contributor", status: "active" },
          { id: 2, full_name: "Beta Creator", username: "beta_creator", email: "beta@example.com", role: "contributor", status: "active" }
        ] });
      }
      return Promise.resolve({ data: [] });
    });

    render(<AdminPanel />);

    const search = await screen.findByPlaceholderText(/search by username or email/i);
    fireEvent.change(search, { target: { value: "beta@example" } });
    expect(search).toHaveValue("beta@example");
  });

  it("adds the selected contributor username to the contributor details URL", async () => {
    useLocation.mockReturnValue({ search: "?tab=contributordetails" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/users")) {
        return Promise.resolve({ data: [
          { id: 1, full_name: "Alpha Creator", username: "alpha_creator", email: "alpha@example.com", role: "contributor", status: "active" },
          { id: 2, full_name: "Beta Creator", username: "beta_creator", email: "beta@example.com", role: "contributor", status: "active" }
        ] });
      }
      return Promise.resolve({ data: [] });
    });

    render(<AdminPanel />);

    const search = await screen.findByPlaceholderText(/search by username or email/i);
    fireEvent.change(search, { target: { value: "alpha@example" } });

    const alphaButton = await screen.findByRole("button", { name: /Alpha Creator/i });
    fireEvent.click(alphaButton);

    await waitFor(() => {
      expect(window.location.search).toContain("username=alpha_creator");
    });
  });

  it("normalizes legacy contributor analytics fields for the selected card", async () => {
    useLocation.mockReturnValue({ search: "?tab=contributordetails" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/users")) {
        return Promise.resolve({ data: [{
          id: 1,
          full_name: "Legacy Creator",
          username: "legacy_creator",
          email: "legacy@example.com",
          role: "contributor",
          status: "active",
          order_count: 15,
          accepted_upload_count: 4,
          pending_upload_count: 0,
          rejected_upload_count: 1,
          order_details: [{ order_id: 22, order_number: "ORD-22", order_status: "completed", payment_status: "paid", title: "Approved asset sale", created_at: "2026-09-14T10:00:00Z" }]
        }] });
      }
      if (url.includes("/admin/images")) {
        return Promise.resolve({ data: [
          { id: 4, uploaded_by: 1, contributor_username: "legacy_creator", title: "Approved asset", status: "approved", created_at: "2026-09-14T10:00:00Z" },
          { id: 5, uploaded_by: 1, contributor_username: "legacy_creator", title: "Pending asset", status: "pending", created_at: "2026-09-13T10:00:00Z" },
          { id: 6, uploaded_by: 1, contributor_username: "legacy_creator", title: "Rejected asset", status: "rejected", created_at: "2026-09-12T10:00:00Z" }
        ] });
      }
      return Promise.resolve({ data: [] });
    });

    render(<AdminPanel />);

    const search = await screen.findByPlaceholderText(/search by username or email/i);
    fireEvent.change(search, { target: { value: "legacy_creator" } });
    fireEvent.click(await screen.findByRole("button", { name: /Legacy Creator/i }));

    const details = await screen.findByRole("region", { name: /selected contributor details/i });
    expect(details).toHaveTextContent("Orders15");
    expect(details).toHaveTextContent("Approved4");
    expect(details).toHaveTextContent("Pending0");
    expect(details).toHaveTextContent("Rejected1");
    expect(details).toHaveTextContent("PermissionsBulk upload: No Upload limit: 20 MB");

    fireEvent.click(screen.getByText("Orders").closest("article"));
    const ordersDialog = await screen.findByRole("dialog", { name: "Orders" });
    expect(ordersDialog).toHaveTextContent("Approved asset sale");
    expect(within(ordersDialog).getByRole("table")).toBeInTheDocument();
    expect(within(ordersDialog).getByText("Order status")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByText("Approved").closest("article"));
    const approvedDialog = await screen.findByRole("dialog", { name: "Approved" });
    expect(approvedDialog).toHaveTextContent("Approved asset");
    expect(within(approvedDialog).getByRole("img", { name: "Approved asset" })).toBeInTheDocument();
  });

  it("renders the live reputation score returned by the admin user query", async () => {
    useLocation.mockReturnValue({ search: "?tab=contributordetails&username=live_creator" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/users")) {
        return Promise.resolve({ data: [{
          id: 1,
          full_name: "Live Creator",
          username: "live_creator",
          email: "live@example.com",
          role: "contributor",
          status: "active",
          total_uploads: 4,
          total_downloads: 6,
          total_views: 5,
          total_earnings: 123.45,
          unpaid_earnings: 98.45,
          loyalty_points: 3,
          reputation_score: 2
        }] });
      }
      return Promise.resolve({ data: [] });
    });

    render(<AdminPanel />);

    const details = await screen.findByRole("region", { name: /selected contributor details/i });
    expect(details).toHaveTextContent("Reputation score2");
    expect(details).toHaveTextContent("Total earnings123.45");
    expect(details).toHaveTextContent("Unpaid earnings98.45");
    expect(details).toHaveTextContent("Loyalty points3");
  });

  it("renders actual asset counts from collection payloads that use count fields", async () => {
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/categories")) {
        return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      }
      if (url.includes("/admin/collections")) {
        return Promise.resolve({ data: [{ id: 1, name: "Photos", count: 31, live_asset_count: 27 }, { id: 2, name: "Videos", count: 23, live_asset_count: 19 }] });
      }
      return Promise.resolve({ data: [{ id: 1, title: "Live asset", status: "approved", filename: "asset.jpg", category: "Images", keywords: "", description: "", type: "image" }] });
    });

    render(<AdminPanel />);

    const collectionsCard = (await screen.findByRole("heading", { name: /active collections/i })).closest(".admin-panel-card");
    expect(within(collectionsCard).queryByText("Photos")).not.toBeInTheDocument();
    expect(within(collectionsCard).queryByText("Videos")).not.toBeInTheDocument();
    fireEvent.click(within(collectionsCard).getByRole("button", { name: /view collections/i }));
    expect(await screen.findByText(/31 total assets/i)).toBeInTheDocument();
    expect(await screen.findByText(/27 live assets/i)).toBeInTheDocument();
    expect(await screen.findByText(/23 total assets/i)).toBeInTheDocument();
    expect(await screen.findByText(/19 live assets/i)).toBeInTheDocument();
  });

  it("uses the live backend collection list instead of stale cached values when the admin endpoint returns an empty array", async () => {
    const staleCollections = [{ id: 99, name: "Photos", asset_count: 0 }];
    window.localStorage.setItem("asset-collections", JSON.stringify(staleCollections));

    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/categories")) {
        return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      }
      if (url.includes("/admin/collections")) {
        return Promise.resolve({ data: [] });
      }
      if (url.includes("/collections")) {
        return Promise.resolve({ data: [{ id: 1, name: "Photos", asset_count: 31, live_asset_count: 25 }, { id: 2, name: "Videos", asset_count: 23, live_asset_count: 21 }] });
      }
      return Promise.resolve({ data: [{ id: 1, title: "Live asset", status: "approved", filename: "asset.jpg", category: "Images", keywords: "", description: "", type: "image" }] });
    });

    render(<AdminPanel />);

    const collectionsCard = (await screen.findByRole("heading", { name: /active collections/i })).closest(".admin-panel-card");
    fireEvent.click(within(collectionsCard).getByRole("button", { name: /view collections/i }));
    expect(await screen.findByText(/31 total assets/i)).toBeInTheDocument();
    expect(await screen.findByText(/25 live assets/i)).toBeInTheDocument();
    expect(await screen.findByText(/23 total assets/i)).toBeInTheDocument();
    expect(await screen.findByText(/21 live assets/i)).toBeInTheDocument();
  });

  it("shows a backup/restore card that opens the real admin route in the same tab", async () => {
    const originalLocation = window.location;
    const hrefSpy = jest.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...originalLocation,
        href: originalLocation.href,
        origin: originalLocation.origin,
        assign: jest.fn(),
        replace: jest.fn(),
        set href(next) {
          hrefSpy(next);
        },
        get href() {
          return originalLocation.href;
        }
      }
    });

    render(<AdminPanel />);

    expect(document.body.textContent).toContain("Backup/Restore");

    fireEvent.click(screen.getByText(/^Backup$/i));
    fireEvent.click(screen.getByText(/^Restore$/i));

    const adminBasePath = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm";
    expect(hrefSpy).toHaveBeenNthCalledWith(1, `${originalLocation.origin}${adminBasePath}?tab=backup`);
    expect(hrefSpy).toHaveBeenNthCalledWith(2, `${originalLocation.origin}${adminBasePath}?tab=restore`);

    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation
    });
  });

  it("shows the GFX Backup UI on the backup page only", async () => {
    useLocation.mockReturnValue({ search: "?tab=backup" });
    axios.mockImplementation(({ method, url }) => {
      if (method === "get" && url.endsWith("/jobs/active")) return Promise.resolve({ data: { job: null } });
      if (method === "get" && url.endsWith("/history")) return Promise.resolve({ data: { jobs: [] } });
      return Promise.resolve({ data: {} });
    });

    render(<AdminPanel />);

    expect(await screen.findByText(/Backup Center/i)).toBeInTheDocument();
    expect(within(screen.getByLabelText("Backup categories")).getAllByRole("checkbox")).toHaveLength(3);
    expect(screen.queryByText(/incremental/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Build Complete Backup Plan/i })).toBeInTheDocument();
  });

  it("renders the restore wizard inside the admin backup page when the restore tab is selected", async () => {
    useLocation.mockReturnValue({ search: "?tab=restore" });
    axios.mockImplementation(({ method, url }) => {
      if (method === "get" && url.endsWith("/jobs/active")) return Promise.resolve({ data: { job: null } });
      if (method === "get" && url.endsWith("/history")) return Promise.resolve({ data: { jobs: [] } });
      return Promise.resolve({ data: {} });
    });

    render(<AdminPanel />);

    expect(await screen.findByText(/Restore Center/i)).toBeInTheDocument();
    const restorePanel = screen.getByRole("region", { name: /restore package generator/i });
    expect(within(restorePanel).getByRole("button", { name: "START" })).toBeInTheDocument();
    expect(within(restorePanel).getByRole("heading", { name: /prepare stocksite restoration package/i })).toBeInTheDocument();
    expect(within(restorePanel).getAllByRole("button")).toHaveLength(1);
    expect(screen.queryByText(/GFX Backup/i)).not.toBeInTheDocument();
  });

  it("shows a dedicated daily reports control card in the controls tab", async () => {
    render(<AdminPanel />);

    await waitFor(() => {
      expect(screen.getByText(/daily reports/i)).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: /daily report settings/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /preview daily report/i })).toBeInTheDocument();
    expect(screen.getByText(/schedule and preview the automated daily website summary email/i)).toBeInTheDocument();
  });

  it("opens the daily report settings page without the website feature, email, or time controls", async () => {
    render(<AdminPanel />);

    fireEvent.click(screen.getByRole("button", { name: /daily report settings/i }));

    expect(window.location.pathname).toContain("/email/daily-report-settings");
    expect(screen.getByText(/daily report settings/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/entire website feature/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/daily report email id/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/daily report time/i)).not.toBeInTheDocument();
  });

  it("shows failed daily-report settings reads and retries without rejecting valid defaults", async () => {
    const defaultGet = axios.get.getMockImplementation();
    let settingsAttempt = 0;
    axios.get.mockImplementation((url, ...args) => {
      if (url.includes("/admin/email/daily-report-settings")) {
        settingsAttempt += 1;
        return settingsAttempt === 1
          ? Promise.reject(new Error("Unavailable"))
          : Promise.resolve({ data: { ok: true, settings: null } });
      }
      return defaultGet(url, ...args);
    });

    render(<AdminPanel />);
    fireEvent.click(screen.getByRole("button", { name: /daily report settings/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load daily report settings");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => {
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
    expect(settingsAttempt).toBe(2);
    expect(axios.post).not.toHaveBeenCalled();
    expect(axios.put).not.toHaveBeenCalled();
    expect(axios.patch).not.toHaveBeenCalled();
    expect(axios.delete).not.toHaveBeenCalled();
  });

  it("does not show an empty schedule state after a failed GET and retries successfully", async () => {
    const defaultGet = axios.get.getMockImplementation();
    let schedulesAttempt = 0;
    axios.get.mockImplementation((url, ...args) => {
      if (url.includes("/admin/email/daily-report-schedules")) {
        schedulesAttempt += 1;
        return schedulesAttempt === 1
          ? Promise.reject(new Error("Unavailable"))
          : Promise.resolve({ data: [] });
      }
      if (url.includes("/admin/email/daily-report-settings")) {
        return Promise.resolve({ data: { ok: true, settings: null } });
      }
      return defaultGet(url, ...args);
    });

    render(<AdminPanel />);
    fireEvent.click(screen.getByRole("button", { name: /scheduled reports/i }));

    expect(await screen.findByText("Failed to load saved schedules.")).toBeInTheDocument();
    expect(screen.queryByText("No schedules yet. Create your first one above.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => {
      expect(screen.getByText("No schedules yet. Create your first one above.")).toBeInTheDocument();
    });
    expect(schedulesAttempt).toBe(2);
    expect(axios.post).not.toHaveBeenCalled();
    expect(axios.put).not.toHaveBeenCalled();
    expect(axios.patch).not.toHaveBeenCalled();
    expect(axios.delete).not.toHaveBeenCalled();
  });

  it("keeps the daily reports controls available in the controls tab", async () => {
    render(<AdminPanel />);

    await waitFor(() => {
      expect(screen.getByText(/daily reports/i)).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: /daily report settings/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /preview daily report/i })).toBeInTheDocument();
    expect(screen.getByText(/automated daily website summary email for admins and selected recipients/i)).toBeInTheDocument();
  });

  it("provides a blog link that opens in the same page from legal resources", async () => {
    render(<AdminPanel />);

    const blogLink = screen.getByRole("link", { name: "Blog" });

    expect(blogLink).toHaveAttribute("href", "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm?tab=controls_blog");
    expect(blogLink).not.toHaveAttribute("target");
    expect(blogLink).not.toHaveAttribute("rel");
  });

  it("renders currency breakdowns without duplicate React keys", async () => {
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/email/daily-report-settings")) {
        return Promise.resolve({
          data: {
            ok: true,
            settings: {
              enabled: true,
              email: "admin@example.com",
              time: "09:00",
              metrics: { totalRevenueInr: true }
            }
          }
        });
      }
      if (url.includes("/admin/email/daily-report-preview")) {
        return Promise.resolve({
          data: {
            ok: true,
            summary: {
              totalRevenueInr: 150000,
              revenueCurrencyBreakdown: [{
                currency: "INR",
                total: 120000,
                collections: [{ name: "Photos", count: 90000 }],
                categories: [{ name: "Abstract", count: 70000 }],
                type: [{ name: "Commercial", count: 110000 }]
              }, {
                currency: "EUR",
                total: 30000,
                collections: [{ name: "Videos", count: 60000 }],
                categories: [{ name: "Backgrounds", count: 80000 }],
                type: [{ name: "Editorial", count: 40000 }]
              }]
            },
            html: "<p>report preview</p>",
            subject: "Daily revenue report",
          }
        });
      }
      return Promise.resolve({ data: [{ id: 1, title: "Live asset", status: "approved", filename: "asset.jpg", category: "Images", keywords: "", description: "", type: "image" }] });
    });

    render(<AdminPanel />);

    fireEvent.click(screen.getByRole("button", { name: /preview daily report/i }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /website analytics preview/i })).toBeInTheDocument();
    });

    expect(consoleErrorSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("Encountered two children with the same key")
    );

    consoleErrorSpy.mockRestore();
  });

  it("sends the full daily report preview HTML in the test email payload", async () => {
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/email/daily-report-settings")) {
        return Promise.resolve({
          data: {
            ok: true,
            settings: {
              enabled: true,
              email: "admin@example.com",
              time: "09:00",
              metrics: { totalRevenueInr: true }
            }
          }
        });
      }
      if (url.includes("/admin/email/daily-report-preview")) {
        return Promise.resolve({
          data: {
            ok: true,
            summary: {
              generatedAt: "2026-09-15T00:00:00.000Z",
              totalRevenueInr: 150000,
              totalAssets: 1200,
              totalDownloads: 6000
            },
            html: "<html><body><h1>ENORMOUS REPORT</h1><div> this should match the preview </div></body></html>",
            subject: "Daily revenue report",
          }
        });
      }
      return Promise.resolve({ data: [] });
    });

    axios.post.mockResolvedValue({ data: { ok: true } });

    render(<AdminPanel />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /preview daily report/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /preview daily report/i }));

    const smtpSettingsButton = await screen.findByRole("button", { name: /^report smtp setting$/i });
    fireEvent.click(smtpSettingsButton);

    fireEvent.click(await screen.findByRole("button", { name: /^send test mail$/i }));

    const dialog = await screen.findByRole("dialog", { name: /send test mail/i });
    fireEvent.change(within(dialog).getByPlaceholderText(/recipient@example.com/i), {
      target: { value: "admin@example.com" }
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /^send test mail$/i }));

    await waitFor(() => {
      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining("/admin/email/send-test"),
        expect.objectContaining({
          to: "admin@example.com",
          subject: "Daily revenue report",
          body: expect.stringContaining("ENORMOUS REPORT")
        }),
        expect.anything()
      );
    });

    const sendCall = axios.post.mock.calls.find(([url]) => url.includes("/admin/email/send-test"));
    expect(sendCall[1].body).toContain("ENORMOUS REPORT");
    expect(sendCall[1].body).toContain("<html");
  });

  it("uses the saved daily report SMTP config when the draft is stale before sending", async () => {
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/email/daily-report-settings")) {
        return Promise.resolve({
          data: {
            ok: true,
            settings: {
              enabled: true,
              email: "admin@example.com",
              time: "09:00",
              metrics: { totalRevenueInr: true },
              reportSmtp: {
                sender_name: "Daily11",
                sender_email: "reports@gfxunlimit.com",
                smtp_host: "smtp.hostinger.com",
                smtp_port: "465",
                smtp_user: "reports@gfxunlimit.com",
                smtp_pass: "#Pb11bx9363",
                smtp_secure: true
              }
            }
          }
        });
      }
      if (url.includes("/admin/email/daily-report-preview")) {
        return Promise.resolve({
          data: {
            ok: true,
            summary: { generatedAt: "2026-09-15T00:00:00.000Z", totalRevenueInr: 150000, totalAssets: 1200 },
            html: "<html><body><h1>HOSTINGER REPORT</h1></body></html>",
            subject: "Daily report"
          }
        });
      }
      return Promise.resolve({ data: [] });
    });

    axios.post.mockResolvedValue({ data: { ok: true } });

    render(<AdminPanel />);

    fireEvent.click(screen.getByRole("button", { name: /preview daily report/i }));
    const smtpSettingsButton = await screen.findByRole("button", { name: /^report smtp setting$/i });
    fireEvent.click(smtpSettingsButton);

    const hostInput = await screen.findByLabelText(/smtp host/i);
    fireEvent.change(hostInput, { target: { value: "smtp.gmail.com" } });

    fireEvent.click(screen.getByRole("button", { name: /send test mail/i }));
    const dialog = await screen.findByRole("dialog", { name: /send test mail/i });
    fireEvent.change(within(dialog).getByPlaceholderText(/recipient@example.com/i), {
      target: { value: "admin@example.com" }
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /^send test mail$/i }));

    await waitFor(() => {
      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining("/admin/email/send-test"),
        expect.objectContaining({
          smtp_host: "smtp.hostinger.com",
          smtp_user: "reports@gfxunlimit.com",
          smtp_pass: "#Pb11bx9363",
          to: "admin@example.com",
          subject: "Daily report"
        }),
        expect.anything()
      );
    });
  });

  it("shows the daily report checkbox as Last 24 Hr Downloads using the last 24 hour download count", async () => {
    render(<AdminPanel />);

    fireEvent.click(screen.getByRole("button", { name: /daily report settings/i }));

    expect(window.location.pathname).toContain("/email/daily-report-settings");
    expect(await screen.findByText(/daily report settings/i)).toBeInTheDocument();
    expect(screen.getAllByLabelText(/last 24 hr downloads/i).length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText(/last 7 days downloads/i).length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText(/last 30 days downloads/i).length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText(/last 365 days downloads/i).length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText(/current month downloads/i).length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText(/current fy downloads/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/new today/i)).not.toBeInTheDocument();
  });

  it("uses the saved schedule snapshot for its preview", async () => {
    const savedSchedule = {
      id: 42,
      name: "Morning Summary",
      time: "09:00",
      frequency: "daily",
      report_settings: {
        enabled: true,
        email: "scheduled@example.com",
        time: "09:00",
        metrics: { totalUsers: false, totalAssets: true },
        reportSmtp: { provider: "smtp", host: "smtp.schedule.test" }
      }
    };

    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/email/daily-report-schedules")) {
        return Promise.resolve({ data: { ok: true, schedules: [savedSchedule] } });
      }
      if (url.includes("/admin/email/daily-report-preview")) {
        return Promise.resolve({
          data: {
            ok: true,
            summary: { totalUsers: 3 },
            html: "<p>schedule preview</p>",
            subject: "Saved schedule preview",
            reportSettings: savedSchedule.report_settings
          }
        });
      }
      return Promise.resolve({ data: [{ id: 1, title: "Live asset", status: "approved", filename: "asset.jpg", category: "Images", keywords: "", description: "", type: "image" }] });
    });

    render(<AdminPanel />);

    fireEvent.click(screen.getByRole("button", { name: /scheduled reports/i }));
    expect(await screen.findByText(/morning summary/i)).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: /^preview$/i }));

    await waitFor(() => {
      expect(axios.get).toHaveBeenCalledWith(
        expect.stringContaining("/admin/email/daily-report-preview?scheduleId=42"),
        expect.objectContaining({ headers: expect.any(Object) })
      );
    });
    expect(await screen.findByText("schedule preview")).toBeInTheDocument();
  });

  it("saves the current scheduled report settings when updating an existing schedule", async () => {
    const savedSchedule = {
      id: 42,
      name: "Morning Summary",
      time: "09:00",
      frequency: "daily",
      report_settings: {
        enabled: true,
        email: "admin@example.com",
        time: "09:00",
        metrics: { totalUsers: true },
        reportSmtp: { provider: "smtp" }
      }
    };

    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/email/daily-report-settings")) {
        return Promise.resolve({
          data: {
            ok: true,
            settings: {
              enabled: true,
              email: "admin@example.com",
              time: "09:00",
              metrics: { totalUsers: true, totalAssets: false },
              reportSmtp: { provider: "smtp" }
            }
          }
        });
      }
      if (url.includes("/admin/email/daily-report-schedules")) {
        return Promise.resolve({ data: { ok: true, schedules: [savedSchedule] } });
      }
      return Promise.resolve({ data: [{ id: 1, title: "Live asset", status: "approved", filename: "asset.jpg", category: "Images", keywords: "", description: "", type: "image" }] });
    });
    axios.put.mockResolvedValue({ data: { ok: true, schedule: savedSchedule } });

    render(<AdminPanel />);

    fireEvent.click(screen.getByRole("button", { name: /scheduled reports/i }));
    expect(await screen.findByText(/morning summary/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    fireEvent.click(screen.getByRole("button", { name: /update schedule/i }));

    await waitFor(() => {
      expect(axios.put).toHaveBeenCalledWith(
        expect.stringContaining("/admin/email/daily-report-schedules/42"),
        expect.objectContaining({
          name: "Morning Summary",
          time: "09:00",
          frequency: "daily",
          reportSettings: expect.objectContaining({
            email: "admin@example.com",
            time: "09:00",
            metrics: expect.objectContaining({
              totalUsers: true,
              totalAssets: false
            })
          })
        }),
        expect.objectContaining({ headers: expect.any(Object) })
      );
    });
  });

  it("shows revenue group breakdowns under the Revenue (INR) preview card", async () => {
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/email/daily-report-settings")) {
        return Promise.resolve({
          data: {
            ok: true,
            settings: {
              enabled: true,
              email: "admin@example.com",
              time: "09:00",
              metrics: {
                totalRevenueInr: true,
                totalDiscountInr: true,
                totalEarningsInr: true,
                paymentFailedCount: true
              }
            }
          }
        });
      }
      if (url.includes("/admin/email/daily-report-preview")) {
        return Promise.resolve({
          data: {
            ok: true,
            summary: {
              totalRevenueInr: 150000,
              totalDiscountInr: 5000,
              totalEarningsInr: 20000,
              paymentFailedValue: 1250,
              paymentFailedCurrencyBreakdown: [{
                currency: "INR",
                total: 1250,
                collections: [{ name: "Photos", count: 1000 }],
                categories: [{ name: "Abstract", count: 1250 }],
                type: [{ name: "Commercial", count: 1250 }]
              }, {
                currency: "USD",
                total: 10,
                collections: [{ name: "Videos", count: 10 }],
                categories: [{ name: "Nature", count: 10 }],
                type: [{ name: "Editorial", count: 10 }]
              }],
              currencyRevenueBreakdown: [{ name: "INR", count: 120000 }, { name: "EUR", count: 30000 }],
              collectionRevenueBreakdown: [{ name: "Photos", count: 90000 }, { name: "Videos", count: 60000 }],
              categoryRevenueBreakdown: [{ name: "Abstract", count: 70000 }, { name: "Backgrounds", count: 80000 }],
              typeRevenueBreakdown: [{ name: "Commercial", count: 110000 }, { name: "Editorial", count: 40000 }],
              revenueCurrencyBreakdown: [{
                currency: "INR",
                total: 120000,
                collections: [{ name: "Photos", count: 90000 }],
                categories: [{ name: "Abstract", count: 70000 }],
                type: [{ name: "Commercial", count: 110000 }]
              }, {
                currency: "EUR",
                total: 30000,
                collections: [{ name: "Videos", count: 60000 }],
                categories: [{ name: "Backgrounds", count: 80000 }],
                type: [{ name: "Editorial", count: 40000 }]
              }],
              discountCurrencyBreakdown: [{
                currency: "INR",
                total: 2.36,
                collections: [{ name: "Photos", count: 2.36 }],
                categories: [{ name: "Abstract", count: 2.36 }],
                type: [{ name: "Commercial", count: 2.36 }]
              }, {
                currency: "USD",
                total: 6.44,
                collections: [{ name: "Psd", count: 6.44 }],
                categories: [{ name: "Animals", count: 6.44 }],
                type: [{ name: "Editorial", count: 6.44 }]
              }],
              earningsCurrencyBreakdown: [{
                currency: "INR",
                total: 4,
                collections: [{ name: "Photos", count: 4 }],
                categories: [{ name: "Interior", count: 4 }],
                type: [{ name: "Editorial", count: 4 }]
              }, {
                currency: "USD",
                total: 3.30,
                collections: [{ name: "Photos", count: 3.30 }],
                categories: [{ name: "Abstract", count: 3 }, { name: "Backgrounds", count: 0.30 }],
                type: [{ name: "Commercial", count: 3.30 }]
              }]
            }
          }
        });
      }
      if (url.includes("/admin/categories")) {
        return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      }
      if (url.includes("/admin/collections")) {
        return Promise.resolve({ data: [{ id: 1, name: "Nature" }] });
      }
      return Promise.resolve({ data: [{ id: 1, title: "Live asset", status: "approved", filename: "asset.jpg", category: "Images", keywords: "", description: "", type: "image" }] });
    });

    render(<AdminPanel />);

    fireEvent.click(screen.getByRole("button", { name: /preview daily report/i }));

    expect(await screen.findByText(/website analytics preview/i)).toBeInTheDocument();
    expect(await screen.findByText(/^revenue$/i)).toBeInTheDocument();
    expect(screen.getAllByText(/currencies:/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/collections:/i).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/categories:/i).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/type:/i).length).toBeGreaterThanOrEqual(2);
    expect(await screen.findByText(/payment failed value/i)).toBeInTheDocument();
    expect(screen.getAllByText(/₹1,000/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/\$10/).length).toBeGreaterThan(0);
    expect(screen.getByText("Photos: ₹1,000.00")).toBeInTheDocument();
    expect(screen.getByText("Videos: $10.00")).toBeInTheDocument();
    expect(screen.getAllByText("INR: ₹1,250.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("USD: $10.00").length).toBeGreaterThan(0);
    expect(screen.getByText(/^discount$/i)).toBeInTheDocument();
    expect(screen.getAllByText("INR: ₹2.36").length).toBeGreaterThan(0);
    expect(screen.getAllByText("USD: $6.44").length).toBeGreaterThan(0);
    expect(screen.getByText("Photos: ₹2.36")).toBeInTheDocument();
    expect(screen.getByText("Psd: $6.44")).toBeInTheDocument();
    expect(screen.getByText(/^earnings$/i)).toBeInTheDocument();
    expect(screen.getAllByText("INR: ₹4.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("USD: $3.30").length).toBeGreaterThan(0);
    expect(screen.getByText("Interior: ₹4.00")).toBeInTheDocument();
    expect(screen.getByText("Backgrounds: $0.30")).toBeInTheDocument();
  });

  it("shows asset, order, and download preview cards as plain whole-number counts without currency or decimal noise", async () => {
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/email/daily-report-settings")) {
        return Promise.resolve({
          data: {
            ok: true,
            settings: {
              enabled: true,
              email: "admin@example.com",
              time: "09:00",
              metrics: {
                totalAssets: true,
                totalOrders: true,
                totalDownloads: true
              }
            }
          }
        });
      }
      if (url.includes("/admin/email/daily-report-preview")) {
        return Promise.resolve({
          data: {
            ok: true,
            summary: {
              totalAssets: 1250.5,
              totalOrders: 84.25,
              totalDownloads: 3210.8,
              collectionLiveAssets: [{ name: "Photos", count: 28 }],
              collectionTotalOrders: [{ name: "Photos", count: 4 }],
              collectionTotalDownloads: [{ name: "Photos", count: 8 }]
            }
          }
        });
      }
      if (url.includes("/admin/categories")) {
        return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      }
      if (url.includes("/admin/collections")) {
        return Promise.resolve({ data: [{ id: 1, name: "Nature" }] });
      }
      return Promise.resolve({ data: [{ id: 1, title: "Live asset", status: "approved", filename: "asset.jpg", category: "Images", keywords: "", description: "", type: "image" }] });
    });

    render(<AdminPanel />);

    fireEvent.click(screen.getByRole("button", { name: /preview daily report/i }));

    expect(await screen.findByText(/website analytics preview/i)).toBeInTheDocument();
    expect(await screen.findByText("1,251")).toBeInTheDocument();
    expect(await screen.findByText("84")).toBeInTheDocument();
    expect(await screen.findByText("3,211")).toBeInTheDocument();
    expect(screen.getByText("Photos: 28")).toBeInTheDocument();
    expect(screen.getByText("Photos: 4")).toBeInTheDocument();
    expect(screen.getByText("Photos: 8")).toBeInTheDocument();
    expect(screen.queryByText("Photos: ₹28.00")).not.toBeInTheDocument();
  });

  it("shows payment failure count breakdowns in the daily report preview", async () => {
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/email/daily-report-settings")) {
        return Promise.resolve({
          data: {
            ok: true,
            settings: {
              enabled: true,
              email: "admin@example.com",
              time: "09:00",
              metrics: { paymentFailedCount: true }
            }
          }
        });
      }
      if (url.includes("/admin/email/daily-report-preview")) {
        return Promise.resolve({
          data: {
            ok: true,
            summary: {
              paymentFailedCurrencyBreakdown: [{
                currency: "INR",
                total: 1250,
                collections: [{ name: "Photos", count: 1000 }],
                categories: [{ name: "Arts", count: 250 }],
                type: [{ name: "Commercial", count: 1250 }]
              }, {
                currency: "USD",
                total: 10,
                collections: [{ name: "Videos", count: 10 }],
                categories: [{ name: "Beauty", count: 10 }],
                type: [{ name: "Editorial", count: 10 }]
              }]
            }
          }
        });
      }
      if (url.includes("/admin/categories")) {
        return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      }
      if (url.includes("/admin/collections")) {
        return Promise.resolve({ data: [{ id: 1, name: "Nature" }] });
      }
      return Promise.resolve({ data: [{ id: 1, title: "Live asset", status: "approved", filename: "asset.jpg", category: "Images", keywords: "", description: "", type: "image" }] });
    });

    render(<AdminPanel />);

    fireEvent.click(screen.getByRole("button", { name: /preview daily report/i }));

    expect(await screen.findByText(/website analytics preview/i)).toBeInTheDocument();
    expect(screen.getByText(/payment failed value/i)).toBeInTheDocument();
    expect(screen.getAllByText("INR: ₹1,250.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("USD: $10.00").length).toBeGreaterThan(0);
    expect(screen.getByText("Photos: ₹1,000.00")).toBeInTheDocument();
    expect(screen.getByText("Videos: $10.00")).toBeInTheDocument();
  });

  it("shows the hero banner card with default, add image, and save actions", async () => {
    render(<AdminPanel />);

    expect(await screen.findByText(/hero banner image/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^default$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add image/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save hero banner/i })).toBeInTheDocument();
  });

  it("does not show contributor threshold controls in the controls tab", async () => {
    render(<AdminPanel />);

    expect(await screen.findByText(/manage categories/i)).toBeInTheDocument();
    expect(screen.queryByText(/contributor threshold/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add new threshold/i })).not.toBeInTheDocument();
  });

  it("saves the contributor commission and shows a success toast", async () => {
    const toastSuccessSpy = jest.spyOn(toast, "success");
    render(<AdminPanel />);

    expect(await screen.findByText(/contributor commission/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^commission$/i }));
    fireEvent.change(screen.getByRole("spinbutton", { name: /percentage/i }), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining("/admin/settings/contributor-commission"),
        { percentage: 5 },
        expect.objectContaining({ headers: expect.any(Object) })
      );
      expect(toastSuccessSpy).toHaveBeenCalledWith("Contributor commission saved successfully.");
    });

    toastSuccessSpy.mockRestore();
  });

  it("opens a popup when a payment gateway label is clicked", async () => {
    render(<AdminPanel />);

    expect(await screen.findByText(/payment gateway/i)).toBeInTheDocument();

    fireEvent.click(screen.getByText(/google pay/i));

    expect(await screen.findByRole("heading", { name: /google pay/i })).toBeInTheDocument();
    expect(screen.getByText(/status:\s*disabled/i)).toBeInTheDocument();
  });

  it("does not show the global loader for background payment-settings polling", async () => {
    render(<AdminPanel />);

    await waitFor(() => {
      expect(axios.get).toHaveBeenCalledWith(
        expect.stringContaining("/admin/payment-settings"),
        expect.objectContaining({ skipGlobalLoading: true })
      );
    });
  });

  it("only starts the cooling-period clock on the Users tab", () => {
    const setIntervalSpy = jest.spyOn(window, "setInterval");

    const { unmount } = render(<AdminPanel />);

    expect(setIntervalSpy).not.toHaveBeenCalledWith(expect.any(Function), 60000);
    unmount();

    setIntervalSpy.mockClear();
    useLocation.mockReturnValue({ search: "?tab=users" });
    render(<AdminPanel />);

    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 60000);
    setIntervalSpy.mockRestore();
  });

  it("saves a Google Pay ID from the popup", async () => {
    render(<AdminPanel />);

    fireEvent.click(await screen.findByText(/google pay/i));

    fireEvent.change(screen.getByPlaceholderText(/enter google pay id/i), { target: { value: "gpay-123" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining("/admin/payment-settings"),
        expect.objectContaining({ gateway: "Google Pay", identifier: "gpay-123" }),
        expect.anything()
      );
    });
  });

  it("offers both IMAP and POP options in the email configuration modal", async () => {
    render(<AdminPanel />);

    fireEvent.click(screen.getByRole("button", { name: /email configuration/i }));

    const protocolSelect = await screen.findByLabelText(/incoming protocol/i);
    expect(protocolSelect).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /^imap$/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /^pop$/i })).toBeInTheDocument();
  });

  it("renders a live assets tab for approved assets", async () => {
    useLocation.mockReturnValue({ search: "?tab=live-assets" });

    render(<AdminPanel />);

    expect(await screen.findAllByText(/live assets/i)).not.toHaveLength(0);
    expect(screen.getAllByText(/live asset/i).length).toBeGreaterThan(0);
  });

  it("shows a live assets load error and retries only its GET requests", async () => {
    useLocation.mockReturnValue({ pathname: "/admin", search: "?tab=live-assets" });
    axios.get.mockImplementation((url) => (
      url.includes("/images?limit=1000")
        ? Promise.reject(new Error("Unavailable"))
        : Promise.resolve({ data: [] })
    ));

    render(<AdminPanel />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load live assets");
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByText("No live assets found.")).not.toBeInTheDocument();

    axios.get.mockImplementation((url) => (
      url.includes("/images?limit=1000")
        ? Promise.resolve({ data: { images: [] } })
        : Promise.resolve({ data: [] })
    ));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
    expect(axios.get.mock.calls.filter(([url]) => url.includes("/images?limit=1000"))).toHaveLength(2);
    expect(axios.post).not.toHaveBeenCalled();
    expect(axios.put).not.toHaveBeenCalled();
    expect(axios.patch).not.toHaveBeenCalled();
    expect(axios.delete).not.toHaveBeenCalled();
  });

  it("shows contributor username on each asset card", async () => {
    useLocation.mockReturnValue({ search: "?tab=live-assets" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/images?limit=1000&page=1")) {
        return Promise.resolve({ data: { images: [{ id: 2, title: "Live asset", status: "approved" }] } });
      }
      if (url.includes("/admin/images")) {
        return Promise.resolve({
          data: [
            { id: 2, title: "Live asset", status: "approved", filename: "live.jpg", category: "Images", keywords: "", description: "", type: "image", contributor_username: "alpha_uploader" }
          ]
        });
      }
      if (url.includes("/admin/categories")) {
        return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      }
      if (url.includes("/admin/collections")) {
        return Promise.resolve({ data: [] });
      }
      return Promise.resolve({ data: [] });
    });

    render(<AdminPanel />);

    expect(await screen.findByText(/Contributor: alpha_uploader/i)).toBeInTheDocument();
  });

  it("toggles individual live asset checkboxes from the Select button", async () => {
    useLocation.mockReturnValue({ search: "?tab=live-assets" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/images?limit=1000&page=1")) {
        return Promise.resolve({ data: { images: [{ id: 2, title: "Live asset", status: "approved" }] } });
      }
      if (url.includes("/admin/images")) {
        return Promise.resolve({
          data: [
            { id: 2, title: "Live asset", status: "approved", filename: "live.jpg", category: "Images", keywords: "", description: "", type: "image" }
          ]
        });
      }
      if (url.includes("/admin/categories")) {
        return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      }
      if (url.includes("/admin/collections")) {
        return Promise.resolve({ data: [] });
      }
      return Promise.resolve({ data: [] });
    });

    render(<AdminPanel />);

    const selectButton = await screen.findByRole("button", { name: "Select" });
    expect(screen.queryByRole("checkbox", { name: "Select Live asset" })).not.toBeInTheDocument();
    fireEvent.click(selectButton);

    const assetCheckbox = await screen.findByRole("checkbox", { name: "Select Live asset" });
    expect(assetCheckbox.closest("label")).toHaveStyle({
      position: "absolute",
      top: "12px",
      right: "12px"
    });
    expect(screen.getByText("0 selected")).toBeInTheDocument();
    fireEvent.click(assetCheckbox);
    expect(screen.getByText("1 selected")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("checkbox", { name: "Select Live asset" })).not.toBeInTheDocument();
  });

  it("shows bulk status and delete actions after selecting at least two live assets", async () => {
    useLocation.mockReturnValue({ search: "?tab=live-assets" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/images?limit=1000&page=1")) {
        return Promise.resolve({ data: { images: [{ id: 2, title: "Live asset A", status: "approved" }, { id: 3, title: "Live asset B", status: "approved" }] } });
      }
      if (url.includes("/admin/images")) {
        return Promise.resolve({
          data: [
            { id: 2, title: "Live asset A", status: "approved", filename: "live-a.jpg", category: "Images", keywords: "", description: "", type: "image" },
            { id: 3, title: "Live asset B", status: "approved", filename: "live-b.jpg", category: "Images", keywords: "", description: "", type: "image" }
          ]
        });
      }
      if (url.includes("/admin/categories")) {
        return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      }
      if (url.includes("/admin/collections")) {
        return Promise.resolve({ data: [] });
      }
      return Promise.resolve({ data: [] });
    });
    axios.put.mockResolvedValue({ data: { success: true } });
    axios.delete.mockResolvedValue({ data: { success: true } });
    const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);

    try {
      render(<AdminPanel />);
      fireEvent.click(await screen.findByRole("button", { name: "Select" }));

      const selectBothAssets = async () => {
        fireEvent.click(await screen.findByRole("checkbox", { name: "Select Live asset A" }));
        fireEvent.click(screen.getByRole("checkbox", { name: "Select Live asset B" }));
      };

      fireEvent.click(await screen.findByRole("checkbox", { name: "Select Live asset A" }));
      expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("checkbox", { name: "Select Live asset B" }));
      expect(await screen.findByRole("button", { name: "Approve" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Approve" }));
      await waitFor(() => {
        expect(axios.put).toHaveBeenCalledWith(expect.stringContaining("/admin/approve/2"), {}, expect.anything());
        expect(axios.put).toHaveBeenCalledWith(expect.stringContaining("/admin/approve/3"), {}, expect.anything());
      });
      await waitFor(() => expect(screen.getByText("0 selected")).toBeInTheDocument());

      await selectBothAssets();
      fireEvent.click(screen.getByRole("button", { name: "Reject" }));
      await waitFor(() => {
        expect(axios.put).toHaveBeenCalledWith(expect.stringContaining("/admin/reject/2"), {}, expect.anything());
        expect(axios.put).toHaveBeenCalledWith(expect.stringContaining("/admin/reject/3"), {}, expect.anything());
      });
      await waitFor(() => expect(screen.getByText("0 selected")).toBeInTheDocument());

      await selectBothAssets();
      fireEvent.click(screen.getByRole("button", { name: "Delete" }));
      await waitFor(() => {
        expect(confirmSpy).toHaveBeenCalledTimes(1);
        expect(axios.delete).toHaveBeenCalledWith(expect.stringContaining("/images/2"), expect.anything());
        expect(axios.delete).toHaveBeenCalledWith(expect.stringContaining("/images/3"), expect.anything());
      });
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it("offers the same bulk selection actions in the rejected assets view", async () => {
    useLocation.mockReturnValue({ search: "?status=rejected" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/images")) {
        return Promise.resolve({
          data: [
            { id: 4, title: "Rejected asset A", status: "rejected", filename: "rejected-a.jpg", category: "Images", keywords: "", description: "", type: "image" },
            { id: 5, title: "Rejected asset B", status: "rejected", filename: "rejected-b.jpg", category: "Images", keywords: "", description: "", type: "image" }
          ]
        });
      }
      if (url.includes("/admin/categories")) {
        return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      }
      if (url.includes("/admin/collections")) {
        return Promise.resolve({ data: [] });
      }
      return Promise.resolve({ data: [] });
    });
    axios.put.mockResolvedValue({ data: { success: true } });

    render(<AdminPanel />);
    const rejectedHeading = await screen.findByRole("heading", { name: "Rejected Panel" });
    expect(document.querySelector(".admin-asset-count").parentElement).toHaveTextContent("Total Assets:");
    const selectButton = screen.getByRole("button", { name: "Select" });
    expect(rejectedHeading.parentElement).toContainElement(selectButton);
    expect(rejectedHeading.parentElement).toHaveStyle({ justifyContent: "space-between" });
    fireEvent.click(selectButton);
    fireEvent.click(await screen.findByRole("checkbox", { name: "Select Rejected asset A" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Rejected asset B" }));

    expect(await screen.findByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
    expect(rejectedHeading.parentElement).toContainElement(screen.getByRole("button", { name: "Approve" }));

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => {
      expect(axios.put).toHaveBeenCalledWith(
        expect.stringContaining("/admin/approve/4"),
        {},
        expect.anything()
      );
      expect(axios.put).toHaveBeenCalledWith(
        expect.stringContaining("/admin/approve/5"),
        {},
        expect.anything()
      );
    });
  });

  it("approves selected pending assets sequentially, tracks progress, and retries failures", async () => {
    useLocation.mockReturnValue({ search: "?status=pending" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/images")) {
        return Promise.resolve({
          data: [
            { id: 6, title: "Pending asset A", status: "pending", filename: "pending-a.jpg", category: "Images", keywords: "", description: "", type: "image" },
            { id: 7, title: "Pending asset B", status: "pending", filename: "pending-b.jpg", category: "Images", keywords: "", description: "", type: "image" }
          ]
        });
      }
      if (url.includes("/admin/categories")) {
        return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      }
      if (url.includes("/admin/collections")) {
        return Promise.resolve({ data: [] });
      }
      return Promise.resolve({ data: [] });
    });
    let rejectFirstApproval;
    let firstApprovalCallCount = 0;
    axios.put.mockImplementation((url) => {
      if (url.includes("/admin/approve/6") && firstApprovalCallCount++ === 0) {
        return new Promise((resolve, reject) => {
          rejectFirstApproval = reject;
        });
      }
      return Promise.resolve({ data: { success: true } });
    });

    render(<AdminPanel />);
    expect(await screen.findByRole("heading", { name: "Pending Panel" })).toBeInTheDocument();
    const pendingHeading = await screen.findByRole("heading", { name: "Pending Panel" });
    const totalAssetsCount = document.querySelector(".admin-asset-count");
    expect(totalAssetsCount).toHaveClass("admin-asset-count");
    expect(totalAssetsCount.parentElement).toHaveTextContent("Total Assets:");
    expect(totalAssetsCount).toHaveTextContent("0");
    await waitFor(() => expect(totalAssetsCount).toHaveTextContent("2"), { timeout: 3000 });
    const selectButton = screen.getByRole("button", { name: "Select" });
    expect(pendingHeading.parentElement).toContainElement(selectButton);
    expect(pendingHeading.parentElement).toHaveStyle({ justifyContent: "space-between" });
    fireEvent.click(selectButton);
    fireEvent.click(await screen.findByRole("checkbox", { name: "Select Pending asset A" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Pending asset B" }));

    expect(await screen.findByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
    expect(pendingHeading.parentElement).toContainElement(screen.getByRole("button", { name: "Approve" }));
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
    expect(pendingHeading.parentElement).toContainElement(screen.getByRole("button", { name: "Approve" }));

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => {
      expect(axios.put.mock.calls.filter(([url]) => url.includes("/admin/approve/"))).toHaveLength(1);
    });
    expect(axios.put.mock.calls.find(([url]) => url.includes("/admin/approve/"))[0]).toContain("/admin/approve/6");
    expect(screen.getByText("Approving 1 of 2: Pending asset A")).toBeInTheDocument();

    await act(async () => {
      rejectFirstApproval({ response: { data: { error: "Temporary approval error" } } });
    });

    await waitFor(() => {
      expect(axios.put.mock.calls
        .filter(([url]) => url.includes("/admin/approve/"))
        .map(([url]) => url)).toEqual([
        expect.stringContaining("/admin/approve/6"),
        expect.stringContaining("/admin/approve/7")
      ]);
    });
    expect(await screen.findByText("Temporary approval error")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Retry failed (1)" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry failed (1)" }));
    await waitFor(() => {
      expect(axios.put.mock.calls.filter(([url]) => url.includes("/admin/approve/6"))).toHaveLength(2);
    });
    expect(await screen.findByText("1 of 1 approved")).toBeInTheDocument();
  });

  it("rejects and deletes selected assets sequentially with action-specific progress", async () => {
    useLocation.mockReturnValue({ search: "?status=pending" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/images")) {
        return Promise.resolve({
          data: [
            { id: 31, title: "Pending asset A", status: "pending", filename: "pending-a.jpg", category: "Images", keywords: "", description: "", type: "image" },
            { id: 32, title: "Pending asset B", status: "pending", filename: "pending-b.jpg", category: "Images", keywords: "", description: "", type: "image" }
          ]
        });
      }
      if (url.includes("/admin/categories")) return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      if (url.includes("/admin/collections")) return Promise.resolve({ data: [] });
      return Promise.resolve({ data: [] });
    });

    let resolveFirstReject;
    let resolveFirstDelete;
    axios.put.mockImplementation((url) => (
      url.includes("/admin/reject/31")
        ? new Promise((resolve) => { resolveFirstReject = resolve; })
        : Promise.resolve({ data: { success: true } })
    ));
    axios.delete.mockImplementation((url) => (
      url.includes("/images/31")
        ? new Promise((resolve) => { resolveFirstDelete = resolve; })
        : Promise.resolve({ data: { success: true } })
    ));
    const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);

    try {
      render(<AdminPanel />);
      await screen.findByRole("heading", { name: "Pending Panel" });
      fireEvent.click(await screen.findByRole("button", { name: "Select" }));
      fireEvent.click(await screen.findByRole("checkbox", { name: "Select Pending asset A" }));
      fireEvent.click(screen.getByRole("checkbox", { name: "Select Pending asset B" }));

      fireEvent.click(screen.getByRole("button", { name: "Reject" }));
      await waitFor(() => {
        expect(axios.put.mock.calls.filter(([url]) => url.includes("/admin/reject/"))).toHaveLength(1);
      });
      expect(screen.getByText("Rejecting 1 of 2: Pending asset A")).toBeInTheDocument();

      await act(async () => {
        resolveFirstReject({ data: { success: true } });
      });
      await waitFor(() => {
        expect(axios.put.mock.calls.filter(([url]) => url.includes("/admin/reject/"))).toHaveLength(2);
      });
      expect(await screen.findByText("2 of 2 rejected")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("checkbox", { name: "Select Pending asset A" }));
      fireEvent.click(screen.getByRole("checkbox", { name: "Select Pending asset B" }));
      fireEvent.click(screen.getByRole("button", { name: "Delete" }));

      await waitFor(() => {
        expect(confirmSpy).toHaveBeenCalledTimes(1);
        expect(axios.delete.mock.calls.filter(([url]) => url.includes("/images/"))).toHaveLength(1);
      });
      expect(screen.getByText("Deleting 1 of 2: Pending asset A")).toBeInTheDocument();

      await act(async () => {
        resolveFirstDelete({ data: { success: true } });
      });
      await waitFor(() => {
        expect(axios.delete.mock.calls.filter(([url]) => url.includes("/images/"))).toHaveLength(2);
      });
      expect(await screen.findByText("2 of 2 deleted")).toBeInTheDocument();
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it("offers the same bulk selection actions in the approved assets view", async () => {
    useLocation.mockReturnValue({ search: "?status=approved" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/images")) {
        return Promise.resolve({
          data: [
            { id: 8, title: "Approved asset A", status: "approved", filename: "approved-a.jpg", category: "Images", keywords: "", description: "", type: "image" },
            { id: 9, title: "Approved asset B", status: "approved", filename: "approved-b.jpg", category: "Images", keywords: "", description: "", type: "image" }
          ]
        });
      }
      if (url.includes("/admin/categories")) {
        return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      }
      if (url.includes("/admin/collections")) {
        return Promise.resolve({ data: [] });
      }
      return Promise.resolve({ data: [] });
    });
    axios.put.mockResolvedValue({ data: { success: true } });

    render(<AdminPanel />);
    const approvedHeading = await screen.findByRole("heading", { name: "Approved Panel" });
    expect(document.querySelector(".admin-asset-count").parentElement).toHaveTextContent("Total Assets:");
    const selectButton = screen.getByRole("button", { name: "Select" });
    expect(approvedHeading.parentElement).toContainElement(selectButton);
    expect(approvedHeading.parentElement).toHaveStyle({ justifyContent: "space-between" });
    fireEvent.click(selectButton);
    fireEvent.click(await screen.findByRole("checkbox", { name: "Select Approved asset A" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Approved asset B" }));

    expect(await screen.findByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
    expect(approvedHeading.parentElement).toContainElement(screen.getByRole("button", { name: "Approve" }));

    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    await waitFor(() => {
      expect(axios.put).toHaveBeenCalledWith(
        expect.stringContaining("/admin/reject/8"),
        {},
        expect.anything()
      );
      expect(axios.put).toHaveBeenCalledWith(
        expect.stringContaining("/admin/reject/9"),
        {},
        expect.anything()
      );
    });
  });

  it("clears selected assets when changing pages", async () => {
    useLocation.mockReturnValue({ search: "?status=pending" });
    const pendingAssets = [
      { id: 10, title: "Pending asset A", status: "pending", filename: "pending-a.jpg", category: "Images", keywords: "", description: "", type: "image" },
      { id: 11, title: "Pending asset B", status: "pending", filename: "pending-b.jpg", category: "Images", keywords: "", description: "", type: "image" },
      ...Array.from({ length: 19 }, (_, index) => ({
        id: 12 + index,
        title: `Pending asset ${index + 3}`,
        status: "pending",
        filename: `pending-${index + 3}.jpg`,
        category: "Images",
        keywords: "",
        description: "",
        type: "image"
      }))
    ];
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/images")) {
        return Promise.resolve({ data: pendingAssets });
      }
      if (url.includes("/admin/categories")) {
        return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      }
      if (url.includes("/admin/collections")) {
        return Promise.resolve({ data: [] });
      }
      return Promise.resolve({ data: [] });
    });

    render(<AdminPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Select" }));
    const firstAssetCheckbox = await screen.findByRole("checkbox", { name: "Select Pending asset A" });
    fireEvent.click(firstAssetCheckbox);
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Pending asset B" }));
    expect(await screen.findByText("2 selected")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));

    await waitFor(() => expect(screen.getByText("0 selected")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reject" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("exits selection mode when switching asset status views", async () => {
    useLocation.mockReturnValue({ search: "?status=approved" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/images")) {
        return Promise.resolve({
          data: [
            { id: 30, title: "Approved selection asset A", status: "approved", filename: "approved-a.jpg", category: "Images", keywords: "", description: "", type: "image" },
            { id: 31, title: "Approved selection asset B", status: "approved", filename: "approved-b.jpg", category: "Images", keywords: "", description: "", type: "image" },
            { id: 32, title: "Approved selection asset C", status: "approved", filename: "approved-c.jpg", category: "Images", keywords: "", description: "", type: "image" },
            { id: 33, title: "Rejected destination asset", status: "rejected", filename: "rejected.jpg", category: "Images", keywords: "", description: "", type: "image" }
          ]
        });
      }
      if (url.includes("/admin/categories")) {
        return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      }
      if (url.includes("/admin/collections")) {
        return Promise.resolve({ data: [] });
      }
      return Promise.resolve({ data: [] });
    });

    const { rerender } = render(<AdminPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Select" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "Select Approved selection asset A" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Approved selection asset B" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Approved selection asset C" }));
    expect(await screen.findByText("3 selected")).toBeInTheDocument();

    useLocation.mockReturnValue({ search: "?status=rejected" });
    rerender(<AdminPanel />);

    expect(await screen.findByRole("button", { name: "Select" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Done" })).not.toBeInTheDocument();
    expect(screen.queryByText("3 selected")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Select Rejected destination asset" })).not.toBeInTheDocument();
  });

  it("shows approved and rejected assets reviewed within the last 30 days", async () => {
    useLocation.mockReturnValue({ search: "?status=reviewed" });
    const now = Date.now();
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/images")) {
        return Promise.resolve({
          data: [
            { id: 40, title: "Recently approved", status: "approved", contributor_username: "approved_contributor", reviewed_at: new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString() },
            { id: 41, title: "Recently rejected", status: "rejected", contributor_username: "rejected_contributor", reviewed_at: new Date(now - 29 * 24 * 60 * 60 * 1000).toISOString() },
            { id: 42, title: "Old approval", status: "approved", reviewed_at: new Date(now - 31 * 24 * 60 * 60 * 1000).toISOString() },
            { id: 43, title: "Still pending", status: "pending", reviewed_at: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString() }
          ]
        });
      }
      if (url.includes("/admin/categories")) {
        return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      }
      if (url.includes("/admin/collections")) {
        return Promise.resolve({ data: [] });
      }
      return Promise.resolve({ data: [] });
    });

    render(<AdminPanel />);

    expect(await screen.findByRole("heading", { name: "Reviewed Panel" })).toBeInTheDocument();
    expect(await screen.findByText("Title: Recently approved")).toBeInTheDocument();
    expect(screen.getByText("Title: Recently rejected")).toBeInTheDocument();
    const reviewedAssetCount = document.querySelector(".admin-asset-count");
    expect(reviewedAssetCount.parentElement).toHaveTextContent("Total Assets:");
    expect(reviewedAssetCount).toHaveTextContent("0");
    await waitFor(() => expect(reviewedAssetCount).toHaveTextContent("2"), { timeout: 3000 });
    expect(screen.getByText("Contributor: approved_contributor")).toBeInTheDocument();
    expect(screen.getByText("Contributor: rejected_contributor")).toBeInTheDocument();
    expect(screen.getByText("Status: Approved")).toBeInTheDocument();
    expect(screen.getByText("Status: Rejected")).toBeInTheDocument();
    expect(screen.getByText(`Approved on: ${new Date(now - 10 * 24 * 60 * 60 * 1000).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })}`)).toBeInTheDocument();
    expect(screen.getByText(`Rejected on: ${new Date(now - 29 * 24 * 60 * 60 * 1000).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })}`)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Recently approved thumbnail/ })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Recently rejected thumbnail/ })).toBeInTheDocument();
    expect(screen.queryByText("Title: Old approval")).not.toBeInTheDocument();
    expect(screen.queryByText("Title: Still pending")).not.toBeInTheDocument();
  });

  it("shows all asset statuses when the All filter is selected", async () => {
    useLocation.mockReturnValue({ search: "" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/images")) {
        return Promise.resolve({
          data: [
            { id: 1, title: "Pending asset", status: "pending", filename: "pending.jpg", category: "Images", keywords: "", description: "", type: "image" },
            { id: 2, title: "Approved asset", status: "approved", filename: "approved.jpg", category: "Images", keywords: "", description: "", type: "image" },
            { id: 3, title: "Rejected asset", status: "rejected", filename: "rejected.jpg", category: "Images", keywords: "", description: "", type: "image" }
          ]
        });
      }
      if (url.includes("/admin/categories")) {
        return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      }
      if (url.includes("/admin/collections")) {
        return Promise.resolve({ data: [] });
      }
      return Promise.resolve({ data: [] });
    });

    render(<AdminPanel />);

    expect(await screen.findByRole("heading", { name: "All Assets" })).toBeInTheDocument();
    expect(document.querySelector(".admin-asset-count").parentElement).toHaveTextContent("Total Assets:");
    expect(await screen.findByText(/pending asset/i)).toBeInTheDocument();
    expect(screen.getByText(/approved asset/i)).toBeInTheDocument();
    expect(screen.getByText(/rejected asset/i)).toBeInTheDocument();
  });

  it("loads private thumbnails with authorization and downloads the centralized thumbnail", async () => {
    useLocation.mockReturnValue({ search: "?status=pending" });
    localStorage.setItem("token", "admin-token");
    axios.get.mockImplementation((url) => {
      if (url.includes("/api/assets/1/thumbnail")) {
        return Promise.resolve({
          data: new Blob(["thumbnail"], { type: "image/webp" }),
          headers: { "content-type": "image/webp" }
        });
      }
      if (url.includes("/images/1/download-thumbnail")) {
        return Promise.resolve({
          data: new Blob(["thumbnail"], { type: "image/webp" }),
          headers: { "content-type": "image/webp" }
        });
      }
      if (url.includes("/admin/images")) {
        return Promise.resolve({
          data: [
            { id: 1, title: "Pending asset", status: "pending", filename: "pending.jpg", category: "Images", keywords: "", description: "", type: "commercial" }
          ]
        });
      }
      if (url.includes("/admin/categories")) {
        return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      }
      if (url.includes("/admin/collections")) {
        return Promise.resolve({ data: [] });
      }
      return Promise.resolve({ data: [] });
    });
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    URL.createObjectURL = jest.fn(() => "blob:download-thumbnail");
    URL.revokeObjectURL = jest.fn();

    let unmount;
    try {
      ({ unmount } = render(<AdminPanel />));
      expect(await screen.findByRole("img", { name: "Pending asset" })).toHaveAttribute(
        "src",
        "blob:download-thumbnail"
      );
      expect(axios.get).toHaveBeenCalledWith(
        expect.stringContaining("/api/assets/1/thumbnail"),
        expect.objectContaining({
          responseType: "blob",
          headers: expect.objectContaining({ Authorization: "Bearer admin-token" })
        })
      );
      fireEvent.click(await screen.findByTitle("Download Thumbnail"));

      await waitFor(() => expect(clickSpy).toHaveBeenCalled());
      const downloadRequest = axios.get.mock.calls.find(([url]) => (
        String(url).includes("/images/1/download-thumbnail")
      ));
      expect(downloadRequest).toBeDefined();
      expect(downloadRequest[1].responseType).toBe("blob");
      expect(downloadRequest[1].headers.Authorization).toMatch(/^Bearer \S+$/);
      expect(clickSpy.mock.instances[0]).toHaveAttribute("download", "pending.webp");
    } finally {
      unmount?.();
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
      clickSpy.mockRestore();
    }
  });

  it("shows a success toast after saving edited asset details", async () => {
    useLocation.mockReturnValue({ search: "?status=pending" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/images")) {
        return Promise.resolve({
          data: [
            { id: 1, title: "Pending asset", status: "pending", filename: "pending.jpg", category: "Images", keywords: "", description: "", type: "commercial" }
          ]
        });
      }
      if (url.includes("/admin/categories")) {
        return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      }
      if (url.includes("/admin/collections")) {
        return Promise.resolve({ data: [] });
      }
      return Promise.resolve({ data: [] });
    });
    axios.put.mockResolvedValue({ data: { id: 1, title: "Updated asset" } });
    const successToast = jest.spyOn(toast, "success");

    render(<AdminPanel />);

    fireEvent.click((await screen.findAllByRole("button", { name: /^edit$/i }))[0]);
    fireEvent.change(screen.getByRole("textbox", { name: /title/i }), {
      target: { value: "Updated asset" }
    });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(axios.put).toHaveBeenCalledWith(
        expect.stringContaining("/images/1"),
        expect.objectContaining({ title: "Updated asset" }),
        expect.anything()
      );
      expect(successToast).toHaveBeenCalledWith("Asset details saved successfully.");
    });

    successToast.mockRestore();
  });

  it("loads assets from the admin endpoint for the All view", async () => {
    useLocation.mockReturnValue({ search: "" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/images")) {
        return Promise.resolve({ data: [{ id: 1, title: "Visible asset", status: "approved", filename: "asset.jpg", category: "Images", keywords: "", description: "", type: "image" }] });
      }
      if (url.includes("/admin/categories")) {
        return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      }
      if (url.includes("/admin/collections")) {
        return Promise.resolve({ data: [] });
      }
      return Promise.resolve({ data: [] });
    });

    render(<AdminPanel />);

    await waitFor(() => {
      expect(axios.get).toHaveBeenCalledWith(expect.stringContaining("/admin/images"), expect.anything());
    });
  });

  it("shows the Live badge only for assets that are currently on the public site", async () => {
    useLocation.mockReturnValue({ search: "" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/images?limit=1000&page=1")) {
        return Promise.resolve({ data: { images: [{ id: 2, title: "Live asset", status: "approved" }] } });
      }
      if (url.includes("/admin/images")) {
        return Promise.resolve({ data: [
          { id: 1, title: "Hidden asset", status: "approved", filename: "hidden.jpg", category: "Images", keywords: "", description: "", type: "image" },
          { id: 2, title: "Live asset", status: "approved", filename: "live.jpg", category: "Images", keywords: "", description: "", type: "image" }
        ] });
      }
      if (url.includes("/admin/categories")) {
        return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      }
      if (url.includes("/admin/collections")) {
        return Promise.resolve({ data: [] });
      }
      return Promise.resolve({ data: [] });
    });

    render(<AdminPanel />);

    expect(await screen.findByText(/live asset/i)).toBeInTheDocument();
    expect(screen.getByText((content, element) => element?.textContent === "Live" && element.tagName.toLowerCase() === "div")).toBeInTheDocument();
    expect(screen.getByText(/hidden asset/i)).toBeInTheDocument();
  });

  it("exports all live, pending, and rejected assets in the CSV", async () => {
    useLocation.mockReturnValue({ search: "?tab=live-assets" });
    const originalCreateObjectURL = URL.createObjectURL;
    const originalBlob = global.Blob;
    const createObjectURLMock = jest.fn(() => "blob:test");
    URL.createObjectURL = createObjectURLMock;
    global.Blob = jest.fn((parts) => ({
      text: jest.fn().mockResolvedValue(Array.isArray(parts) ? parts.join("") : String(parts))
    }));
    const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    axios.get.mockImplementation((url) => {
      if (url.includes("/images?limit=1000&page=1")) {
        return Promise.resolve({ data: { images: [{ id: 2, title: "Live asset", status: "approved" }] } });
      }
      if (url.includes("/admin/images")) {
        return Promise.resolve({
          data: [
            { id: 1, title: "Pending asset", status: "pending", filename: "pending.jpg", category: "Images", keywords: "", description: "", type: "image" },
            { id: 2, title: "Live asset", status: "approved", filename: "live.jpg", category: "Images", keywords: "", description: "", type: "image" },
            { id: 3, title: "Rejected asset", status: "rejected", filename: "rejected.jpg", category: "Images", keywords: "", description: "", type: "image" }
          ]
        });
      }
      if (url.includes("/admin/categories")) {
        return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      }
      if (url.includes("/admin/collections")) {
        return Promise.resolve({ data: [] });
      }
      return Promise.resolve({ data: [] });
    });

    render(<AdminPanel />);

    fireEvent.click(await screen.findByRole("button", { name: /export csv/i }));

    await waitFor(() => {
      expect(createObjectURLMock).toHaveBeenCalled();
      expect(clickSpy).toHaveBeenCalled();
    });

    const blobArg = createObjectURLMock.mock.calls[0][0];
    const csvText = await blobArg.text();
    expect(csvText).toContain("Pending asset");
    expect(csvText).toContain("Live asset");
    expect(csvText).toContain("Rejected asset");

    URL.createObjectURL = originalCreateObjectURL;
    global.Blob = originalBlob;
    clickSpy.mockRestore();
  });

  it("shows upload-style editing fields and sends collection updates", async () => {
    useLocation.mockReturnValue({ search: "?tab=live-assets" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/images?limit=1000&page=1")) {
        return Promise.resolve({ data: { images: [] } });
      }
      if (url.includes("/admin/categories")) {
        return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      }
      if (url.includes("/admin/collections")) {
        return Promise.resolve({ data: [{ id: 1, name: "Nature" }] });
      }
      return Promise.resolve({ data: [{
        id: 1,
        title: "Live asset",
        status: "approved",
        filename: "asset.jpg",
        category: "Images",
        collection: "Nature",
        keywords: "",
        description: "",
        type: "image"
      }] });
    });
    axios.put.mockResolvedValue({ data: { id: 1, title: "Live asset", status: "approved", filename: "asset.jpg", category: "Images", collection: "Nature", keywords: "", description: "", type: "image" } });
    const dispatchSpy = jest.spyOn(window, "dispatchEvent");

    render(<AdminPanel />);

    fireEvent.click(await screen.findByRole("button", { name: /edit/i }));

    expect(screen.getByRole("combobox", { name: /select primary category/i })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /select optional category/i })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /collection/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /nature/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(axios.put).toHaveBeenCalledWith(
        expect.stringContaining("/images/1"),
        expect.objectContaining({ collection: expect.any(String) }),
        expect.anything()
      );
    });

    await waitFor(() => {
      expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ type: "asset-collections-updated" }));
    });

    await waitFor(() => {
      expect(screen.queryByText(/title \(max 5 words\)/i)).not.toBeInTheDocument();
    });

    dispatchSpy.mockRestore();
  });

  it("shows a success toast and preserves counts after saving a collection rename", async () => {
    useLocation.mockReturnValue({ search: "?tab=controls" });
    const dispatchSpy = jest.spyOn(window, "dispatchEvent");
    const successToast = jest.spyOn(toast, "success");
    let savedCollectionName = "Nature";
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/categories")) return Promise.resolve({ data: [] });
      if (url.includes("/admin/collections")) return Promise.resolve({ data: [{ id: 1, name: savedCollectionName, asset_count: 31, live_asset_count: 25 }] });
      return Promise.resolve({ data: [] });
    });
    axios.put.mockImplementation((url) => {
      if (url.includes("/admin/collections/")) {
        savedCollectionName = "Forest";
        return Promise.resolve({ data: { id: 1, name: "Forest" } });
      }
      return Promise.resolve({ data: { id: 1, title: "Live asset", status: "approved", filename: "asset.jpg", category: "Images", collection: "Nature", keywords: "", description: "", type: "image" } });
    });

    render(<AdminPanel />);

    const collectionsCard = (await screen.findByRole("heading", { name: /active collections/i })).closest(".admin-panel-card");
    fireEvent.click(within(collectionsCard).getByRole("button", { name: /view collections/i }));
    const collectionsHeading = await screen.findByRole("heading", { name: "Collections", exact: true });
    const collectionsPanel = collectionsHeading.parentElement.parentElement;
    fireEvent.click(within(collectionsPanel).getByRole("button", { name: /modify/i }));
    fireEvent.change(screen.getByRole("textbox", { name: /collection name/i }), { target: { value: "Forest" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ type: "asset-refresh" }));
      expect(successToast).toHaveBeenCalledWith("Collection saved successfully.");
    });
    expect(await screen.findByText("Forest")).toBeInTheDocument();
    expect(screen.getByText("31 total assets")).toBeInTheDocument();
    expect(screen.getByText("25 live assets")).toBeInTheDocument();

    dispatchSpy.mockRestore();
    successToast.mockRestore();
  });

  it("opens the Email Analytics modal when the Email Analytics button is clicked", async () => {
    useLocation.mockReturnValue({ search: "?tab=controls" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/categories")) {
        return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      }
      if (url.includes("/admin/collections")) {
        return Promise.resolve({ data: [{ id: 1, name: "Nature" }] });
      }
      if (url.includes("/admin/email/analytics")) {
        return Promise.resolve({ data: {
          totals: { sent: 1, delivered: 1, opened: 0, clicked: 0 },
          daily: [],
          range: '7d'
        } });
      }
      return Promise.resolve({ data: [{ id: 1, title: "Live asset", status: "approved", filename: "asset.jpg", category: "Images", keywords: "", description: "", type: "image" }] });
    });

    render(<AdminPanel />);

    const analyticsButton = await screen.findByRole("button", { name: /email analytics/i });
    expect(analyticsButton).toBeInTheDocument();

    fireEvent.click(analyticsButton);

    expect(await screen.findByRole('heading', { name: /email analytics/i })).toBeInTheDocument();
    expect(screen.getByText(/track delivery performance/i)).toBeInTheDocument();
  });

  it("opens Pricing modal and fetches pricing settings", async () => {
    useLocation.mockReturnValue({ search: "?tab=controls" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/settings/pricing")) {
        return Promise.resolve({ data: { enable_global_minimum_pricing: true } });
      }
      if (url.includes("/admin/categories")) return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      if (url.includes("/admin/collections")) return Promise.resolve({ data: [{ id: 1, name: "Nature" }] });
      return Promise.resolve({ data: [] });
    });

    render(<AdminPanel />);

    const btn = await screen.findByRole('button', { name: /open pricing settings/i });
    fireEvent.click(btn);

    await waitFor(() => {
      expect(axios.get).toHaveBeenCalledWith(expect.stringContaining('/admin/settings/pricing'), expect.anything());
    });
    expect(await screen.findByRole("heading", { name: "Pricing Settings" })).toBeInTheDocument();
  });

  it("waits for backend pricing values before showing the Pricing Settings modal", async () => {
    useLocation.mockReturnValue({ search: "?tab=controls" });
    let resolvePricingSettings;
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/settings/pricing")) {
        return new Promise((resolve) => {
          resolvePricingSettings = resolve;
        });
      }
      if (url.includes("/admin/categories")) return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      if (url.includes("/admin/collections")) return Promise.resolve({ data: [{ id: 1, name: "Nature" }] });
      return Promise.resolve({ data: [] });
    });

    render(<AdminPanel />);

    fireEvent.click(await screen.findByRole("button", { name: /open pricing settings/i }));

    expect(screen.queryByRole("heading", { name: "Pricing Settings" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Loading Pricing Settings..." })).toBeDisabled();

    resolvePricingSettings({
      data: {
        enable_global_minimum_pricing: true,
        inr_amount: 250,
        usd_amount: 12,
        eur_amount: 11,
      },
    });

    expect(await screen.findByRole("heading", { name: "Pricing Settings" })).toBeInTheDocument();
    const pricingModal = screen.getByRole("heading", { name: "Pricing Settings" }).closest(".admin-panel-modal-panel");
    expect(within(pricingModal).getAllByRole("spinbutton", { name: "Amount" }).map((input) => input.value)).toEqual(["250", "12", "11"]);
  });

  it("adds a new custom currency row from the pricing modal", async () => {
    useLocation.mockReturnValue({ search: "?tab=controls" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/settings/pricing")) {
        return Promise.resolve({ data: { enable_global_minimum_pricing: true, inr_amount: 199, usd_amount: 10, eur_amount: 9 } });
      }
      if (url.includes("/admin/categories")) return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      if (url.includes("/admin/collections")) return Promise.resolve({ data: [{ id: 1, name: "Nature" }] });
      return Promise.resolve({ data: [] });
    });

    render(<AdminPanel />);

    fireEvent.click(await screen.findByRole("button", { name: /open pricing settings/i }));

    fireEvent.click(await screen.findByRole('button', { name: /add currency/i }));

    expect(screen.getAllByRole('combobox', { name: /currency/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('spinbutton', { name: /amount/i }).length).toBeGreaterThan(0);
  });

  it("preserves the current tax value when switching between fixed and percentage types", async () => {
    useLocation.mockReturnValue({ search: "?tab=controls" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/settings/pricing")) {
        return Promise.resolve({ data: {
          enable_global_minimum_pricing: true,
          tax_settings: [
            { id: 1, label: "Education Tax", enabled: true, type: "fixed", rate: 0, amount: 5 },
            { id: 2, label: "GST", enabled: true, type: "percentage", rate: 18, amount: 0 }
          ]
        } });
      }
      if (url.includes("/admin/categories")) return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      if (url.includes("/admin/collections")) return Promise.resolve({ data: [{ id: 1, name: "Nature" }] });
      return Promise.resolve({ data: [] });
    });

    render(<AdminPanel />);

    fireEvent.click(await screen.findByRole('button', { name: /^tax settings$/i }));

    const taxSettingsModal = screen.getByRole("heading", { name: "Tax Settings" }).closest(".admin-panel-modal-panel");
    const taxSelects = Array.from(taxSettingsModal.querySelectorAll('select')).filter((el) =>
      Array.from(el.options).some((option) => option.value === 'percentage' || option.value === 'fixed')
    );
    const firstTaxType = taxSelects[0];
    const taxNumberInputs = taxSettingsModal.querySelectorAll('input[type="number"]');

    await waitFor(() => expect(firstTaxType.value).toBe('fixed'));
    expect(taxNumberInputs[0].value).toBe('5');

    fireEvent.change(firstTaxType, { target: { value: 'percentage' } });

    expect(firstTaxType.value).toBe('percentage');
    expect(taxSettingsModal.querySelectorAll('input[type="number"]')[0].value).toBe('5');

    fireEvent.change(firstTaxType, { target: { value: 'fixed' } });

    expect(firstTaxType.value).toBe('fixed');
    expect(taxSettingsModal.querySelectorAll('input[type="number"]')[0].value).toBe('5');
  });

  it("opens Free Assets modal and fetches free asset settings", async () => {
    useLocation.mockReturnValue({ search: "?tab=controls" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/settings/free-assets")) {
        return Promise.resolve({ data: { enable_free_assets: false } });
      }
      if (url.includes("/admin/categories")) return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      if (url.includes("/admin/collections")) return Promise.resolve({ data: [{ id: 1, name: "Nature" }] });
      return Promise.resolve({ data: [] });
    });

    render(<AdminPanel />);

    const btn = await screen.findByRole('button', { name: /open free asset settings/i });
    fireEvent.click(btn);

    await waitFor(() => {
      expect(axios.get).toHaveBeenCalledWith(expect.stringContaining('/admin/settings/free-assets'), expect.anything());
    });
  });

  it("opens the Add New Subscription Plan popup", async () => {
    useLocation.mockReturnValue({ search: "?tab=controls" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/subscription-plans")) {
        return Promise.resolve({ data: [{ id: 1, name: 'Basic' }] });
      }
      if (url.includes("/admin/categories")) return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      if (url.includes("/admin/collections")) return Promise.resolve({ data: [{ id: 1, name: "Nature" }] });
      return Promise.resolve({ data: [] });
    });

    render(<AdminPanel />);

    const btn = await screen.findByRole('button', { name: /add new subscription plan/i });
    fireEvent.click(btn);

    expect(screen.getByText('Plan Name')).toBeInTheDocument();
    const duration = screen.getByRole('checkbox', { name: /limited time/i });
    fireEvent.click(duration);
    expect(screen.getByText('Start date')).toBeInTheDocument();
    expect(screen.getByText('End date')).toBeInTheDocument();
    expect(screen.getAllByText(/INR \(source\)/i).length).toBeGreaterThan(0);
    expect(screen.getByText('Downloads')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /recommended/i })).toBeInTheDocument();
  });

  it("links to the subscriber view page", async () => {
    useLocation.mockReturnValue({ search: "?tab=controls" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/categories")) return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      if (url.includes("/admin/collections")) return Promise.resolve({ data: [{ id: 1, name: "Nature" }] });
      return Promise.resolve({ data: [] });
    });

    render(<AdminPanel />);

    const link = await screen.findByRole('link', { name: /view subscribers/i });
    expect(link).toHaveAttribute('href', '/admin/subscribers');
    expect(screen.getByRole('link', { name: /view current plans/i })).toHaveAttribute('href', '/admin/current-plans');
  });

  it("opens Custom Subscriptions modal and fetches list", async () => {
    useLocation.mockReturnValue({ search: "?tab=controls" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/custom-subscriptions")) {
        return Promise.resolve({ data: [{ id: 1, customer_name: 'Acme' }] });
      }
      if (url.includes("/admin/categories")) return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      if (url.includes("/admin/collections")) return Promise.resolve({ data: [{ id: 1, name: "Nature" }] });
      return Promise.resolve({ data: [] });
    });

    render(<AdminPanel />);

    const btn = await screen.findByRole('button', { name: /open custom subscriptions/i });
    fireEvent.click(btn);

    await waitFor(() => {
      expect(axios.get).toHaveBeenCalledWith(expect.stringContaining('/admin/custom-subscriptions'), expect.anything());
    });
  });

  it("renders a dedicated promotions hub tab for marketing management", async () => {
    useLocation.mockReturnValue({ search: "?tab=promotions"     });
    localStorage.setItem("adminPromotionsActiveSection", "gift-cards");

    axios.get.mockImplementation((url) => {
      if (url.endsWith("/admin/promotions/customers")) {
        return Promise.resolve({ data: [{ id: 7, username: "testcustomer" }, { id: 8, username: "othercustomer" }] });
      }
      if (url.includes("/admin/promotions")) {
        return Promise.resolve({ data: {
          dashboard: { active_campaigns: 3, scheduled_campaigns: 2 },
          coupons: [{
            id: 21,
            name: "Assigned coupon",
            code: "ASSIGNED21",
            coupon_type: "auto",
            discount_type: "percentage",
            discount_value: 10,
            status: "active",
            metadata: {
              restricted_user_id: 7,
              restricted_username: "testcustomer",
              delivery_email: "testcustomer@example.com",
            },
          }],
          campaigns: [],
          flash_sales: [],
          banners: [],
          analytics: {},
        } });
      }
      if (url.includes("/admin/categories")) {
        return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      }
      if (url.includes("/admin/collections")) {
        return Promise.resolve({ data: [{ id: 1, name: "Nature" }] });
      }
      return Promise.resolve({ data: [{ id: 1, title: "Live asset", status: "approved", filename: "asset.jpg", category: "Images", keywords: "", description: "", type: "image" }] });
    });

    const { unmount } = render(<AdminPanel />);

    expect(await screen.findByText(/promotions hub/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /coupons/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^gift cards$/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^bundle discounts$/i })).toBeInTheDocument();
    await waitFor(() => expect(localStorage.getItem("adminPromotionsActiveSection")).toBe("dashboard"));
    const contributorOffersTab = screen.getByRole("button", { name: /^contributor offers$/i });
    expect(contributorOffersTab).toBeInTheDocument();

    fireEvent.click(contributorOffersTab);
    expect(await screen.findByLabelText("Offer name")).toBeInTheDocument();
    expect(screen.getByLabelText("Benefit type")).toBeInTheDocument();
    expect(screen.getByLabelText("Benefit value")).toBeInTheDocument();
    expect(screen.getByLabelText("Eligible contributors")).toBeInTheDocument();
    expect(screen.getByLabelText("Eligibility requirements")).toBeInTheDocument();
    expect(screen.getByLabelText("Eligibility requirement value")).toBeDisabled();
    expect(screen.getByLabelText("Status", { selector: "#campaign-status" })).toHaveValue("active");

    fireEvent.click(screen.getByRole("button", { name: /^coupons$/i }));
    await waitFor(() => expect(localStorage.getItem("adminPromotionsActiveSection")).toBe("coupons"));
    expect(screen.getByText("Recipient: testcustomer • testcustomer@example.com")).toBeInTheDocument();
    const couponCodeInput = screen.getByRole("textbox", { name: "Coupon code" });
    const couponTypeSelect = screen.getByRole("combobox", { name: "Coupon type" });
    expect(couponCodeInput).toBeEnabled();

    fireEvent.change(couponTypeSelect, { target: { value: "auto" } });
    expect(couponCodeInput).toBeDisabled();
    const deliveryEmailInput = screen.getByLabelText("Send generated code to email");
    const customerPicker = screen.getByRole("button", { name: "Or select a customer" });

    fireEvent.click(customerPicker);
    const customerSearch = screen.getByRole("searchbox", { name: "Search customers by username" });
    expect(await screen.findByRole("option", { name: "testcustomer" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "othercustomer" })).toBeInTheDocument();
    expect(axios.get).toHaveBeenCalledWith(expect.stringContaining("/admin/promotions/customers"), expect.anything());
    fireEvent.change(customerSearch, { target: { value: "test" } });
    expect(screen.getByRole("option", { name: "testcustomer" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "othercustomer" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "testcustomer" }));
    expect(customerPicker).toHaveTextContent("testcustomer");
    expect(deliveryEmailInput).toHaveValue("");
    fireEvent.change(deliveryEmailInput, { target: { value: "delivery@example.com" } });
    expect(customerPicker).toHaveTextContent("Choose a customer");
    fireEvent.change(screen.getByPlaceholderText("Coupon name"), { target: { value: "Welcome coupon" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Coupon" }));

    await waitFor(() => {
      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining("/admin/promotions"),
        expect.objectContaining({
          resource: "coupon",
          action: "create",
          data: expect.objectContaining({
            coupon_type: "auto",
            code: "",
            delivery_email: "delivery@example.com",
          }),
        }),
        expect.anything()
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Start date" }));
    const startDateCalendar = screen.getByRole("dialog", { name: "Start date calendar" });
    fireEvent.click(within(startDateCalendar).getByRole("button", { name: "Next month" }));
    const firstOfNextMonth = within(startDateCalendar).getAllByRole("button").find((button) => (
      / 1, \d{4}$/.test(button.getAttribute("aria-label") || "")
    ));
    fireEvent.click(firstOfNextMonth);
    expect(screen.getByRole("button", { name: "Start date" })).not.toHaveTextContent("Choose a date");
    expect(screen.queryByRole("dialog", { name: "Start date calendar" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(await screen.findByText("Current recipient: testcustomer • testcustomer@example.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Or select a customer" })).toHaveTextContent("testcustomer");
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    await waitFor(() => {
      expect(axios.post).toHaveBeenLastCalledWith(
        expect.stringContaining("/admin/promotions"),
        { resource: "coupon", action: "update", data: { id: 21, status: "archived" } },
        expect.anything()
      );
    });

    unmount();
    render(<AdminPanel />);
    expect(await screen.findByRole("button", { name: /^coupons$/i })).toHaveClass("is-active");
  });

  it("saves Contributor Offer fields as campaign metadata", async () => {
    useLocation.mockReturnValue({ search: "?tab=promotions" });
    axios.get.mockImplementation((url) => {
      if (url.endsWith("/admin/promotions/contributors")) {
        return Promise.resolve({
          data: [
            { id: 2, username: "creator", live_asset_count: 11 },
            { id: 3, username: "another_creator", live_asset_count: 4 },
          ],
        });
      }
      if (url.includes("/admin/promotions")) return Promise.resolve({ data: { campaigns: [] } });
      return Promise.resolve({ data: [] });
    });

    render(<AdminPanel />);
    fireEvent.click(await screen.findByRole("button", { name: /^contributor offers$/i }));
    const offerStartDate = screen.getByLabelText("Start Date");
    const offerEndDate = screen.getByLabelText("End Date");
    expect(offerStartDate).toHaveAttribute("aria-required", "true");
    fireEvent.click(offerStartDate);
    const offerStartCalendar = screen.getByRole("dialog", { name: "Start Date calendar" });
    fireEvent.click(within(offerStartCalendar).getByRole("button", { name: "Today" }));
    fireEvent.click(offerEndDate);
    const offerEndCalendar = screen.getByRole("dialog", { name: "End Date calendar" });
    expect(offerEndDate).toHaveAttribute("aria-expanded", "true");
    expect(offerEndCalendar).toBeInTheDocument();
    fireEvent.click(offerEndDate);
    fireEvent.change(screen.getByLabelText("Offer name"), { target: { value: "Upload bonus" } });
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Reward eligible uploads" } });
    fireEvent.change(screen.getByLabelText("Benefit type"), { target: { value: "bonus_payout" } });
    fireEvent.change(screen.getByLabelText("Benefit value"), { target: { value: "500" } });
    fireEvent.change(screen.getByLabelText("Eligible contributors"), { target: { value: "selected" } });
    expect(screen.getByText("Choose Active Contributor")).toBeInTheDocument();
    const contributorPicker = await screen.findByRole("button", { name: "Select active contributors" });
    expect(contributorPicker).toHaveTextContent("Select contributors");
    fireEvent.click(contributorPicker);
    expect(await screen.findByRole("option", { name: "creator (11)" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "another_creator (4)" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "creator (11)" }));
    fireEvent.click(screen.getByRole("option", { name: "another_creator (4)" }));
    expect(contributorPicker).toHaveTextContent("2 contributors selected");
    const eligibilityRequirement = screen.getByLabelText("Eligibility requirements");
    const requirementValue = screen.getByLabelText("Eligibility requirement value");
    fireEvent.change(eligibilityRequirement, { target: { value: "earnings" } });
    expect(requirementValue).toHaveAttribute("step", "any");
    fireEvent.change(eligibilityRequirement, { target: { value: "uploads" } });
    expect(requirementValue).toBeEnabled();
    expect(requirementValue).toHaveAttribute("step", "1");
    fireEvent.change(requirementValue, { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("Status", { selector: "#campaign-status" }), { target: { value: "scheduled" } });
    fireEvent.change(screen.getByLabelText("Admin notes"), { target: { value: "October offer" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Offer" }));

    await waitFor(() => {
      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining("/admin/promotions"),
        expect.objectContaining({
          resource: "campaign",
          action: "create",
          data: expect.objectContaining({
            name: "Upload bonus",
            campaign_type: "contributor_offer",
            objective: "Reward eligible uploads",
            status: "scheduled",
            start_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
            audience: "Selected contributors: creator, another_creator",
            notes: "October offer",
            metadata: expect.objectContaining({
              benefit_type: "bonus_payout",
              benefit_value: 500,
              eligibility_scope: "selected",
              eligible_contributors: "creator, another_creator",
              eligible_contributor_ids: ["2", "3"],
              eligibility_requirements: "uploads",
              eligibility_requirement_value: 10,
            }),
          }),
        }),
        expect.anything()
      );
    });
  });

  it("creates bundle discounts with editable asset-count tiers", async () => {
    useLocation.mockReturnValue({ search: "?tab=promotions" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/promotions")) return Promise.resolve({ data: { bundles: [] } });
      return Promise.resolve({ data: [] });
    });

    render(<AdminPanel />);
    fireEvent.click(await screen.findByRole("button", { name: /^bundle discounts$/i }));
    fireEvent.change(screen.getByLabelText("Bundle name"), { target: { value: "Volume deal" } });
    fireEvent.click(screen.getByRole("button", { name: "Start Date" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Start Date calendar" })).getByRole("button", { name: "Today" }));
    fireEvent.click(screen.getByRole("button", { name: "Add tier" }));
    fireEvent.change(screen.getByLabelText("Tier 2 minimum assets"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Tier 2 discount percent"), { target: { value: "15" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Bundle Discount" }));

    await waitFor(() => {
      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining("/admin/promotions"),
        {
          resource: "bundle",
          action: "create",
          data: {
            name: "Volume deal",
            status: "active",
            metadata: {
              discount_tiers: [
                { asset_count: 3, discount_percent: 10 },
                { asset_count: 5, discount_percent: 15 },
              ],
              start_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
              end_date: null,
            },
          },
        },
        expect.anything()
      );
    });
  });

  it("edits a saved bundle discount tier", async () => {
    useLocation.mockReturnValue({ search: "?tab=promotions" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/promotions")) {
        return Promise.resolve({
          data: {
            bundles: [{
              id: 33,
              name: "Existing volume deal",
              status: "active",
              metadata: {
                discount_tiers: [{ asset_count: 3, discount_percent: 10 }],
                start_date: "2026-10-29",
                end_date: "2026-11-15"
              }
            }]
          }
        });
      }
      return Promise.resolve({ data: [] });
    });

    render(<AdminPanel />);
    fireEvent.click(await screen.findByRole("button", { name: /^bundle discounts$/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Tier 1 minimum assets"), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText("Tier 1 discount percent"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Update Bundle Discount" }));

    await waitFor(() => {
      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining("/admin/promotions"),
        {
          resource: "bundle",
          action: "update",
          data: {
            id: 33,
            name: "Existing volume deal",
            status: "active",
            metadata: {
              discount_tiers: [{ asset_count: 4, discount_percent: 12 }],
              start_date: "2026-10-29",
              end_date: "2026-11-15"
            }
          }
        },
        expect.anything()
      );
    });
  });

  it("shows Contributor Offer details in the library", async () => {
    useLocation.mockReturnValue({ search: "?tab=promotions" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/promotions")) {
        return Promise.resolve({
          data: {
            campaigns: [{
              id: 45,
              name: "Contributor bonus",
              objective: "Reward contributors for their work",
              status: "active",
              start_date: "2026-10-28",
              end_date: null,
              audience: "Selected contributors: varsha",
              notes: "October campaign",
              metadata: {
                benefit_type: "bonus_payout",
                benefit_value: 500,
                eligibility_scope: "selected",
                eligible_contributors: "varsha",
                eligibility_requirements: "uploads",
                eligibility_requirement_value: 11,
              },
            }],
            contributor_applications: [{
              id: 8,
              offer_id: 45,
              contributor_id: 2,
              username: "varsha",
              full_name: "Varsha",
              email: "varsha@example.com",
              offer_name: "Contributor bonus",
              status: "pending",
              created_at: "2026-10-28T10:00:00.000Z",
              eligibility_requirements: "uploads",
              eligibility_requirement_value: "100",
              progress_count: 0,
            }],
          },
        });
      }
      return Promise.resolve({ data: [] });
    });

    render(<AdminPanel />);
    fireEvent.click(await screen.findByRole("button", { name: /^contributor offers$/i }));

    expect(await screen.findAllByText("Contributor bonus")).toHaveLength(2);
    expect(screen.getByText("Reward contributors for their work")).toBeInTheDocument();
    expect(screen.getByText("Benefit:").parentElement).toHaveTextContent("Bonus payout · 500");
    expect(screen.getByText("Eligible contributors:").parentElement).toHaveTextContent("varsha");
    expect(screen.getByText("Requirement:").parentElement).toHaveTextContent("Uploads · 11");
    expect(screen.getByText("Dates:").parentElement).toHaveTextContent("2026-10-28 – No end date");
    expect(screen.getByText("Admin notes:").parentElement).toHaveTextContent("October campaign");
    expect(screen.getByRole("heading", { name: "Contributor Applications" })).toBeInTheDocument();
    expect(screen.getByText("Varsha")).toBeInTheDocument();
    const applicationDetails = screen.getByText("Email:").parentElement.parentElement;
    expect(applicationDetails).toHaveTextContent("varsha@example.com");
    expect(screen.getByText("Offer:").parentElement).toHaveTextContent("Contributor bonus");
    expect(within(applicationDetails).getByText("Status:").parentElement).toHaveTextContent("active");
    expect(screen.getByText("Uploads progress:").parentElement).toHaveTextContent("0/100");
    fireEvent.change(screen.getByLabelText("Contributor application status filter"), { target: { value: "all" } });
    const withdrawButton = screen.getByRole("button", { name: "Withdraw application from varsha" });
    fireEvent.click(withdrawButton);
    await waitFor(() => {
      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining("/admin/promotions/applications/8/withdraw"),
        {},
        expect.anything()
      );
    });
    await waitFor(() => expect(within(applicationDetails).getByText("Status:").parentElement).toHaveTextContent("withdrawn"));
    expect(screen.queryByRole("button", { name: "Withdraw application from varsha" })).not.toBeInTheDocument();
  });

  it("filters Contributor Applications by active, completed, ended, and withdrawn status", async () => {
    useLocation.mockReturnValue({ search: "?tab=promotions" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/promotions")) {
        return Promise.resolve({
          data: {
            campaigns: [],
            contributor_applications: [
              {
                id: 1,
                username: "active-contributor",
                status: "pending",
                offer_status: "active",
                eligibility_requirements: "uploads",
                eligibility_requirement_value: "10",
                progress_count: 2,
              },
              {
                id: 2,
                username: "completed-contributor",
                status: "completed",
                offer_status: "active",
                eligibility_requirements: "uploads",
                eligibility_requirement_value: "10",
                progress_count: 10,
              },
              {
                id: 3,
                username: "ended-contributor",
                status: "ended",
                offer_status: "expired",
                eligibility_requirements: "uploads",
                eligibility_requirement_value: "10",
                progress_count: 2,
              },
              {
                id: 4,
                username: "withdrawn-contributor",
                status: "withdrawn",
                offer_status: "active",
                eligibility_requirements: "uploads",
                eligibility_requirement_value: "10",
                progress_count: 2,
              },
            ],
          },
        });
      }
      return Promise.resolve({ data: [] });
    });

    render(<AdminPanel />);
    fireEvent.click(await screen.findByRole("button", { name: /^contributor offers$/i }));
    const filter = await screen.findByLabelText("Contributor application status filter");
    const applications = screen.getByRole("heading", { name: "Contributor Applications" }).parentElement.parentElement;

    expect(filter).toHaveValue("active");
    expect(within(applications).getAllByText("active-contributor").length).toBeGreaterThan(0);
    expect(within(applications).queryByText("completed-contributor")).not.toBeInTheDocument();
    expect(within(filter).getByRole("option", { name: "All" })).toBeInTheDocument();
    expect(within(filter).getByRole("option", { name: "Active" })).toBeInTheDocument();
    expect(within(filter).getByRole("option", { name: "Completed" })).toBeInTheDocument();
    expect(within(filter).getByRole("option", { name: "Ended" })).toBeInTheDocument();
    expect(within(filter).getByRole("option", { name: "Withdrawn" })).toBeInTheDocument();

    fireEvent.change(filter, { target: { value: "all" } });
    expect(within(applications).getAllByText("completed-contributor").length).toBeGreaterThan(0);
    [
      ["active", "active-contributor", "completed-contributor"],
      ["completed", "completed-contributor", "active-contributor"],
      ["ended", "ended-contributor", "active-contributor"],
      ["withdrawn", "withdrawn-contributor", "active-contributor"],
    ].forEach(([status, visibleContributor, hiddenContributor]) => {
      fireEvent.change(filter, { target: { value: status } });
      expect(within(applications).getAllByText(visibleContributor).length).toBeGreaterThan(0);
      expect(within(applications).queryAllByText(hiddenContributor)).toHaveLength(0);
    });
  });

  it("credits the bonus to unpaid earnings when approving the completed application", async () => {
    useLocation.mockReturnValue({ search: "?tab=promotions" });
    axios.post.mockResolvedValue({
      data: {
        application: {
          id: 8,
          status: "ended",
          benefit_approved: true,
          benefit_amount: 500,
          benefit_earning_id: 99,
        },
        alreadyApproved: false,
      },
    });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/promotions")) {
        return Promise.resolve({
          data: {
            campaigns: [],
            contributor_applications: [{
              id: 8,
              offer_id: 45,
              contributor_id: 2,
              username: "varsha",
              full_name: "Varsha",
              email: "varsha@example.com",
              offer_name: "Contributor bonus",
              status: "completed",
              benefit_type: "bonus_payout",
              benefit_value: "500",
              eligibility_requirements: "uploads",
              eligibility_requirement_value: "100",
              progress_count: 100,
            }],
          },
        });
      }
      return Promise.resolve({ data: [] });
    });

    render(<AdminPanel />);
    fireEvent.click(await screen.findByRole("button", { name: /^contributor offers$/i }));
    fireEvent.change(await screen.findByLabelText("Contributor application status filter"), { target: { value: "completed" } });
    fireEvent.click(await screen.findByRole("button", { name: "View completed application for varsha" }));

    expect(screen.getByRole("dialog", { name: "Contributor bonus payout" })).toHaveTextContent("Varsha");
    expect(screen.getByText("Benefit to add: ₹500.00")).toBeInTheDocument();
    expect(screen.getByText(/Approving adds this bonus to the contributor's unpaid earnings/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => {
      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining("/admin/promotions/applications/8/approve-benefit"),
        {},
        expect.anything()
      );
    });
    expect(await screen.findByText("Bonus approved and credited to unpaid earnings.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Contributor application status filter"), { target: { value: "ended" } });
    expect(within(screen.getByText("Email:").parentElement.parentElement).getByText("Status:").parentElement).toHaveTextContent("ended");
    expect(screen.getByText("Remarks:").parentElement).toHaveTextContent("Paid ₹500.00");
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "View completed application for varsha" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Withdraw application from varsha" })).not.toBeInTheDocument();
    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  it("filters Contributor Offer Library by status", async () => {
    useLocation.mockReturnValue({ search: "?tab=promotions" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/promotions")) {
        return Promise.resolve({
          data: {
            campaigns: [
              { id: 51, name: "Active offer", status: "active", campaign_type: "contributor_offer", metadata: {} },
              { id: 52, name: "Scheduled offer", status: "scheduled", campaign_type: "contributor_offer", metadata: {} },
              { id: 53, name: "Draft offer", status: "planned", campaign_type: "contributor_offer", metadata: {} },
              { id: 54, name: "Ended offer", status: "expired", campaign_type: "contributor_offer", metadata: {} },
            ],
          },
        });
      }
      return Promise.resolve({ data: [] });
    });

    render(<AdminPanel />);
    fireEvent.click(await screen.findByRole("button", { name: /^contributor offers$/i }));
    const statusFilter = await screen.findByLabelText("Contributor offer status filter");

    expect(screen.getByText("Active offer")).toBeInTheDocument();
    expect(statusFilter).toHaveValue("active");
    expect(screen.queryByText("Scheduled offer")).not.toBeInTheDocument();
    fireEvent.change(statusFilter, { target: { value: "all" } });
    expect(screen.getByText("Scheduled offer")).toBeInTheDocument();
    expect(screen.getByText("Draft offer")).toBeInTheDocument();
    expect(screen.getByText("Ended offer")).toBeInTheDocument();

    fireEvent.change(statusFilter, { target: { value: "active" } });
    expect(screen.getByText("Active offer")).toBeInTheDocument();
    expect(screen.queryByText("Scheduled offer")).not.toBeInTheDocument();

    fireEvent.change(statusFilter, { target: { value: "draft" } });
    expect(screen.getByText("Draft offer")).toBeInTheDocument();
    expect(screen.queryByText("Active offer")).not.toBeInTheDocument();

    fireEvent.change(statusFilter, { target: { value: "ended" } });
    expect(screen.getByText("Ended offer")).toBeInTheDocument();
    expect(screen.queryByText("Draft offer")).not.toBeInTheDocument();
  });

  it("shows available category or collection targets for flash sale placement", async () => {
    useLocation.mockReturnValue({ search: "?tab=promotions" });
    axios.get.mockImplementation((url) => {
      if (url.endsWith("/categories")) {
        return Promise.resolve({ data: [{ id: 9, name: "Nature" }] });
      }
      if (url.endsWith("/collections")) {
        return Promise.resolve({ data: [{ id: 4, name: "Travel" }] });
      }
      if (url.includes("/admin/promotions")) {
        return Promise.resolve({ data: { dashboard: {}, flash_sales: [] } });
      }
      return Promise.resolve({ data: [] });
    });

    render(<AdminPanel />);
    fireEvent.click(await screen.findByRole("button", { name: /^flash sales$/i }));

    const discountRuleSelect = screen.getByLabelText("Discount Rule");
    [
      ["percentage", "Percentage"],
      ["fixed_amount", "Fixed Amount"],
      ["BOGO", /BOGO.*Buy One Get One/],
      ["BOG2", /BOG2.*Buy One Get Two/],
      ["BOG3", /BOG3.*Buy One Get Three/],
      ["BOG5", /BOG5.*Buy One Get Five/]
    ].forEach(([value, name]) => {
      expect(within(discountRuleSelect).getByRole("option", { name })).toHaveValue(value);
    });
    fireEvent.change(discountRuleSelect, { target: { value: "percentage" } });
    fireEvent.change(screen.getByLabelText("Discount Percentage"), { target: { value: "15" } });
    expect(screen.getByLabelText("Discount Percentage")).toHaveValue(15);
    fireEvent.change(discountRuleSelect, { target: { value: "fixed_amount" } });
    fireEvent.change(screen.getByLabelText("Discount Amount"), { target: { value: "25" } });
    expect(screen.getByLabelText("Discount Amount")).toHaveValue(25);
    fireEvent.change(discountRuleSelect, { target: { value: "BOGO" } });
    expect(screen.queryByLabelText("Discount Percentage")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Discount Amount")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Featured Placement"), { target: { value: "category" } });
    const categorySelect = await screen.findByLabelText("Active Category");
    expect(within(categorySelect).getByRole("option", { name: "All" })).toBeInTheDocument();
    expect(within(categorySelect).getByRole("option", { name: "Nature" })).toBeInTheDocument();
    fireEvent.change(categorySelect, { target: { value: "all" } });
    const keywordsInput = screen.getByLabelText("Keywords");
    fireEvent.change(keywordsInput, { target: { value: "cat diwali holiday,building" } });
    fireEvent.keyDown(keywordsInput, { key: "Tab" });
    expect(keywordsInput).toHaveValue("cat, diwali, holiday, building");

    fireEvent.change(screen.getByLabelText("Featured Placement"), { target: { value: "collection" } });
    const collectionSelect = await screen.findByLabelText("Active Collection");
    expect(within(collectionSelect).getByRole("option", { name: "All" })).toBeInTheDocument();
    expect(within(collectionSelect).getByRole("option", { name: "Travel" })).toBeInTheDocument();
    fireEvent.change(collectionSelect, { target: { value: "all" } });
    expect(screen.getByLabelText("Keywords")).toHaveValue("cat, diwali, holiday, building");

    fireEvent.click(screen.getByRole("button", { name: "Start Date" }));
    const startDateCalendar = screen.getByRole("dialog", { name: "Start Date calendar" });
    fireEvent.click(within(startDateCalendar).getByRole("button", { name: "Next month" }));
    const firstOfNextMonth = within(startDateCalendar).getAllByRole("button").find((button) => (
      / 1, \d{4}$/.test(button.getAttribute("aria-label") || "")
    ));
    fireEvent.click(firstOfNextMonth);
    expect(screen.getByRole("button", { name: "Start Date" })).not.toHaveTextContent("Choose a date");

    fireEvent.click(screen.getByRole("button", { name: "Create Flash Sale" }));

    await waitFor(() => {
      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining("/admin/promotions"),
        expect.objectContaining({
          resource: "flash_sale",
          action: "create",
          data: expect.objectContaining({
            start_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
            featured_placement: "collection",
            discount_rule: "BOGO",
            metadata: {
              featured_category_id: null,
              featured_collection_id: "all",
              keywords: "cat, diwali, holiday, building",
              discount_value: 0
            }
          })
        }),
        expect.anything()
      );
    });
  });

  it("requires a future start date for scheduled flash sales", async () => {
    useLocation.mockReturnValue({ search: "?tab=promotions" });
    axios.get.mockImplementation((url) => {
      if (url.endsWith("/categories") || url.endsWith("/collections")) return Promise.resolve({ data: [] });
      if (url.includes("/admin/promotions")) return Promise.resolve({ data: { dashboard: {}, flash_sales: [] } });
      return Promise.resolve({ data: [] });
    });

    render(<AdminPanel />);
    fireEvent.click(await screen.findByRole("button", { name: /^flash sales$/i }));
    fireEvent.change(screen.getByLabelText("Discount Rule"), { target: { value: "BOGO" } });

    fireEvent.click(screen.getByRole("button", { name: "Start Date" }));
    const calendar = screen.getByRole("dialog", { name: "Start Date calendar" });
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const formatDateLabel = (date) => date.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });

    expect(within(calendar).getByRole("button", { name: formatDateLabel(today) })).toBeDisabled();
    expect(within(calendar).queryByRole("button", { name: formatDateLabel(yesterday) })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create Flash Sale" }));
    expect(await screen.findByText("Scheduled Flash Sales must have a start date later than today.")).toBeInTheDocument();
    expect(axios.post).not.toHaveBeenCalled();

    fireEvent.click(within(calendar).getByRole("button", { name: formatDateLabel(tomorrow) }));
    fireEvent.click(screen.getByRole("button", { name: "Create Flash Sale" }));
    await waitFor(() => {
      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining("/admin/promotions"),
        expect.objectContaining({
          resource: "flash_sale",
          action: "create",
          data: expect.objectContaining({ status: "scheduled", start_date: expect.any(String) })
        }),
        expect.anything()
      );
    });
  });

  it("preserves the selected IST start and end calendar dates", async () => {
    useLocation.mockReturnValue({ search: "?tab=promotions" });
    axios.get.mockImplementation((url) => {
      if (url.endsWith("/categories") || url.endsWith("/collections")) return Promise.resolve({ data: [] });
      if (url.includes("/admin/promotions")) return Promise.resolve({ data: { dashboard: {}, flash_sales: [] } });
      return Promise.resolve({ data: [] });
    });

    render(<AdminPanel />);
    fireEvent.click(await screen.findByRole("button", { name: /^flash sales$/i }));
    fireEvent.change(screen.getByLabelText("Discount Rule"), { target: { value: "BOGO" } });

    const now = new Date();
    const istParts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(now).map(({ type, value }) => [type, value]));
    const istToday = new Date(Number(istParts.year), Number(istParts.month) - 1, Number(istParts.day));
    const startDate = new Date(istToday.getFullYear(), istToday.getMonth() + 1, 2);
    const endDate = new Date(istToday.getFullYear(), istToday.getMonth() + 1, 3);
    const toDateValue = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const toDateLabel = (date) => date.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });

    fireEvent.click(screen.getByRole("button", { name: "Start Date" }));
    const startCalendar = screen.getByRole("dialog", { name: "Start Date calendar" });
    fireEvent.click(within(startCalendar).getByRole("button", { name: "Next month" }));
    fireEvent.click(within(startCalendar).getByRole("button", { name: toDateLabel(startDate) }));

    fireEvent.click(screen.getByRole("button", { name: "End Date" }));
    const endCalendar = screen.getByRole("dialog", { name: "End Date calendar" });
    fireEvent.click(within(endCalendar).getByRole("button", { name: "Next month" }));
    fireEvent.click(within(endCalendar).getByRole("button", { name: toDateLabel(endDate) }));

    fireEvent.click(screen.getByRole("button", { name: "Create Flash Sale" }));
    await waitFor(() => {
      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining("/admin/promotions"),
        expect.objectContaining({
          resource: "flash_sale",
          action: "create",
          data: expect.objectContaining({
            start_date: toDateValue(startDate),
            end_date: toDateValue(endDate)
          })
        }),
        expect.anything()
      );
    });
  });

  it("shows flash event expiry details and filters active and expired events", async () => {
    useLocation.mockReturnValue({ search: "?tab=promotions" });
    const formatDate = (date) => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    };
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    axios.get.mockImplementation((url) => {
      if (url.endsWith("/categories")) return Promise.resolve({ data: [{ id: 9, name: "Nature" }] });
      if (url.endsWith("/collections")) return Promise.resolve({ data: [{ id: 4, name: "Travel" }] });
      if (url.includes("/admin/promotions")) {
        return Promise.resolve({ data: {
          dashboard: {},
          flash_sales: [
            {
              id: 101,
              name: "Running Weekend Sale",
              discount_rule: "percentage",
              status: "running",
              start_date: formatDate(today),
              end_date: formatDate(tomorrow),
              featured_placement: "collection",
              metadata: { featured_collection_id: 4, discount_value: 15 }
            },
            {
              id: 103,
              name: "Starting Today Sale",
              discount_rule: "BOGO",
              status: "scheduled",
              start_date: formatDate(today),
              end_date: formatDate(tomorrow),
              featured_placement: "homepage",
              metadata: {}
            },
            {
              id: 102,
              name: "Expired Spring Sale",
              discount_rule: "fixed_amount",
              status: "running",
              start_date: formatDate(yesterday),
              end_date: formatDate(yesterday),
              featured_placement: "homepage",
              metadata: { discount_value: 20 }
            }
          ]
        } });
      }
      return Promise.resolve({ data: [] });
    });

    render(<AdminPanel />);
    fireEvent.click(await screen.findByRole("button", { name: /^flash sales$/i }));

    expect(await screen.findByText("Running Weekend Sale")).toBeInTheDocument();
    expect(screen.getByText("Starting Today Sale")).toBeInTheDocument();
    expect(screen.getByText("15% off")).toBeInTheDocument();
    expect(screen.getByText("Collection: Travel")).toBeInTheDocument();
    expect(screen.getAllByText(new RegExp(`Expires ${tomorrow.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })} at 11:59:59 PM IST`)).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Time remaining").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("Expired Spring Sale")).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "Flash event status filter" }), { target: { value: "expired" } });
    expect(await screen.findByText("Expired Spring Sale")).toBeInTheDocument();
    expect(screen.queryByText("Running Weekend Sale")).not.toBeInTheDocument();
    expect(screen.getAllByText(/Expired/).length).toBeGreaterThanOrEqual(1);
  });

  it("renders a users tab for admin user management", async () => {
    useLocation.mockReturnValue({ search: "?tab=users" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/users")) {
        return Promise.resolve({ data: [
          { id: 1, full_name: "Test User", username: "tester", email: "tester@example.com", role: "contributor", identity_number: "123", credits: 5, status: "pending" },
          { id: 2, full_name: "Inactive User", username: "inactive", email: "inactive@example.com", role: "contributor", identity_number: "456", credits: 0, status: "inactive" },
          { id: 3, full_name: "Blocked User", username: "blocked", email: "blocked@example.com", role: "contributor", identity_number: "789", credits: 0, status: "blocked" }
        ] });
      }
      if (url.includes("/admin/categories")) {
        return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      }
      if (url.includes("/admin/collections")) {
        return Promise.resolve({ data: [{ id: 1, name: "Nature" }] });
      }
      return Promise.resolve({ data: [{ id: 1, title: "Live asset", status: "approved", filename: "asset.jpg", category: "Images", keywords: "", description: "", type: "image" }] });
    });

    render(<AdminPanel />);

    expect(await screen.findByText(/user management/i)).toBeInTheDocument();
    expect(screen.getByText(/test user/i)).toBeInTheDocument();
    expect(screen.getByText(/inactive user/i)).toBeInTheDocument();
    expect(screen.getByText(/blocked user/i)).toBeInTheDocument();
    const userCount = document.querySelector(".admin-asset-count");
    expect(userCount).toBeInTheDocument();
    await waitFor(() => expect(userCount).toHaveTextContent("3"), { timeout: 3000 });

    const usersHeading = screen.getByRole("heading", { name: "Users" });
    const selectButton = screen.getByRole("button", { name: "Select" });
    expect(usersHeading.parentElement).toContainElement(selectButton);
    fireEvent.click(selectButton);
    const testUserCheckbox = screen.getByRole("checkbox", { name: "Select Test User" });
    expect(testUserCheckbox.closest("label")).toHaveStyle({ position: "absolute", top: "10px", right: "10px" });
    fireEvent.click(testUserCheckbox);
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Inactive User" }));
    expect(screen.getByText("2 selected")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("checkbox", { name: "Select Test User" })).not.toBeInTheDocument();
  });

  it("filters users by customer and contributor roles", async () => {
    useLocation.mockReturnValue({ search: "?tab=users" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/users")) {
        return Promise.resolve({ data: [
          { id: 31, full_name: "Customer Account", username: "customer-one", role: "customer", status: "active" },
          { id: 32, full_name: "Contributor Account", username: "contributor-one", role: "contributor", status: "active" },
          { id: 33, full_name: "Admin Account", username: "admin-one", role: "admin", status: "active" }
        ] });
      }
      if (url.includes("/admin/categories")) return Promise.resolve({ data: [] });
      if (url.includes("/admin/collections")) return Promise.resolve({ data: [] });
      return Promise.resolve({ data: [] });
    });

    render(<AdminPanel />);
    expect(await screen.findByText(/customer account/i)).toBeInTheDocument();
    expect(screen.getByText(/contributor account/i)).toBeInTheDocument();
    expect(screen.getByText(/admin account/i)).toBeInTheDocument();
    const roleFilterButtons = ["All", "Active", "Admin", "Blocked", "Contributor", "Customer", "Pending"]
      .map((name) => screen.getByRole("button", { name }));
    expect(roleFilterButtons.map((button) => button.textContent)).toEqual([
      "All", "Active", "Admin", "Blocked", "Contributor", "Customer", "Pending"
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Customer" }));
    expect(await screen.findByText(/customer account/i)).toBeInTheDocument();
    expect(screen.queryByText(/contributor account/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/admin account/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Contributor" }));
    expect(await screen.findByText(/contributor account/i)).toBeInTheDocument();
    expect(screen.queryByText(/customer account/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/admin account/i)).not.toBeInTheDocument();
  });

  it("searches users by username, email, full name, and ID", async () => {
    useLocation.mockReturnValue({ search: "?tab=users" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/users")) {
        return Promise.resolve({ data: [
          { id: 98765, full_name: "Jane Searchable", username: "findmeuser", email: "findme@example.com", role: "customer", status: "active" },
          { id: 54321, full_name: "Other Account", username: "otheruser", email: "other@example.com", role: "contributor", status: "active" }
        ] });
      }
      if (url.includes("/admin/categories")) return Promise.resolve({ data: [] });
      if (url.includes("/admin/collections")) return Promise.resolve({ data: [] });
      return Promise.resolve({ data: [] });
    });

    render(<AdminPanel />);
    const searchBox = await screen.findByRole("searchbox", { name: "Search users" });
    expect(screen.getByPlaceholderText("Search username, email, name, or ID")).toBe(searchBox);

    for (const query of ["findmeuser", "findme@example.com", "Jane Searchable", "98765", "#98765", "id: 98765", "ID 98765"]) {
      fireEvent.change(searchBox, { target: { value: query } });
      expect(await screen.findByText("Jane Searchable")).toBeInTheDocument();
      expect(screen.queryByText("Other Account")).not.toBeInTheDocument();
    }
  });

  it("offers bulk active, inactive, block and delete actions for selected users", async () => {
    useLocation.mockReturnValue({ search: "?tab=users" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/users")) {
        return Promise.resolve({ data: [
          { id: 21, full_name: "Bulk User A", username: "bulk-a", email: "bulk-a@example.com", role: "customer", status: "active" },
          { id: 22, full_name: "Bulk User B", username: "bulk-b", email: "bulk-b@example.com", role: "contributor", status: "pending" }
        ] });
      }
      if (url.includes("/admin/categories")) return Promise.resolve({ data: [] });
      if (url.includes("/admin/collections")) return Promise.resolve({ data: [] });
      return Promise.resolve({ data: [] });
    });
    axios.put.mockImplementation((url) => {
      const id = Number(url.match(/\/users\/(\d+)\//)?.[1]);
      return Promise.resolve({ data: { id, status: url.endsWith("/approve") ? "active" : url.endsWith("/deactivate") ? "inactive" : "blocked" } });
    });
    axios.delete.mockImplementation((url) => {
      const id = Number(url.match(/\/users\/(\d+)$/)?.[1]);
      return Promise.resolve({ status: 202, data: { user: { id, deletion_requested_at: new Date().toISOString() } } });
    });
    const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);

    try {
      render(<AdminPanel />);
      const selectBothUsers = () => {
        fireEvent.click(screen.getByRole("checkbox", { name: "Select Bulk User A" }));
        fireEvent.click(screen.getByRole("checkbox", { name: "Select Bulk User B" }));
      };
      const expectActionForBothUsers = async (action, endpoint) => {
        fireEvent.click(await screen.findByRole("button", { name: "Select" }));
        selectBothUsers();
        expect(await screen.findByRole("button", { name: "Set Active" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Set Inactive" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Block Selected" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Delete Selected" })).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: action }));
        await waitFor(() => {
          expect(axios.put).toHaveBeenCalledWith(
            expect.stringContaining(`/admin/users/21/${endpoint}`),
            {},
            expect.anything()
          );
          expect(axios.put).toHaveBeenCalledWith(
            expect.stringContaining(`/admin/users/22/${endpoint}`),
            {},
            expect.anything()
          );
        });
        await waitFor(() => {
          expect(screen.getByRole("button", { name: "Select" })).toBeInTheDocument();
          expect(screen.queryByRole("button", { name: "Set Active" })).not.toBeInTheDocument();
          expect(screen.queryByRole("button", { name: "Set Inactive" })).not.toBeInTheDocument();
          expect(screen.queryByRole("button", { name: "Block Selected" })).not.toBeInTheDocument();
          expect(screen.queryByRole("button", { name: "Delete Selected" })).not.toBeInTheDocument();
          expect(screen.queryByText(/selected$/)).not.toBeInTheDocument();
        });
      };

      await expectActionForBothUsers("Set Active", "approve");
      await expectActionForBothUsers("Set Inactive", "deactivate");
      await expectActionForBothUsers("Block Selected", "block");

      fireEvent.click(screen.getByRole("button", { name: "Select" }));
      selectBothUsers();
      fireEvent.click(await screen.findByRole("button", { name: "Delete Selected" }));
      await waitFor(() => {
        expect(confirmSpy).toHaveBeenCalledTimes(1);
        expect(axios.delete).toHaveBeenCalledWith(expect.stringContaining("/admin/users/21"), expect.anything());
        expect(axios.delete).toHaveBeenCalledWith(expect.stringContaining("/admin/users/22"), expect.anything());
        expect(screen.getByRole("button", { name: "Select" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Delete Selected" })).not.toBeInTheDocument();
      });
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it("uses dark-neutral panel styling in the users tab when dark mode is active", async () => {
    document.body.classList.add("dark-mode");
    useLocation.mockReturnValue({ search: "?tab=users" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/users")) {
        return Promise.resolve({ data: [{ id: 1, full_name: "Dark User", username: "darkuser", email: "dark@example.com", role: "customer", identity_number: "101", credits: 5, status: "active" }] });
      }
      if (url.includes("/admin/categories")) {
        return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      }
      if (url.includes("/admin/collections")) {
        return Promise.resolve({ data: [{ id: 1, name: "Nature" }] });
      }
      return Promise.resolve({ data: [] });
    });

    render(<AdminPanel />);

    const panel = await screen.findByTestId("admin-users-panel");
    expect(panel).toHaveStyle({ background: "#0f172a", color: "#f5f5f5" });

    document.body.classList.remove("dark-mode");
  });

  it("keeps updated_at in the CSV export without showing it in the user list", async () => {
    useLocation.mockReturnValue({ search: "?tab=users" });
    const originalCreateObjectURL = URL.createObjectURL;
    const originalBlob = global.Blob;
    const createObjectURLMock = jest.fn(() => "blob:test");
    URL.createObjectURL = createObjectURLMock;
    global.Blob = jest.fn((parts) => ({
      text: jest.fn().mockResolvedValue(Array.isArray(parts) ? parts.join("") : String(parts))
    }));
    const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/users")) {
        return Promise.resolve({ data: [
          { id: 1, full_name: "Updated User", username: "updateduser", email: "updated@example.com", role: "customer", identity_number: "88", credits: 10, status: "active", updated_at: "2026-08-12T10:00:00.000Z" }
        ] });
      }
      if (url.includes("/admin/categories")) {
        return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      }
      if (url.includes("/admin/collections")) {
        return Promise.resolve({ data: [{ id: 1, name: "Nature" }] });
      }
      return Promise.resolve({ data: [] });
    });

    render(<AdminPanel />);

    expect(await screen.findByText(/updated user/i)).toBeInTheDocument();
    expect(screen.queryByText(/updated:/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /export csv/i }));

    await waitFor(() => {
      expect(createObjectURLMock).toHaveBeenCalled();
      expect(clickSpy).toHaveBeenCalled();
    });

    const blobArg = createObjectURLMock.mock.calls[0][0];
    const csvText = await blobArg.text();
    expect(csvText).toContain("updated_at");
    expect(csvText).toContain("2026-08-12T10:00:00.000Z");

    URL.createObjectURL = originalCreateObjectURL;
    global.Blob = originalBlob;
    clickSpy.mockRestore();
  });

  it("exports all users to CSV from the users tab", async () => {
    useLocation.mockReturnValue({ search: "?tab=users" });
    const originalCreateObjectURL = URL.createObjectURL;
    const originalBlob = global.Blob;
    const createObjectURLMock = jest.fn(() => "blob:test");
    URL.createObjectURL = createObjectURLMock;
    global.Blob = jest.fn((parts) => ({
      text: jest.fn().mockResolvedValue(Array.isArray(parts) ? parts.join("") : String(parts))
    }));
    const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/users")) {
        return Promise.resolve({ data: [
          { id: 1, full_name: "Test User", username: "tester", email: "tester@example.com", role: "contributor", identity_number: "123", credits: 5, status: "pending" },
          { id: 2, full_name: "Inactive User", username: "inactive", email: "inactive@example.com", role: "contributor", identity_number: "456", credits: 0, status: "inactive" }
        ] });
      }
      if (url.includes("/admin/categories")) {
        return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      }
      if (url.includes("/admin/collections")) {
        return Promise.resolve({ data: [{ id: 1, name: "Nature" }] });
      }
      return Promise.resolve({ data: [] });
    });

    render(<AdminPanel />);

    fireEvent.click(await screen.findByRole("button", { name: /export csv/i }));

    await waitFor(() => {
      expect(createObjectURLMock).toHaveBeenCalled();
      expect(clickSpy).toHaveBeenCalled();
    });

    const blobArg = createObjectURLMock.mock.calls[0][0];
    const csvText = await blobArg.text();
    expect(csvText).toContain("Test User");
    expect(csvText).toContain("Inactive User");
    expect(csvText).toContain("tester@example.com");

    URL.createObjectURL = originalCreateObjectURL;
    global.Blob = originalBlob;
    clickSpy.mockRestore();
  });

  it("creates a new customer account when Add New is used", async () => {
    useLocation.mockReturnValue({ search: "?tab=users" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/users")) {
        return Promise.resolve({ data: [] });
      }
      if (url.includes("/admin/categories")) {
        return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      }
      if (url.includes("/admin/collections")) {
        return Promise.resolve({ data: [{ id: 1, name: "Nature" }] });
      }
      return Promise.resolve({ data: [{ id: 1, title: "Live asset", status: "approved", filename: "asset.jpg", category: "Images", keywords: "", description: "", type: "image" }] });
    });

    axios.post.mockImplementation((url, payload) => {
      if (url.includes("/admin/users")) {
        return Promise.resolve({ data: { id: 4, ...payload } });
      }
      return Promise.resolve({ data: { id: 2, name: "Travel" } });
    });

    render(<AdminPanel />);

    fireEvent.click(await screen.findByRole("button", { name: /add new/i }));

    fireEvent.change(screen.getByPlaceholderText(/full name/i), { target: { value: "Dummy Customer" } });
    fireEvent.change(screen.getByPlaceholderText("Username"), { target: { value: "dummycust" } });
    fireEvent.change(screen.getByPlaceholderText("Email"), { target: { value: "dummy@customer.test" } });
    fireEvent.change(screen.getByPlaceholderText(/id #/i), { target: { value: "DUMMY001" } });
    fireEvent.change(screen.getByPlaceholderText(/credits/i), { target: { value: "10" } });
    fireEvent.change(screen.getByPlaceholderText(/password/i), { target: { value: "password123" } });
    fireEvent.change(screen.getByRole("combobox", { name: /role/i }), { target: { value: "customer" } });
    fireEvent.change(screen.getByRole("combobox", { name: /status/i }), { target: { value: "active" } });

    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining("/admin/users"),
        expect.objectContaining({
          full_name: "Dummy Customer",
          username: "dummycust",
          email: "dummy@customer.test",
          role: "customer",
          identity_number: "DUMMY001",
          credits: 10,
          status: "active",
          password: "password123"
        }),
        expect.anything()
      );
    });

    await waitFor(() => {
      expect(screen.queryByText(/update user details and save changes/i)).not.toBeInTheDocument();
    });

    expect(screen.getByText(/dummy customer/i)).toBeInTheDocument();
  });

  it("renders activate, deactivate, modify, and delete controls for users", async () => {
    useLocation.mockReturnValue({ search: "?tab=users" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/users")) {
        return Promise.resolve({ data: [
          { id: 1, full_name: "Test User", username: "tester", email: "tester@example.com", role: "contributor", identity_number: "123", credits: 5, status: "pending" }
        ] });
      }
      if (url.includes("/admin/categories")) {
        return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      }
      if (url.includes("/admin/collections")) {
        return Promise.resolve({ data: [{ id: 1, name: "Nature" }] });
      }
      return Promise.resolve({ data: [{ id: 1, title: "Live asset", status: "approved", filename: "asset.jpg", category: "Images", keywords: "", description: "", type: "image" }] });
    });
    axios.put.mockResolvedValue({ data: { id: 1, full_name: "Test User", username: "tester", email: "tester@example.com", role: "contributor", identity_number: "123", credits: 5, status: "active" } });

    render(<AdminPanel />);

    expect(await screen.findByText(/^Activate$/i)).toBeInTheDocument();
    expect(screen.getByText(/^Block$/i)).toBeInTheDocument();
    expect(screen.getByText(/^Modify$/i)).toBeInTheDocument();
    expect(screen.getByText(/^Delete$/i)).toBeInTheDocument();

    fireEvent.click(screen.getByText(/^Modify$/i));
    const editUserDialog = screen.getByRole("dialog", { name: "Edit User" });
    expect(editUserDialog).toHaveStyle({ maxHeight: "90vh", overflowY: "auto" });
    expect(within(editUserDialog).getByPlaceholderText(/full name/i)).toBeInTheDocument();
    expect(within(editUserDialog).getByPlaceholderText(/username/i)).toBeInTheDocument();
    expect(within(editUserDialog).getByRole("button", { name: /^save$/i })).toBeInTheDocument();
  });

  it("closes the edit user dialog on backdrop click without saving changes", async () => {
    useLocation.mockReturnValue({ search: "?tab=users" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/users")) {
        return Promise.resolve({ data: [
          { id: 81, full_name: "Backdrop User", username: "backdrop-user", email: "backdrop@example.com", role: "customer", status: "active" }
        ] });
      }
      if (url.includes("/admin/categories")) return Promise.resolve({ data: [] });
      if (url.includes("/admin/collections")) return Promise.resolve({ data: [] });
      return Promise.resolve({ data: [] });
    });

    render(<AdminPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Modify" }));
    fireEvent.change(screen.getByPlaceholderText("Full name"), { target: { value: "Unsaved Name" } });

    const dialog = screen.getByRole("dialog", { name: "Edit User" });
    fireEvent.click(dialog.parentElement);

    expect(screen.queryByRole("dialog", { name: "Edit User" })).not.toBeInTheDocument();
    expect(axios.put).not.toHaveBeenCalled();
    expect(screen.getByText("Backdrop User")).toBeInTheDocument();
  });

  it("starts a 60-minute cooling period before deleting a user", async () => {
    useLocation.mockReturnValue({ search: "?tab=users" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/users")) {
        return Promise.resolve({ data: [{ id: 1, full_name: "Cooling User", username: "cooling", role: "customer", status: "active" }] });
      }
      return Promise.resolve({ data: [] });
    });
    axios.delete.mockResolvedValue({
      status: 202,
      data: {
        user: {
          id: 1,
          full_name: "Cooling User",
          username: "cooling",
          role: "customer",
          status: "active",
          deletion_requested_at: new Date(Date.now() + 60 * 60 * 1000).toISOString()
        }
      }
    });

    render(<AdminPanel />);

    fireEvent.click(await screen.findByRole("button", { name: /^delete$/i }));
    expect(screen.getByText(/60-minute cooling period/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /start deletion period/i }));

    await waitFor(() => {
      expect(axios.delete).toHaveBeenCalledWith(
        expect.stringContaining("/admin/users/1"),
        expect.anything()
      );
    });
    expect(await screen.findByText(/deletion cooling period/i)).toBeInTheDocument();
  });

  it("offers a delete now option for immediate permanent deletion", async () => {
    useLocation.mockReturnValue({ search: "?tab=users" });
    window.confirm = jest.fn().mockReturnValue(true);
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/users")) {
        return Promise.resolve({ data: [{ id: 1, full_name: "Immediate User", username: "immediate", role: "customer", status: "active" }] });
      }
      return Promise.resolve({ data: [] });
    });
    axios.delete.mockResolvedValue({
      status: 200,
      data: { id: 1, full_name: "Immediate User", username: "immediate", role: "customer", status: "deleted" }
    });

    render(<AdminPanel />);

    fireEvent.click(await screen.findByRole("button", { name: /^delete$/i }));
    expect(screen.getByRole("button", { name: /delete now/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /delete now/i }));

    await waitFor(() => {
      expect(axios.delete).toHaveBeenCalledWith(
        expect.stringContaining("/admin/users/1/force-delete"),
        expect.anything()
      );
    });
  });

});
