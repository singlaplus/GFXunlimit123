import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import axios from "axios";
import AdminBackupPage from "./AdminBackupPage";

jest.mock("axios", () => jest.fn());
jest.mock("react-toastify", () => ({
  toast: { info: jest.fn(), success: jest.fn(), error: jest.fn() }
}));

const exportPayloadPath = "Website-Code/backend/server.js";
const exportPayload = "test";
const exportPayloadSha256 = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
const exportChecksums = `${exportPayloadSha256} 4 ${exportPayloadPath}\n`;
const exportManifest = JSON.stringify({
  format: "GFXUNLIMIT-BACKUP-SET",
  backupSetId: "GFX-TEST",
  backupType: "MANUAL",
  status: "SUCCESS",
  verificationStatus: "VERIFIED",
  selectedTypes: ["database"],
  totals: { files: 1 }
});
const exportContents = {
  "checksums.sha256": exportChecksums,
  "manifest.json": exportManifest,
  [exportPayloadPath]: exportPayload
};
const exportFiles = Object.entries(exportContents).map(([filePath, contents]) => ({
  path: filePath,
  sizeBytes: contents.length
}));

function makeBrowserDirectory(name = "MacBackups") {
  const files = new Map();
  const directories = new Map();
  const makeFile = (filePath) => {
    if (!files.has(filePath)) {
      let bytes = new Uint8Array();
      files.set(filePath, {
        async createWritable() {
          const chunks = [];
          return {
            async write(chunk) {
              chunks.push(typeof chunk === "string"
                ? Uint8Array.from(chunk, (character) => character.charCodeAt(0))
                : new Uint8Array(chunk));
            },
            async close() {
              const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
              bytes = new Uint8Array(size);
              let offset = 0;
              for (const chunk of chunks) {
                bytes.set(chunk, offset);
                offset += chunk.length;
              }
            },
            async abort() {}
          };
        },
        async getFile() {
          const snapshot = new Uint8Array(bytes);
          return {
            size: snapshot.length,
            async text() { return String.fromCharCode(...snapshot); },
            stream() {
              let read = false;
              return {
                getReader: () => ({
                  async read() {
                    if (read) return { done: true };
                    read = true;
                    return { done: false, value: snapshot };
                  },
                  releaseLock() {}
                })
              };
            }
          };
        }
      });
    }
    return files.get(filePath);
  };
  const makeDirectory = (directoryPath) => {
    if (!directories.has(directoryPath)) {
      directories.set(directoryPath, {
        async getDirectoryHandle(childName, options = {}) {
          const childPath = directoryPath ? `${directoryPath}/${childName}` : childName;
          if (!directories.has(childPath) && !options.create) {
            const error = new Error("Directory not found");
            error.name = "NotFoundError";
            throw error;
          }
          return makeDirectory(childPath);
        },
        async getFileHandle(fileName, options = {}) {
          const filePath = directoryPath ? `${directoryPath}/${fileName}` : fileName;
          if (!files.has(filePath) && !options.create) {
            const error = new Error("File not found");
            error.name = "NotFoundError";
            throw error;
          }
          return makeFile(filePath);
        },
        async removeEntry(entryName, options = {}) {
          const entryPath = directoryPath ? `${directoryPath}/${entryName}` : entryName;
          files.delete(entryPath);
          if (options.recursive) {
            for (const key of files.keys()) if (key.startsWith(`${entryPath}/`)) files.delete(key);
            for (const key of directories.keys()) if (key === entryPath || key.startsWith(`${entryPath}/`)) directories.delete(key);
          }
          directories.delete(entryPath);
        }
      });
    }
    return directories.get(directoryPath);
  };
  return {
    name,
    files,
    async queryPermission() { return "granted"; },
    async requestPermission() { return "granted"; },
    getDirectoryHandle: (...args) => makeDirectory("").getDirectoryHandle(...args),
    getFileHandle: (...args) => makeDirectory("").getFileHandle(...args),
    removeEntry: (...args) => makeDirectory("").removeEntry(...args)
  };
}

describe("AdminBackupPage", () => {
  beforeEach(() => {
    axios.mockReset();
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: jest.fn().mockResolvedValue(makeBrowserDirectory())
    });
    axios.mockImplementation(({ method, url, data }) => {
      if (method === "get" && url.endsWith("/jobs/active")) return Promise.resolve({ data: { job: null } });
      if (method === "get" && url.endsWith("/history")) return Promise.resolve({ data: { jobs: [] } });
      if (method === "get" && url.includes("/browse")) {
        const selectedPath = new URL(url).searchParams.get("path");
        return Promise.resolve({ data: {
          currentPath: selectedPath,
          parentPath: null,
          directories: selectedPath ? [] : [{ name: "D:\\Backups", path: "D:\\Backups" }]
        } });
      }
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
        const destinationPath = data?.path || "D:\\GFXunlimitBackups";
        return Promise.resolve({ data: { drives: [{ path: destinationPath, totalBytes: 100000, usedBytes: 1000, availableBytes: 99000, safetyLimitBytes: 90000, usableBackupBytes: 89000, status: "READY" }] } });
      }
      if (method === "post" && url.endsWith("/plan")) {
        return Promise.resolve({ data: { ready: true, selectedTypes: ["database"], database: { name: "stocksite", version: "PostgreSQL 18.6", sourceServer: "PC2", estimatedBytes: 1024, pgDump: { available: true, version: "pg_dump 18.6" } }, categories: { database: { plannedBytes: 10000, estimatedBytes: 1024 }, websiteCode: { plannedBytes: 0 }, originalAssets: { plannedBytes: 0, estimatedBytes: 0, users: [] }, thumbnails: { plannedBytes: 0, estimatedBytes: 0 } }, totalRequiredBytes: 10000, filesTotal: 1, drives: [{ driveNumber: 1, path: "D:\\GFXunlimitBackups", actualCapacityBytes: 100000, currentUsedBytes: 1000, currentAvailableBytes: 99000, safetyLimitBytes: 90000, usableBackupBytes: 89000, requiredBytes: 10000, remainingSafeBytes: 79000, status: "READY", groups: [] }], issues: [] } });
      }
      if (method === "get" && /\/jobs\/[^/]+\/export$/.test(url)) return Promise.resolve({ data: { files: exportFiles } });
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

  test("selected source size recalculates and the manual destination uses Browse", async () => {
    render(<AdminBackupPage isDarkMode={false} apiBaseUrl="http://localhost:5000" getAuthToken={() => "token"} />);
    const cards = await screen.findByLabelText("Backup categories");
    const [databaseCheckbox, websiteCheckbox, assetsCheckbox] = cards.querySelectorAll('input[type="checkbox"]');
    await within(cards).findByText("1.00 KB");
    fireEvent.click(websiteCheckbox);
    expect(await screen.findByText("Selected Backup Size: 5.50 KB")).toBeInTheDocument();
    fireEvent.click(assetsCheckbox);
    expect(await screen.findByText("Selected Backup Size: 1.00 KB")).toBeInTheDocument();

    const picker = jest.fn().mockResolvedValue(makeBrowserDirectory("LocalBackups"));
    Object.defineProperty(window, "showDirectoryPicker", { configurable: true, value: picker });
    expect(screen.queryByText("Folder accessible to the backend server")).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Browse this computer" })[0]);
    expect(picker).toHaveBeenCalledWith({ mode: "readwrite" });
    await waitFor(() => expect(screen.getByLabelText("Selected folder")).toHaveValue("LocalBackups"));
    expect(screen.getByText("Manual destination type")).toBeInTheDocument();
    expect(screen.getByLabelText("Backup server")).toBeInTheDocument();
    expect(screen.queryByLabelText("Backup destination path")).not.toBeInTheDocument();
    expect(axios).not.toHaveBeenCalledWith(expect.objectContaining({ url: expect.stringContaining("/browse") }));
  });

  test("unsupported browser reports the local-folder limitation without calling the server Browse API", async () => {
    delete window.showDirectoryPicker;
    render(<AdminBackupPage isDarkMode={false} apiBaseUrl="http://localhost:5000" getAuthToken={() => "token"} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Browse this computer" })[0]);

    expect(await screen.findByRole("alert")).toHaveTextContent(/Local folder selection is unavailable/i);
    expect(axios).not.toHaveBeenCalledWith(expect.objectContaining({ url: expect.stringContaining("/browse") }));
  });

  test("Browse this computer selects the only manual destination without sending a local path to the server", async () => {
    const directory = makeBrowserDirectory("CurrentComputerBackups");
    const picker = jest.fn().mockResolvedValue(directory);
    Object.defineProperty(window, "showDirectoryPicker", { configurable: true, value: picker });
    render(<AdminBackupPage isDarkMode={false} apiBaseUrl="http://localhost:5000" getAuthToken={() => "token"} />);
    fireEvent.click((await screen.findAllByRole("button", { name: "Browse this computer" }))[0]);

    expect(picker).toHaveBeenCalledWith({ mode: "readwrite" });
    expect(await screen.findByLabelText("Selected folder")).toHaveValue("CurrentComputerBackups");
    expect(screen.getByRole("button", { name: "Build Complete Backup Plan" })).toBeDisabled();
    expect(axios.mock.calls.some(([request]) => (
      request.url.includes("/test-connection") &&
      JSON.stringify(request.data).includes("CurrentComputerBackups")
    ))).toBe(false);
  });

  test("server manual destination is tested, and changing it invalidates its test and plan", async () => {
    render(<AdminBackupPage isDarkMode={false} apiBaseUrl="http://localhost:5000" getAuthToken={() => "token"} />);
    fireEvent.click(await screen.findByLabelText("Backup server"));
    const serverPath = screen.getByLabelText("Selected server folder");
    fireEvent.change(serverPath, { target: { value: "D:\\FirstBackup" } });
    const buildPlan = screen.getByRole("button", { name: "Build Complete Backup Plan" });
    expect(buildPlan).toBeDisabled();

    fireEvent.click(screen.getAllByRole("button", { name: "Test Connection" })[0]);
    await screen.findByText("Selected destination tested successfully.");
    expect(axios).toHaveBeenCalledWith(expect.objectContaining({
      method: "post",
      url: "http://localhost:5000/admin/backup/test-connection",
      data: { path: "D:\\FirstBackup" }
    }));
    expect(buildPlan).toBeEnabled();

    fireEvent.change(serverPath, { target: { value: "D:\\SecondBackup" } });
    expect(buildPlan).toBeDisabled();
    expect(screen.queryByText("Selected destination tested successfully.")).not.toBeInTheDocument();
  });

  test("server manual backup builds and starts against the tested server path", async () => {
    render(<AdminBackupPage isDarkMode={false} apiBaseUrl="http://localhost:5000" getAuthToken={() => "token"} />);
    fireEvent.click(await screen.findByLabelText("Backup server"));
    fireEvent.change(screen.getByLabelText("Selected server folder"), { target: { value: "D:\\ManualBackups" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Test Connection" })[0]);
    await screen.findByText("Selected destination tested successfully.");
    fireEvent.click(screen.getByRole("button", { name: "Build Complete Backup Plan" }));
    await screen.findByRole("region", { name: "Backup plan" });
    fireEvent.click(screen.getByRole("button", { name: "Start Manual Backup" }));
    await waitFor(() => expect(axios).toHaveBeenCalledWith(expect.objectContaining({
      method: "post",
      url: "http://localhost:5000/admin/backup/start",
      data: { categories: ["database", "websiteCode", "assetsAndThumbnails"], destinationMode: "server", destinations: ["D:\\ManualBackups"] }
    })));
    expect(axios.mock.calls.some(([request]) => (
      request.url.endsWith("/start") && request.data?.destinationMode === "mac-local"
    ))).toBe(false);
  });

  test("server folder browsing uses the backend browser and never sets the automatic destination", async () => {
    render(<AdminBackupPage isDarkMode={false} apiBaseUrl="http://localhost:5000" getAuthToken={() => "token"} />);
    fireEvent.click(await screen.findByLabelText("Backup server"));
    fireEvent.click(screen.getByRole("button", { name: "Browse server folders" }));
    expect(await screen.findByText("D:\\Backups")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "D:\\Backups" }));
    expect(await screen.findByText("Server location: D:\\Backups")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Use this server folder" }));
    expect(screen.getByLabelText("Selected server folder")).toHaveValue("D:\\Backups");
    expect(screen.getByLabelText("Automatic Backup Location")).toHaveValue("");
    expect(axios).toHaveBeenCalledWith(expect.objectContaining({
      method: "get",
      url: "http://localhost:5000/admin/backup/browse"
    }));
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

  test("unsafe plan validation shows one actionable error and never starts the backup", async () => {
    const defaultImplementation = axios.getMockImplementation();
    axios.mockImplementation((config) => (
      config.method === "post" && config.url.endsWith("/plan")
        ? Promise.resolve({ data: { ready: false, issues: ["The selected destination has insufficient safe capacity."] } })
        : defaultImplementation(config)
    ));
    render(<AdminBackupPage isDarkMode={false} apiBaseUrl="http://localhost:5000" getAuthToken={() => "token"} />);
    fireEvent.click((await screen.findAllByRole("button", { name: "Browse this computer" }))[0]);
    await waitFor(() => expect(screen.getByLabelText("Selected folder")).toHaveValue("MacBackups"));
    fireEvent.click(screen.getAllByText("Test Connection")[0]);
    await screen.findByText("Selected destination tested successfully.");
    fireEvent.click(screen.getByRole("button", { name: "Build Complete Backup Plan" }));

    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent(/insufficient safe capacity/i);
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Start Manual Backup" })).not.toBeInTheDocument();
    expect(axios.mock.calls.some(([request]) => request.url.endsWith("/start"))).toBe(false);
  });

  test("changing a tested Mac folder invalidates its destination test and plan eligibility", async () => {
    const picker = jest.fn()
      .mockResolvedValueOnce(makeBrowserDirectory("FirstMacFolder"))
      .mockResolvedValueOnce(makeBrowserDirectory("SecondMacFolder"));
    Object.defineProperty(window, "showDirectoryPicker", { configurable: true, value: picker });
    render(<AdminBackupPage isDarkMode={false} apiBaseUrl="http://localhost:5000" getAuthToken={() => "token"} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Browse this computer" })[0]);
    await waitFor(() => expect(screen.getByLabelText("Selected folder")).toHaveValue("FirstMacFolder"));
    fireEvent.click(screen.getAllByText("Test Connection")[0]);
    await screen.findByText("Selected destination tested successfully.");
    const buildPlan = screen.getByRole("button", { name: "Build Complete Backup Plan" });
    expect(buildPlan).toBeEnabled();
    fireEvent.click(screen.getAllByRole("button", { name: "Browse this computer" })[0]);
    await waitFor(() => expect(screen.getByLabelText("Selected folder")).toHaveValue("SecondMacFolder"));
    expect(buildPlan).toBeDisabled();
  });

  test("manual Mac backup tests the chosen folder and automatically streams and verifies the complete set", async () => {
    const directory = makeBrowserDirectory();
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: jest.fn().mockResolvedValue(directory)
    });
    global.fetch = jest.fn(async (url) => {
      const filePath = new URL(url).searchParams.get("path");
      const bytes = Uint8Array.from(exportContents[filePath], (character) => character.charCodeAt(0));
      return {
        ok: true,
        body: {
          async pipeTo(writable) {
            await writable.write(bytes);
            await writable.close();
          }
        }
      };
    });
    render(<AdminBackupPage isDarkMode={false} apiBaseUrl="http://localhost:5000" getAuthToken={() => "token"} />);

    fireEvent.click(screen.getAllByRole("button", { name: "Browse this computer" })[0]);
    await waitFor(() => expect(screen.getByLabelText("Selected folder")).toHaveValue("MacBackups"));
    expect(window.showDirectoryPicker).toHaveBeenCalledWith({ mode: "readwrite" });
    const buildPlan = screen.getByRole("button", { name: "Build Complete Backup Plan" });
    expect(buildPlan).toBeDisabled();
    fireEvent.click(screen.getAllByText("Test Connection")[0]);
    await screen.findByText("Selected destination tested successfully.");
    expect([...directory.files.keys()]).toEqual([]);
    expect(buildPlan).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Build Complete Backup Plan" }));
    await waitFor(() => expect(axios).toHaveBeenCalledWith(expect.objectContaining({
      method: "post",
      url: "http://localhost:5000/admin/backup/plan",
      data: expect.objectContaining({ destinationMode: "mac-local" })
    })));
    fireEvent.click(await screen.findByRole("button", { name: "Start Manual Backup" }));
    expect(screen.queryAllByRole("alert").map((element) => element.textContent)).toEqual([]);
    expect(await screen.findByRole("button", { name: "Transferred to this computer" })).toBeDisabled();
    expect(global.fetch).toHaveBeenCalledTimes(exportFiles.length);
    const localPrefix = "GFXunlimit/Backup-Set-GFX-TEST/Drive-1/";
    expect(await directory.files.get(`${localPrefix}${exportPayloadPath}`).getFile().then((file) => file.text())).toBe(exportPayload);
    expect(JSON.parse(await directory.files.get(`${localPrefix}manifest.json`).getFile().then((file) => file.text())).verificationStatus).toBe("VERIFIED");
    expect(await directory.files.get(`${localPrefix}checksums.sha256`).getFile().then((file) => file.text())).toBe(exportChecksums);
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

  test("failed local export removes the incomplete backup set and reports one actionable error", async () => {
    const directory = makeBrowserDirectory();
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: jest.fn().mockResolvedValue(directory)
    });
    global.fetch = jest.fn(async (url) => {
      const filePath = new URL(url).searchParams.get("path");
      const contents = filePath === exportPayloadPath ? "fail" : exportContents[filePath];
      const bytes = Uint8Array.from(contents, (character) => character.charCodeAt(0));
      return {
        ok: true,
        body: {
          async pipeTo(writable) {
            await writable.write(bytes);
            await writable.close();
          }
        }
      };
    });
    render(<AdminBackupPage isDarkMode={false} apiBaseUrl="http://localhost:5000" getAuthToken={() => "token"} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Browse this computer" })[0]);
    await waitFor(() => expect(screen.getByLabelText("Selected folder")).toHaveValue("MacBackups"));
    fireEvent.click(screen.getAllByText("Test Connection")[0]);
    await screen.findByText("Selected destination tested successfully.");
    fireEvent.click(screen.getByRole("button", { name: "Build Complete Backup Plan" }));
    await screen.findByRole("button", { name: "Start Manual Backup" });
    fireEvent.click(screen.getByRole("button", { name: "Start Manual Backup" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/checksum did not match/i);
    expect([...directory.files.keys()].some((filePath) => filePath.startsWith("GFXunlimit/Backup-Set-GFX-TEST/"))).toBe(false);
    expect(screen.queryByRole("button", { name: "Transferred to this computer" })).not.toBeInTheDocument();
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
