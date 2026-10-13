import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import axios from "axios";
import RestorePackagePanel from "./RestorePackagePanel";

jest.mock("axios", () => jest.fn());

describe("RestorePackagePanel", () => {
  beforeEach(() => {
    axios.mockReset();
    window.sessionStorage.clear();
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
    expect(await within(panel).findByRole("button", { name: /Download PostgreSQL database backup/i })).toBeInTheDocument();
    expect(within(panel).getByText(/Restore package is ready for authorized download/i)).toBeInTheDocument();
    expect(within(panel).getByText(/5\/5 files/i)).toBeInTheDocument();
    expect(window.sessionStorage.getItem("stocksite-restore-package-job")).toBe("GFX-restore-test");
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
