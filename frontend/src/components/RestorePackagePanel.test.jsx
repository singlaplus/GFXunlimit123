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
});
