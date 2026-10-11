import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import axios from "axios";
import AdminBackupPage from "./AdminBackupPage";

jest.mock("axios", () => jest.fn());
jest.mock("react-toastify", () => ({
  toast: { info: jest.fn(), success: jest.fn(), error: jest.fn() }
}));

const exportPayloadPath = "Website-Code/backend/server.js";
const exportDatabasePath = "Database/stocksite.backup";
const exportPayload = "test";
const exportPayloadSha256 = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
const exportChecksums = `${exportPayloadSha256} 4 ${exportDatabasePath}\n${exportPayloadSha256} 4 ${exportPayloadPath}\n`;
const exportManifest = JSON.stringify({
  format: "GFXUNLIMIT-BACKUP-SET",
  backupSetId: "GFX-TEST",
  backupType: "MANUAL",
  status: "SUCCESS",
  verificationStatus: "VERIFIED",
  selectedTypes: ["database", "websiteCode"],
  totals: { files: 2 }
});
const exportContents = {
  "checksums.sha256": exportChecksums,
  "manifest.json": exportManifest,
  [exportDatabasePath]: exportPayload,
  [exportPayloadPath]: exportPayload
};
const exportFiles = Object.entries(exportContents).map(([filePath, contents]) => ({
  path: filePath,
  sizeBytes: contents.length
}));

function makeBrowserDirectory(name = "MacBackups", beforeWrite = async () => {}) {
  const files = new Map();
  const directories = new Map();
  const makeFile = (filePath) => {
    if (!files.has(filePath)) {
      let bytes = new Uint8Array();
      files.set(filePath, {
        async createWritable() {
          const chunks = [];
          const writer = {
            async write(chunk) {
              await beforeWrite(filePath, chunk);
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
            async abort() {},
            releaseLock() {}
          };
          return {
            write: (...args) => writer.write(...args),
            close: (...args) => writer.close(...args),
            getWriter: () => writer,
            async abort() { await writer.abort(); }
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
        selectedTypes: ["database", "websiteCode"],
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
    fireEvent.click(within(screen.getByLabelText("Selected server folder").closest("section")).getByRole("button", { name: "Browse server folders" }));
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

  test("automatic destination Browse uses only the server-side destination picker", async () => {
    render(<AdminBackupPage isDarkMode={false} apiBaseUrl="http://localhost:5000" getAuthToken={() => "token"} />);
    const automaticDestination = await screen.findByLabelText("Automatic Backup Location");
    fireEvent.change(automaticDestination, { target: { value: "D:\\ExistingAutomaticBackup" } });
    fireEvent.click(within(automaticDestination.closest("section")).getByRole("button", { name: "Browse server folders" }));
    expect(await screen.findByText("D:\\Backups")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "D:\\Backups" }));
    expect(await screen.findByText("Server location: D:\\Backups")).toBeInTheDocument();
    const useServerFolderButtons = screen.getAllByRole("button", { name: "Use this server folder" });
    fireEvent.click(useServerFolderButtons[useServerFolderButtons.length - 1]);
    expect(automaticDestination).toHaveValue("D:\\Backups");
    expect(window.showDirectoryPicker).not.toHaveBeenCalled();
    expect(axios).toHaveBeenCalledWith(expect.objectContaining({
      method: "get",
      url: "http://localhost:5000/admin/backup/automatic/browse"
    }));
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
          getReader() {
            let offset = 0;
            return {
              async read() {
                if (offset >= bytes.length) return { done: true };
                const end = Math.min(bytes.length, offset + Math.max(1, Math.ceil(bytes.length / 2)));
                const value = bytes.slice(offset, end);
                offset = end;
                await new Promise((resolve) => setTimeout(resolve, 5));
                return { done: false, value };
              },
              releaseLock() {}
            };
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
    await waitFor(() => expect(screen.getByLabelText("Mac-local transfer progress")).toHaveTextContent("Mac-local copy complete and verified"));
    expect(screen.getByLabelText("Mac-local transfer progress")).toHaveTextContent(`${exportFiles.reduce((sum, file) => sum + file.sizeBytes, 0)} B / ${exportFiles.reduce((sum, file) => sum + file.sizeBytes, 0)} B written`);
    expect(screen.getByLabelText("Mac-local transfer progress")).toHaveTextContent("4 / 4");
    expect(await screen.findByRole("button", { name: "Transferred to this computer" })).toBeDisabled();
    expect(global.fetch).toHaveBeenCalledTimes(exportFiles.length);
    const localPrefix = "GFXunlimit/Backup-Set-GFX-TEST/Drive-1/";
    expect(await directory.files.get(`${localPrefix}${exportPayloadPath}`).getFile().then((file) => file.text())).toBe(exportPayload);
    expect(await directory.files.get(`${localPrefix}${exportDatabasePath}`).getFile().then((file) => file.text())).toBe(exportPayload);
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

  test("manual Mac export fails closed and cleans up when the server file list omits the manifest", async () => {
    const defaultImplementation = axios.getMockImplementation();
    axios.mockImplementation((config) => (
      config.method === "get" && /\/jobs\/[^/]+\/export$/.test(config.url)
        ? Promise.resolve({ data: { files: exportFiles.filter((file) => file.path !== "manifest.json") } })
        : defaultImplementation(config)
    ));
    const directory = makeBrowserDirectory();
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: jest.fn().mockResolvedValue(directory)
    });
    global.fetch = jest.fn();
    render(<AdminBackupPage isDarkMode={false} apiBaseUrl="http://localhost:5000" getAuthToken={() => "token"} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Browse this computer" })[0]);
    await waitFor(() => expect(screen.getByLabelText("Selected folder")).toHaveValue("MacBackups"));
    fireEvent.click(screen.getAllByText("Test Connection")[0]);
    await screen.findByText("Selected destination tested successfully.");
    fireEvent.click(screen.getByRole("button", { name: "Build Complete Backup Plan" }));
    fireEvent.click(await screen.findByRole("button", { name: "Start Manual Backup" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/invalid or incomplete file list/i);
    await waitFor(() => expect(screen.getByLabelText("Mac-local transfer progress")).toHaveTextContent("Mac-local transfer failed"));
    expect([...directory.files.keys()]).toEqual([]);
    expect(screen.queryByRole("button", { name: "Transferred to this computer" })).not.toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("Mac-local byte progress waits for browser writes and refreshes while the response stream is paused", async () => {
    let signalFirstPayloadWrite;
    const firstPayloadWriteStarted = new Promise((resolve) => {
      signalFirstPayloadWrite = resolve;
    });
    let releaseFirstPayloadWrite;
    const firstPayloadWriteGate = new Promise((resolve) => {
      releaseFirstPayloadWrite = resolve;
    });
    let releaseRemainingPayload;
    const remainingPayloadGate = new Promise((resolve) => {
      releaseRemainingPayload = resolve;
    });
    const directory = makeBrowserDirectory("MacBackups", async (filePath) => {
      if (filePath.endsWith(exportPayloadPath)) {
        signalFirstPayloadWrite();
        await firstPayloadWriteGate;
      }
    });
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
          getReader() {
            let state = 0;
            return {
              async read() {
                if (filePath !== exportPayloadPath) {
                  if (state++ > 0) return { done: true };
                  return { done: false, value: bytes };
                }
                if (state++ === 0) return { done: false, value: bytes.slice(0, 2) };
                if (state === 2) {
                  await remainingPayloadGate;
                  return { done: false, value: bytes.slice(2) };
                }
                return { done: true };
              },
              releaseLock() {}
            };
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
    fireEvent.click(await screen.findByRole("button", { name: "Start Manual Backup" }));

    await firstPayloadWriteStarted;
    const checksumBytes = exportChecksums.length;
    const databaseBytes = exportContents[exportDatabasePath].length;
    const totalBytes = exportFiles.reduce((total, file) => total + file.sizeBytes, 0);
    const progress = await screen.findByRole("progressbar", { name: "Mac-local bytes written" });
    expect(Number(progress.getAttribute("aria-valuenow"))).toBeCloseTo(((checksumBytes + databaseBytes) / totalBytes) * 100);

    releaseFirstPayloadWrite();
    await waitFor(() => {
      expect(Number(progress.getAttribute("aria-valuenow"))).toBeGreaterThan((checksumBytes / totalBytes) * 100);
    });
    releaseRemainingPayload();
    await waitFor(() => expect(screen.getByLabelText("Mac-local transfer progress")).toHaveTextContent("Mac-local copy complete and verified"));
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
          getReader() {
            let read = false;
            return {
              async read() {
                if (read) return { done: true };
                read = true;
                return { done: false, value: bytes };
              },
              releaseLock() {}
            };
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
    await waitFor(() => expect(screen.getByLabelText("Mac-local transfer progress")).toHaveTextContent("Mac-local transfer failed"));
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

  test("Saved Schedule popup shows only the live persisted schedule, not unsaved edits or run history", async () => {
    const defaultRequest = axios.getMockImplementation();
    axios.mockImplementation((config) => {
      if (config.method === "get" && config.url.endsWith("/automatic")) {
        return Promise.resolve({ data: { schedule: {
          configured: true,
          enabled: true,
          destination: "D:\\SavedBackups",
          selectedTypes: ["database", "websiteCode"],
          frequency: "daily",
          time: "02:00",
          weeklyDay: 0,
          monthlyDay: 1,
          timezone: "Asia/Kolkata",
          nextRun: "2026-10-12T02:00:00.000Z",
          lastRun: null
        } } });
      }
      return defaultRequest(config);
    });
    render(<AdminBackupPage isDarkMode={false} apiBaseUrl="http://localhost:5000" getAuthToken={() => "token"} />);
    const savedScheduleButton = await screen.findByRole("button", { name: "Saved Schedule" });

    fireEvent.change(screen.getByLabelText("Frequency"), { target: { value: "weekly" } });
    fireEvent.click(savedScheduleButton);

    const details = screen.getByRole("dialog", { name: "Saved Automatic Backup Schedule" });
    expect(details).toHaveTextContent("Frequency: daily");
    expect(details).toHaveTextContent("Configured time: 02:00 am IST");
    expect(details).toHaveTextContent("Backup types: Database, Website Code + .env");
    expect(details).toHaveTextContent("Live automatic schedule");
    expect(details).not.toHaveTextContent("schedule history");
    expect(savedScheduleButton).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(screen.getByRole("button", { name: "Close saved schedules" }));
    expect(screen.queryByRole("dialog", { name: "Saved Automatic Backup Schedule" })).not.toBeInTheDocument();
    expect(savedScheduleButton).toHaveAttribute("aria-expanded", "false");
  });

  test("Saved Schedule popup excludes a disabled schedule", async () => {
    render(<AdminBackupPage isDarkMode={false} apiBaseUrl="http://localhost:5000" getAuthToken={() => "token"} />);
    fireEvent.click(await screen.findByRole("button", { name: "Saved Schedule" }));

    expect(screen.getByRole("dialog", { name: "Saved Automatic Backup Schedule" }))
      .toHaveTextContent("There are no live automatic backup schedules.");
    expect(screen.queryByText("Live automatic schedule")).not.toBeInTheDocument();
  });
});
