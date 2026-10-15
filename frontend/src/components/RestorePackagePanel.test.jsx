import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import axios from "axios";
import RestorePackagePanel from "./RestorePackagePanel";

jest.mock("axios", () => jest.fn());

describe("RestorePackagePanel", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    axios.mockReset();
    window.sessionStorage.clear();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("starts a real authenticated package job and shows its verified downloads", async () => {
    const readyJob = {
      id: "GFX-restore-test",
      status: "READY",
      elapsedMs: 9000,
      currentOperation: "Restore package is ready for authorized download.",
      progress: { completed: 9, total: 9, percent: 100 },
      sourceProgress: { filesCompleted: 5, filesTotal: 5, bytesCompleted: 200, bytesTotal: 200 },
      tasks: [{ id: "database", name: "Generate database backup", status: "COMPLETED", percent: 100 }],
      artifacts: [{ id: "database", label: "PostgreSQL database backup", filename: "stocksite.backup", sizeBytes: 200, downloadUrl: "/admin/backup/restore-package/jobs/GFX-restore-test/artifacts/database" }]
    };
    axios.mockImplementation(({ method, url }) => {
      if (method === "post" && url.endsWith("/restore-package/start")) {
        return Promise.resolve({ data: { job: {
          ...readyJob,
          status: "RUNNING",
          currentOperation: "Configured server sources validated; beginning collection.",
          progress: { completed: 1, total: 9, percent: 11 },
          sourceProgress: null,
          tasks: [{ id: "validate", name: "Validate sources", status: "COMPLETED", percent: 100 }],
          artifacts: []
        } } });
      }
      if (method === "get" && url.endsWith("/restore-package/jobs/GFX-restore-test")) {
        return Promise.resolve({ data: { job: readyJob } });
      }
      return Promise.reject(new Error(`Unexpected request: ${method} ${url}`));
    });

    render(<RestorePackagePanel apiBaseUrl="http://localhost:5000" getAuthToken={() => "test-token"} />);
    const panel = screen.getByRole("region", { name: /restore package generator/i });
    expect(within(panel).getByRole("note")).toHaveTextContent(/supported 64-bit Windows 11 \(build 26200\+\/25H2\+\), Node\.js 22\+/i);
    expect(within(panel).getByRole("note")).toHaveTextContent(/does not verify full source\/schema compatibility/i);
    expect(within(panel).getAllByRole("button")).toHaveLength(1);
    const startButton = within(panel).getByRole("button", { name: "START" });
    expect(startButton).toBeDisabled();
    fireEvent.click(within(panel).getByRole("checkbox"));
    expect(startButton).toBeEnabled();
    fireEvent.click(startButton);

    await waitFor(() => {
      expect(axios).toHaveBeenCalledWith(expect.objectContaining({
        method: "post",
        url: "http://localhost:5000/admin/backup/restore-package/start",
        headers: { Authorization: "Bearer test-token" },
        withCredentials: true,
        data: { includeEncryptedEnvironmentFiles: true }
      }));
    });
    const downloadButton = await within(panel).findByRole("button", { name: /Download PostgreSQL database backup/i });
    expect(within(panel).getByText(/Restore package is ready for authorized download/i)).toBeInTheDocument();
    expect(within(panel).getByText(/5\/5 files/i)).toBeInTheDocument();
    expect(window.sessionStorage.getItem("stocksite-restore-package-job")).toBe("GFX-restore-test");

    expect(within(panel).getByText(/This verified file has not been requested/i)).toBeInTheDocument();
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ ticket: "a".repeat(43), filename: "stocksite.backup", sizeBytes: 200 })
    });
    let clickedDownloadUrl;
    let clickedReferrerPolicy;
    const anchorClick = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () {
      clickedDownloadUrl = this.href;
      clickedReferrerPolicy = this.referrerPolicy;
    });
    fireEvent.click(downloadButton);
    expect(await within(panel).findByText(/browser's Downloads panel/i)).toBeInTheDocument();
    const [ticketUrl, ticketRequest] = global.fetch.mock.calls[0];
    expect(ticketUrl).toBe("http://localhost:5000/admin/backup/restore-package/jobs/GFX-restore-test/artifacts/database/download-ticket");
    expect(ticketRequest.method).toBe("POST");
    expect(ticketRequest.headers.Authorization).toBe("Bearer test-token");
    expect(ticketRequest.credentials).toBe("include");
    expect(anchorClick).toHaveBeenCalledTimes(1);
    expect(clickedDownloadUrl).toContain("?ticket=");
    expect(clickedDownloadUrl).not.toContain("test-token");
    expect(clickedReferrerPolicy).toBe("no-referrer");
    fireEvent.click(within(panel).getByRole("button", { name: /I see this file completed in Downloads/i }));
    expect(within(panel).getByText(/You confirmed stocksite\.backup is complete/i)).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("button", { name: /Prepare another package/i }));
    expect(within(panel).getByRole("checkbox")).not.toBeChecked();
    expect(window.sessionStorage.getItem("stocksite-restore-package-job")).toBeNull();
  });

  it("shows a failed artifact download and allows a retry without buffering the artifact", async () => {
    const readyJob = {
      id: "GFX-download-failure",
      status: "READY",
      progress: { percent: 100 },
      tasks: [],
      artifacts: [{
        id: "originalAssets",
        label: "Original assets archive",
        filename: "original-assets.zip",
        sizeBytes: 815 * 1024 * 1024,
        downloadUrl: "/admin/backup/restore-package/jobs/GFX-download-failure/artifacts/originalAssets"
      }]
    };
    axios.mockResolvedValue({ data: { job: readyJob } });
    global.fetch
      .mockResolvedValueOnce({ ok: false, status: 503, headers: { get: () => null } })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ticket: "b".repeat(43),
          filename: "original-assets.zip",
          sizeBytes: 815 * 1024 * 1024
        })
      });
    const anchorClick = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    window.sessionStorage.setItem("stocksite-restore-package-job", readyJob.id);
    render(<RestorePackagePanel apiBaseUrl="http://localhost:5000" getAuthToken={() => "test-token"} />);
    fireEvent.click(await screen.findByRole("button", { name: /Resume or inspect previous package/i }));
    const download = await screen.findByRole("button", { name: /Download Original assets archive/i });
    fireEvent.click(download);
    expect(await screen.findByText(/The server could not prepare this file \(HTTP 503\)/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Retry Original assets archive/i }));
    expect(await screen.findByText(/browser's Downloads panel/i)).toBeInTheDocument();
    expect(anchorClick).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch.mock.calls.every(([, options]) => options.method === "POST")).toBe(true);
  });

  it("prevents duplicate artifact requests while the download is being checked", async () => {
    const readyJob = {
      id: "GFX-download-lock",
      status: "READY",
      progress: { percent: 100 },
      tasks: [],
      artifacts: [{
        id: "database",
        label: "PostgreSQL database backup",
        filename: "stocksite.backup",
        sizeBytes: 20,
        downloadUrl: "/admin/backup/restore-package/jobs/GFX-download-lock/artifacts/database"
      }]
    };
    axios.mockResolvedValue({ data: { job: readyJob } });
    let releaseTicket;
    global.fetch.mockReturnValue(new Promise((resolve) => { releaseTicket = resolve; }));
    const anchorClick = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    window.sessionStorage.setItem("stocksite-restore-package-job", readyJob.id);
    render(<RestorePackagePanel apiBaseUrl="http://localhost:5000" getAuthToken={() => "test-token"} />);

    fireEvent.click(await screen.findByRole("button", { name: /Resume or inspect previous package/i }));
    const button = await screen.findByRole("button", { name: /Download PostgreSQL database backup/i });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();

    releaseTicket({
      ok: true,
      json: async () => ({ ticket: "c".repeat(43), filename: "stocksite.backup", sizeBytes: 20 })
    });
    expect(await screen.findByText(/browser's Downloads panel/i)).toBeInTheDocument();
    expect(anchorClick).toHaveBeenCalledTimes(1);
  });

  it("reports configured-source errors returned by the server without claiming success", async () => {
    axios.mockRejectedValue({ response: { data: { error: "ASSETS_ROOT must be configured on SERVER." } } });
    render(<RestorePackagePanel apiBaseUrl="http://localhost:5000" getAuthToken={() => "test-token"} />);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "START" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/ASSETS_ROOT must be configured on SERVER/i);
    expect(screen.queryByText(/verified downloads/i)).not.toBeInTheDocument();
  });

  it("keeps the approval flow fresh when a previous job is failed", async () => {
    window.sessionStorage.setItem("stocksite-restore-package-job", "GFX-restore-failed");
    axios.mockImplementation(({ method, url }) => {
      if (method === "get" && url.endsWith("/restore-package/jobs/GFX-restore-failed")) {
        return Promise.resolve({ data: { job: { id: "GFX-restore-failed", status: "FAILED" } } });
      }
      if (method === "post" && url.endsWith("/restore-package/start")) {
        return Promise.resolve({ data: { job: { id: "GFX-restore-new", status: "RUNNING", tasks: [] } } });
      }
      return Promise.reject(new Error(`Unexpected request: ${method} ${url}`));
    });

    render(<RestorePackagePanel apiBaseUrl="http://localhost:5000" getAuthToken={() => "test-token"} />);

    expect(await screen.findByRole("checkbox")).not.toBeChecked();
    expect(screen.getByRole("button", { name: "START" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Resume or inspect previous package/i })).toBeInTheDocument();
    expect(axios).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Resume or inspect previous package/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/previous package job failed .* remains recorded/i);
    expect(window.sessionStorage.getItem("stocksite-restore-package-job")).toBeNull();
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.getByRole("button", { name: "START" })).toBeDisabled();
    expect(screen.queryByRole("progressbar", { name: "Package preparation progress" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "START" }));
    await waitFor(() => {
      expect(axios).toHaveBeenCalledWith(expect.objectContaining({
        method: "post",
        data: { includeEncryptedEnvironmentFiles: true }
      }));
    });
    expect(window.sessionStorage.getItem("stocksite-restore-package-job")).toBe("GFX-restore-new");
  });

  it("opens fresh after refresh and resumes an active server job only on request", async () => {
    window.sessionStorage.setItem("stocksite-restore-package-job", "GFX-restore-active");
    axios.mockResolvedValue({
      data: {
        job: {
          id: "GFX-restore-active",
          status: "RUNNING",
          currentOperation: "Collecting verified sources",
          tasks: [],
          progress: { percent: 30 },
          artifacts: []
        }
      }
    });

    const { unmount } = render(<RestorePackagePanel apiBaseUrl="http://localhost:5000" getAuthToken={() => "test-token"} />);
    expect(await screen.findByRole("checkbox")).not.toBeChecked();
    expect(screen.getByRole("button", { name: "START" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Resume or inspect previous package/i })).toBeInTheDocument();
    expect(axios).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Resume or inspect previous package/i }));
    expect(await screen.findByText("Collecting verified sources")).toBeInTheDocument();
    expect(window.sessionStorage.getItem("stocksite-restore-package-job")).toBe("GFX-restore-active");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    unmount();
  });

  it("returns a persisted RUNNING job marked stale after backend restart to fresh approval", async () => {
    window.sessionStorage.setItem("stocksite-restore-package-job", "GFX-restore-after-restart");
    axios.mockResolvedValue({
      data: {
        job: {
          id: "GFX-restore-after-restart",
          status: "FAILED",
          error: "The SERVER restarted before package generation finished.",
          tasks: []
        }
      }
    });

    render(<RestorePackagePanel apiBaseUrl="http://localhost:5000" getAuthToken={() => "test-token"} />);
    expect(await screen.findByRole("checkbox")).not.toBeChecked();
    expect(screen.getByRole("button", { name: "START" })).toBeDisabled();
    expect(screen.queryByText(/Package preparation progress/i)).not.toBeInTheDocument();
    expect(axios).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Resume or inspect previous package/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/previous package job failed .* remains recorded/i);
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.getByRole("button", { name: "START" })).toBeDisabled();
    expect(window.sessionStorage.getItem("stocksite-restore-package-job")).toBeNull();
  });
});
