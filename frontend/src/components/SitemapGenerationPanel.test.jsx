import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import axios from "axios";
import { toast } from "react-toastify";
import SitemapGenerationPanel from "./SitemapGenerationPanel";

jest.mock("axios");
jest.mock("react-toastify", () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}));

describe("SitemapGenerationPanel", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    axios.get.mockResolvedValue({ data: { job: null } });
  });

  it("starts a generation and displays the real progress response", async () => {
    axios.post.mockResolvedValue({
      data: {
        job: {
          id: "job-1",
          status: "running",
          stage: "Discovering public pages",
          progress: 20,
          processedUrls: 3,
          totalDiscoveredUrls: 15,
        },
      },
    });

    render(<SitemapGenerationPanel />);
    const generateButton = await screen.findByRole("button", { name: "Generate Sitemap" });
    await waitFor(() => expect(generateButton).toBeEnabled());
    fireEvent.click(generateButton);

    expect(await screen.findByText(/Discovering public pages \(20%\)/)).toBeInTheDocument();
    expect(screen.getByText("Processed 3 of 15 discovered URLs.")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Sitemap generation progress" })).toHaveAttribute("value", "20");
    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining("/admin/sitemap/generation"),
      {},
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });

  it("shows the backend configuration error when generation cannot start", async () => {
    axios.post.mockRejectedValue({
      response: { data: { error: "Set the production SITE_URL environment variable before generating a sitemap." } },
    });

    render(<SitemapGenerationPanel />);
    const generateButton = await screen.findByRole("button", { name: "Generate Sitemap" });
    await waitFor(() => expect(generateButton).toBeEnabled());
    fireEvent.click(generateButton);

    expect(await screen.findByRole("alert")).toHaveTextContent(/SITE_URL environment variable/);
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("SITE_URL"));
  });

  it("shows completion details and downloads the published sitemap", async () => {
    axios.get.mockResolvedValue({
      data: {
        job: {
          id: "job-2",
          status: "completed",
          progress: 100,
          result: {
            totalUrls: 12,
            fileCount: 1,
            fileSizeBytes: 2048,
            primaryFilename: "sitemap.xml",
            outputPath: "/srv/sitemaps/2026/10/24/sitemap.xml",
            publicUrl: "https://www.gfxunlimit.com/sitemap.xml",
          },
        },
      },
    });
    const createObjectURL = jest.fn(() => "blob:sitemap");
    const revokeObjectURL = jest.fn();
    Object.defineProperty(window.URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(window.URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });

    render(<SitemapGenerationPanel />);

    expect(await screen.findByText(/Generated 12 URLs in 1 sitemap file/)).toBeInTheDocument();
    expect(screen.getByText(/Saved to: \/srv\/sitemaps\/2026\/10\/24\/sitemap\.xml/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Download Sitemap" }));

    await waitFor(() => expect(axios.get).toHaveBeenCalledWith(
      expect.stringContaining("/admin/sitemap/download"),
      expect.objectContaining({ responseType: "blob" })
    ));
    expect(createObjectURL).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:sitemap");
  });

  it("configures and saves daily, weekly, and monthly schedules with IST time", async () => {
    axios.put.mockImplementation((url, schedule) => Promise.resolve({ data: schedule }));
    render(<SitemapGenerationPanel />);

    const frequency = await screen.findByRole("combobox", { name: "Sitemap frequency" });
    const timePickerButton = screen.getByRole("button", { name: "Sitemap generation time (IST)" });
    expect(timePickerButton).toHaveTextContent("02:00 AM");
    expect(screen.queryByRole("combobox", { name: "Sitemap generation weekday" })).not.toBeInTheDocument();

    fireEvent.change(frequency, { target: { value: "weekly" } });
    const weekday = screen.getByRole("combobox", { name: "Sitemap generation weekday" });
    fireEvent.change(weekday, { target: { value: "wednesday" } });
    fireEvent.click(timePickerButton);
    fireEvent.click(screen.getByRole("button", { name: "Hour 09" }));
    fireEvent.click(screen.getByRole("button", { name: "Minute 30" }));
    fireEvent.click(screen.getByRole("button", { name: "Period PM" }));
    expect(timePickerButton).toHaveTextContent("09:30 PM");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.click(screen.getByLabelText("Enable automatic sitemap generation"));
    expect(screen.getByRole("combobox", { name: "Sitemap generation weekday" })).toHaveValue("wednesday");

    fireEvent.change(frequency, { target: { value: "monthly" } });
    const monthDay = screen.getByRole("combobox", { name: "Sitemap generation date of month" });
    fireEvent.change(monthDay, { target: { value: "31" } });
    expect(screen.getByText(/runs on that month's last day/)).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Sitemap generation weekday" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save Schedule" }));

    await waitFor(() => expect(axios.put).toHaveBeenCalledWith(
      expect.stringContaining("/admin/sitemap-schedule"),
      { enabled: true, frequency: "monthly", time: "21:30", monthDay: 31 },
      expect.objectContaining({ headers: expect.any(Object) })
    ));
    expect(await screen.findByText("Sitemap schedule saved.")).toBeInTheDocument();
  });

  it("refreshes running-job status and reports completion", async () => {
    jest.useFakeTimers();
    const runningJob = {
      id: "job-3",
      status: "running",
      progress: 35,
      stage: "Discovering approved assets",
      processedUrls: 7,
      totalDiscoveredUrls: 20,
    };
    const completedJob = {
      ...runningJob,
      status: "completed",
      progress: 100,
      result: { totalUrls: 20, fileCount: 1, fileSizeBytes: 300, primaryFilename: "sitemap.xml" },
    };
    axios.get.mockImplementation((url) => {
      if (url.endsWith("/admin/sitemap/generation")) {
        return Promise.resolve({ data: { job: runningJob } });
      }
      if (url.endsWith("/admin/sitemap-schedule")) {
        return Promise.resolve({ data: { enabled: false, frequency: "daily", time: "02:00" } });
      }
      return Promise.resolve({ data: { job: completedJob } });
    });

    const view = render(<SitemapGenerationPanel />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText(/Discovering approved assets \(35%\)/)).toBeInTheDocument();
    await act(async () => {
      jest.advanceTimersByTime(1000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(await screen.findByText(/Generated 20 URLs in 1 sitemap file/)).toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith("Sitemap generated successfully.");
    view.unmount();
    jest.useRealTimers();
  });
});
