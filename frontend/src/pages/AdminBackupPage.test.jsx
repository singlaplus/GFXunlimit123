import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import axios from "axios";
import AdminBackupPage from "./AdminBackupPage";

jest.mock("axios", () => jest.fn());
jest.mock("react-toastify", () => ({
  toast: { info: jest.fn(), success: jest.fn(), error: jest.fn() }
}));

describe("AdminBackupPage", () => {
  beforeEach(() => {
    axios.mockReset();
    axios.mockImplementation(({ method, url, data }) => {
      if (method === "get" && url.endsWith("/jobs/active")) return Promise.resolve({ data: { job: null } });
      if (method === "get" && url.endsWith("/history")) return Promise.resolve({ data: { jobs: [] } });
      if (method === "get" && url.endsWith("/automatic")) return Promise.resolve({ data: { schedule: {
        configured: false,
        enabled: false,
        destination: "",
        selectedTypes: ["database", "websiteCode"],
        frequency: "daily",
        time: "02:00",
        weeklyDay: 0,
        monthlyDay: 1,
        timezone: "Asia/Kolkata",
        nextRun: null,
        lastRun: null
      } } });
      if (method === "get" && url.endsWith("/sources")) return Promise.resolve({ data: { sources: {
        measuredAt: "2026-10-07T12:00:00.000Z",
        database: { available: true, name: "stocksite", version: "PostgreSQL 18.6", sourceServer: "PC2", currentBytes: 1024 },
        websiteCode: { available: true, currentBytes: 2048, encryptedEnvironmentFiles: 2, files: 10 },
        assets: { available: true, originalRoot: "F:\\GFXunlimitAssets", originalBytes: 4096, thumbnailRoot: "F:\\GFXunlimitThumbnails", thumbnailBytes: 512, totalBytes: 4608 }
      } } });
      if (method === "post" && url.endsWith("/test-connection")) {
        const destinationPath = url.includes("automatic") ? "D:\\GFXunlimitBackups" : "D:\\GFXunlimitBackups";
        return Promise.resolve({ data: { drives: [{ path: destinationPath, totalBytes: 100000, usedBytes: 1000, availableBytes: 99000, safetyLimitBytes: 90000, usableBackupBytes: 89000, status: "READY" }] } });
      }
      if (method === "post" && url.endsWith("/plan")) {
        return Promise.resolve({ data: { ready: true, selectedTypes: ["database"], database: { name: "stocksite", version: "PostgreSQL 18.6", sourceServer: "PC2", estimatedBytes: 1024, pgDump: { available: true, version: "pg_dump 18.6" } }, categories: { database: { plannedBytes: 10000, estimatedBytes: 1024 }, websiteCode: { plannedBytes: 0 }, originalAssets: { plannedBytes: 0, estimatedBytes: 0, users: [] }, thumbnails: { plannedBytes: 0, estimatedBytes: 0 } }, totalRequiredBytes: 10000, filesTotal: 1, drives: [{ driveNumber: 1, path: "D:\\GFXunlimitBackups", actualCapacityBytes: 100000, currentUsedBytes: 1000, currentAvailableBytes: 99000, safetyLimitBytes: 90000, usableBackupBytes: 89000, requiredBytes: 10000, remainingSafeBytes: 79000, status: "READY", groups: [] }], issues: [] } });
      }
      if (method === "get" && /\/jobs\/[^/]+\/export$/.test(url)) return Promise.resolve({ data: { files: [{ path: "manifest.json", sizeBytes: 4 }] } });
      if (method === "delete" && /\/jobs\/[^/]+\/export$/.test(url)) return Promise.resolve({ status: 204 });
      if (method === "post" && url.endsWith("/start")) return Promise.resolve({ data: {
        id: "GFX-TEST",
        status: "SUCCESS",
        backupType: "MANUAL",
        clientExport: data?.destinationMode === "mac-local",
        verificationStatus: "VERIFIED",
        progress: { percent: 100 },
        selectedTypes: ["database"],
        drives: []
      } });
      if (method === "put" && url.endsWith("/automatic")) return Promise.resolve({ data: { schedule: { configured: true, enabled: false, destination: "D:\\GFXunlimitBackups", selectedTypes: ["database", "websiteCode"], frequency: "daily", time: "02:00", timezone: "Asia/Kolkata", nextRun: null, lastRun: null } } });
      return Promise.reject(new Error(`Unexpected API request: ${method} ${url}`));
    });
  });

  afterEach(() => {
    delete window.showDirectoryPicker;
    delete global.fetch;
  });

  test("shows exactly the three complete backup categories and no incremental option", async () => {
    render(<AdminBackupPage isDarkMode={false} apiBaseUrl="http://localhost:5000" getAuthToken={() => "token"} />);
    const categoryCards = await screen.findByLabelText("Backup categories");
    expect(categoryCards.querySelectorAll('input[type="checkbox"]')).toHaveLength(3);
    expect(categoryCards).toHaveTextContent("Database");
    expect(categoryCards).toHaveTextContent("Website Code + .env");
    expect(categoryCards).toHaveTextContent("Assets + Thumbnails");
    expect(await within(categoryCards).findByText("1.00 KB")).toBeInTheDocument();
    expect(categoryCards).toHaveTextContent("1.00 KB");
    expect(categoryCards).toHaveTextContent("2.00 KB");
    expect(categoryCards).toHaveTextContent("4.00 KB");
    expect(categoryCards).toHaveTextContent("512 B");
    expect(await screen.findByText("Selected Backup Size: 7.50 KB")).toBeInTheDocument();
    expect(screen.queryByText(/incremental/i)).not.toBeInTheDocument();
    expect(screen.getAllByText("Test Connection")).toHaveLength(2);
    expect(screen.queryByText("Start Complete Backup")).not.toBeInTheDocument();
  });

  test("selected source size recalculates and Browse selects a local folder without changing the server destination", async () => {
    render(<AdminBackupPage isDarkMode={false} apiBaseUrl="http://localhost:5000" getAuthToken={() => "token"} />);
    const cards = await screen.findByLabelText("Backup categories");
    const [databaseCheckbox, websiteCheckbox, assetsCheckbox] = cards.querySelectorAll('input[type="checkbox"]');
    await within(cards).findByText("1.00 KB");
    fireEvent.click(websiteCheckbox);
    expect(await screen.findByText("Selected Backup Size: 5.50 KB")).toBeInTheDocument();
    fireEvent.click(assetsCheckbox);
    expect(await screen.findByText("Selected Backup Size: 1.00 KB")).toBeInTheDocument();

    const picker = jest.fn().mockResolvedValue({ name: "MacBackups" });
    Object.defineProperty(window, "showDirectoryPicker", { configurable: true, value: picker });
    const destination = screen.getByLabelText("Destination path");
    fireEvent.change(destination, { target: { value: "D:\\ExistingServerBackup" } });
    await act(async () => {
      fireEvent.click(within(destination.closest(".gfx-backup-drive-card")).getByRole("button", { name: "Change" }));
    });

    expect(picker).toHaveBeenCalledWith({ mode: "read" });
    expect(await screen.findByText("MacBackups")).toBeInTheDocument();
    expect(destination).toHaveValue("D:\\ExistingServerBackup");
    expect(axios).not.toHaveBeenCalledWith(expect.objectContaining({ url: expect.stringContaining("/browse") }));
    expect(screen.getByText(/does not make it writable by server-side jobs/i)).toBeInTheDocument();
  });

  test("Browse on an unsupported browser reports the limitation without calling the server Browse API", async () => {
    render(<AdminBackupPage isDarkMode={false} apiBaseUrl="http://localhost:5000" getAuthToken={() => "token"} />);
    await screen.findByLabelText("Destination path");

    fireEvent.click(screen.getAllByRole("button", { name: "Browse this computer" })[0]);

    expect(await screen.findByRole("alert")).toHaveTextContent(/Local folder selection is unavailable/i);
    expect(axios).not.toHaveBeenCalledWith(expect.objectContaining({ url: expect.stringContaining("/browse") }));
  });

  test("automatic Browse selects a local folder without changing the saved server destination", async () => {
    render(<AdminBackupPage isDarkMode={false} apiBaseUrl="http://localhost:5000" getAuthToken={() => "token"} />);
    const automaticDestination = await screen.findByLabelText("Automatic Backup Location");
    fireEvent.change(automaticDestination, { target: { value: "D:\\ExistingAutomaticBackup" } });
    const picker = jest.fn().mockResolvedValue({ name: "LocalAutomaticBackups" });
    Object.defineProperty(window, "showDirectoryPicker", { configurable: true, value: picker });

    await act(async () => {
      fireEvent.click(within(automaticDestination.parentElement).getByRole("button", { name: "Change" }));
    });

    expect(await screen.findByText("LocalAutomaticBackups")).toBeInTheDocument();
    expect(automaticDestination).toHaveValue("D:\\ExistingAutomaticBackup");
    expect(axios).not.toHaveBeenCalledWith(expect.objectContaining({ url: expect.stringContaining("/browse") }));
  });

  test("tests the destination and submits a complete plan before starting", async () => {
    render(<AdminBackupPage isDarkMode={false} apiBaseUrl="http://localhost:5000" getAuthToken={() => "token"} />);
    const categoryCards = await screen.findByLabelText("Backup categories");
    const categoryCheckboxes = categoryCards.querySelectorAll('input[type="checkbox"]');
    fireEvent.click(categoryCheckboxes[1]);
    fireEvent.click(categoryCheckboxes[2]);
    const destination = screen.getByLabelText("Destination path");
    fireEvent.change(destination, { target: { value: "D:\\GFXunlimitBackups" } });
    fireEvent.click(screen.getAllByText("Test Connection")[0]);
    await waitFor(() => expect(axios).toHaveBeenCalledWith(expect.objectContaining({
      method: "post",
      url: "http://localhost:5000/admin/backup/test-connection"
    })));
    await screen.findByText("READY");
    fireEvent.click(screen.getByText("Build Complete Backup Plan"));
    await screen.findByText(/stocksite.*PostgreSQL 18/i);
    await waitFor(() => expect(screen.getByText("Start Complete Backup")).not.toBeDisabled());
    fireEvent.click(screen.getByText("Start Complete Backup"));
    await waitFor(() => expect(axios).toHaveBeenCalledWith(expect.objectContaining({
      method: "post",
      url: "http://localhost:5000/admin/backup/start",
      data: expect.objectContaining({ categories: ["database"] })
    })));
  });

  test("manual Mac backup streams verified files through the selected folder handle", async () => {
    const written = [];
    const fileHandle = {
      async createWritable() {
        return {
          async write(chunk) { written.push(String.fromCharCode(...chunk)); },
          async close() {},
          async abort() {}
        };
      },
      async getFile() { return { size: 4 }; }
    };
    const handles = {};
    const makeDirectory = (key) => ({
      async getDirectoryHandle(name, options = {}) {
        const childKey = `${key}/${name}`;
        if (!handles[childKey] && !options.create) {
          const error = new Error("Directory not found");
          error.name = "NotFoundError";
          throw error;
        }
        if (!handles[childKey]) handles[childKey] = makeDirectory(childKey);
        return handles[childKey];
      },
      async getFileHandle() { return fileHandle; },
      async removeEntry() {}
    });
    const directory = {
      name: "MacBackups",
      async queryPermission() { return "granted"; },
      getDirectoryHandle: makeDirectory("").getDirectoryHandle
    };
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: jest.fn().mockResolvedValue(directory)
    });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      body: {
        async pipeTo(writable) {
          await writable.write(new Uint8Array([116, 101, 115, 116]));
          await writable.close();
        }
      }
    });
    render(<AdminBackupPage isDarkMode={false} apiBaseUrl="http://localhost:5000" getAuthToken={() => "token"} />);

    fireEvent.click(await screen.findByLabelText("This Mac"));
    fireEvent.click(screen.getByRole("button", { name: "Choose Mac folder" }));
    await screen.findByText("MacBackups");
    fireEvent.click(screen.getByRole("button", { name: "Build Complete Backup Plan" }));
    await waitFor(() => expect(axios).toHaveBeenCalledWith(expect.objectContaining({
      method: "post",
      url: "http://localhost:5000/admin/backup/plan",
      data: expect.objectContaining({ destinationMode: "mac-local" })
    })));
    fireEvent.click(await screen.findByRole("button", { name: "Start Mac-local Backup" }));
    await screen.findByRole("button", { name: "Transfer verified backup to Mac" });
    fireEvent.click(screen.getByRole("button", { name: "Transfer verified backup to Mac" }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(screen.queryAllByRole("alert").map((element) => element.textContent)).toEqual([]);
    expect(await screen.findByRole("button", { name: "Transferred to Mac" })).toBeDisabled();
    expect(written).toEqual(["test"]);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/jobs/GFX-TEST/export/file?path=manifest.json"),
      expect.objectContaining({ credentials: "include" })
    );
    expect(axios).toHaveBeenCalledWith(expect.objectContaining({
      method: "delete",
      url: "http://localhost:5000/admin/backup/jobs/GFX-TEST/export"
    }));
    expect(axios.mock.calls.some(([request]) => (
      request.method === "post" &&
      (request.url.endsWith("/plan") || request.url.endsWith("/start")) &&
      JSON.stringify(request.data).includes("MacBackups")
    ))).toBe(false);
  });

  test("automatic schedule defaults to database and Website Code and saves configured frequency", async () => {
    render(<AdminBackupPage isDarkMode={false} apiBaseUrl="http://localhost:5000" getAuthToken={() => "token"} />);
    const allCheckboxes = await screen.findAllByRole("checkbox");
    expect(allCheckboxes).toHaveLength(7);
    expect(allCheckboxes[4]).toBeChecked();
    expect(allCheckboxes[5]).toBeChecked();
    expect(allCheckboxes[6]).not.toBeChecked();
    fireEvent.change(screen.getByLabelText("Automatic Backup Location"), { target: { value: "D:\\GFXunlimitBackups" } });
    fireEvent.change(screen.getByLabelText("Frequency"), { target: { value: "monthly" } });
    fireEvent.change(screen.getByLabelText("Time (IST)"), { target: { value: "03:15" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Schedule" }));
    await waitFor(() => expect(axios).toHaveBeenCalledWith(expect.objectContaining({
      method: "put",
      url: "http://localhost:5000/admin/backup/automatic",
      data: expect.objectContaining({
        frequency: "monthly",
        time: "03:15",
        selectedTypes: ["database", "websiteCode"]
      })
    })));
  });
});
