import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import axios from "axios";
import AdminBackupPage from "./AdminBackupPage";

jest.mock("axios", () => jest.fn());
jest.mock("react-toastify", () => ({
  toast: { info: jest.fn(), success: jest.fn(), error: jest.fn() }
}));

describe("AdminBackupPage", () => {
  beforeEach(() => {
    axios.mockReset();
    axios.mockImplementation(({ method, url }) => {
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
      if (method === "get" && url.includes("/browse")) {
        if (url.includes("path=")) return Promise.resolve({ data: { currentPath: "D:\\GFXunlimitBackups", parentPath: "D:\\", directories: [] } });
        return Promise.resolve({ data: { currentPath: null, parentPath: null, directories: [{ name: "GFXunlimitBackups", path: "D:\\GFXunlimitBackups" }] } });
      }
      if (method === "post" && url.endsWith("/test-connection")) {
        const destinationPath = url.includes("automatic") ? "D:\\GFXunlimitBackups" : "D:\\GFXunlimitBackups";
        return Promise.resolve({ data: { drives: [{ path: destinationPath, totalBytes: 100000, usedBytes: 1000, availableBytes: 99000, safetyLimitBytes: 90000, usableBackupBytes: 89000, status: "READY" }] } });
      }
      if (method === "post" && url.endsWith("/plan")) {
        return Promise.resolve({ data: { ready: true, selectedTypes: ["database"], database: { name: "stocksite", version: "PostgreSQL 18.6", sourceServer: "PC2", estimatedBytes: 1024, pgDump: { available: true, version: "pg_dump 18.6" } }, categories: { database: { plannedBytes: 10000, estimatedBytes: 1024 }, websiteCode: { plannedBytes: 0 }, originalAssets: { plannedBytes: 0, estimatedBytes: 0, users: [] }, thumbnails: { plannedBytes: 0, estimatedBytes: 0 } }, totalRequiredBytes: 10000, filesTotal: 1, drives: [{ driveNumber: 1, path: "D:\\GFXunlimitBackups", actualCapacityBytes: 100000, currentUsedBytes: 1000, currentAvailableBytes: 99000, safetyLimitBytes: 90000, usableBackupBytes: 89000, requiredBytes: 10000, remainingSafeBytes: 79000, status: "READY", groups: [] }], issues: [] } });
      }
      if (method === "post" && url.endsWith("/start")) return Promise.resolve({ data: { id: "GFX-TEST", status: "RUNNING", progress: { percent: 0 }, selectedTypes: ["database"], drives: [] } });
      if (method === "put" && url.endsWith("/automatic")) return Promise.resolve({ data: { schedule: { configured: true, enabled: false, destination: "D:\\GFXunlimitBackups", selectedTypes: ["database", "websiteCode"], frequency: "daily", time: "02:00", timezone: "Asia/Kolkata", nextRun: null, lastRun: null } } });
      return Promise.reject(new Error(`Unexpected API request: ${method} ${url}`));
    });
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

  test("selected source size recalculates and Browse selects a PC2 destination", async () => {
    render(<AdminBackupPage isDarkMode={false} apiBaseUrl="http://localhost:5000" getAuthToken={() => "token"} />);
    const cards = await screen.findByLabelText("Backup categories");
    const [databaseCheckbox, websiteCheckbox, assetsCheckbox] = cards.querySelectorAll('input[type="checkbox"]');
    await within(cards).findByText("1.00 KB");
    fireEvent.click(websiteCheckbox);
    expect(await screen.findByText("Selected Backup Size: 5.50 KB")).toBeInTheDocument();
    fireEvent.click(assetsCheckbox);
    expect(await screen.findByText("Selected Backup Size: 1.00 KB")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Browse" })[0]);
    fireEvent.click(await screen.findByRole("button", { name: "GFXunlimitBackups" }));
    await screen.findByText("D:\\GFXunlimitBackups");
    fireEvent.click(screen.getByRole("button", { name: "Select this folder" }));
    expect(screen.getByLabelText("Destination path")).toHaveValue("D:\\GFXunlimitBackups");
    fireEvent.click(screen.getAllByRole("button", { name: "Test Connection" })[0]);
    await screen.findByText(/Destination connected and writable/i);
    expect(axios).toHaveBeenCalledWith(expect.objectContaining({
      method: "post",
      url: "http://localhost:5000/admin/backup/test-connection",
      data: { path: "D:\\GFXunlimitBackups" }
    }));
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
