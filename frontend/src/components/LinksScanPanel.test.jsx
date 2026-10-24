import React from "react";
import axios from "axios";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useLocation } from "react-router-dom";
import LinksScanPanel from "./LinksScanPanel";

jest.mock("axios");

const completedJob = {
  scanId: "scan-1",
  status: "completed",
  pagesScanned: 55,
  totalPages: 55,
  errors: [],
};

function resultsResponse(links, total, page = 1, totalPages = 1) {
  return {
    data: {
      scanId: "scan-1",
      status: "completed",
      links,
      errors: [],
      summary: { total: 101, internal: 75, external: 26 },
      pagination: { page, pageSize: 100, total, totalPages },
    },
  };
}

function renderPanel() {
  return render(<LinksScanPanel />);
}

describe("LinksScanPanel", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useLocation.mockReturnValue({ pathname: "/admin", search: "" });
    axios.get.mockImplementation((url, config) => {
      if (url.endsWith("/results")) return Promise.resolve(resultsResponse([], 0));
      return Promise.resolve({ data: { job: null } });
    });
  });

  it("loads the signed-in user's saved scan and requests exactly 100 results per page", async () => {
    window.matchMedia = jest.fn().mockReturnValue({ matches: true });
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      pageUrl: "https://example.com/",
      text: `Link ${index + 1}`,
      href: `https://example.com/link-${index + 1}`,
      type: "Internal",
    }));
    axios.get.mockImplementation((url) => {
      if (url.endsWith("/results")) return Promise.resolve(resultsResponse(firstPage, 101, 1, 2));
      return Promise.resolve({ data: { job: completedJob } });
    });

    renderPanel();

    expect(await screen.findByRole("table", { name: "Scanned app links" })).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(101);
    await waitFor(() => expect(screen.getByLabelText("Links found: 101")).toHaveTextContent("101"));
    expect(screen.getByLabelText("Internal links: 75")).toHaveTextContent("75");
    expect(screen.getByLabelText("External links: 26")).toHaveTextContent("26");
    expect(screen.getByLabelText("Pages scanned: 55")).toHaveTextContent("55");
    expect(screen.getByText("Showing 1–100 of 101 links · 100 per page")).toBeInTheDocument();
    expect(axios.get).toHaveBeenCalledWith(
      expect.stringMatching(/\/admin\/links\/scan\/results$/),
      expect.objectContaining({
        params: { page: 1, pageSize: 100, search: "", type: "All" },
        headers: expect.any(Object),
      })
    );
  });

  it("uses the shared pagination to fetch the next server-side page", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      pageUrl: "https://example.com/",
      text: `Link ${index + 1}`,
      href: `https://example.com/link-${index + 1}`,
      type: "Internal",
    }));
    const lastPage = [{
      pageUrl: "https://example.com/about",
      text: "Last link",
      href: "https://example.com/last-link",
      type: "External",
    }];
    axios.get.mockImplementation((url, config) => {
      if (url.endsWith("/results")) {
        return Promise.resolve(config.params.page === 1
          ? resultsResponse(firstPage, 101, 1, 2)
          : resultsResponse(lastPage, 101, 2, 2));
      }
      return Promise.resolve({ data: { job: completedJob } });
    });

    renderPanel();
    await screen.findByRole("table", { name: "Scanned app links" });
    fireEvent.click(screen.getByRole("button", { name: "Next ▶" }));

    expect(await screen.findByText("Last link")).toBeInTheDocument();
    expect(axios.get).toHaveBeenCalledWith(
      expect.stringMatching(/\/admin\/links\/scan\/results$/),
      expect.objectContaining({
        params: { page: 2, pageSize: 100, search: "", type: "All" },
        headers: expect.any(Object),
      })
    );
  });

  it("starts a backend scan and sends search and type filters to the results endpoint", async () => {
    axios.post.mockResolvedValue({ data: { job: completedJob } });
    axios.get.mockImplementation((url, config) => {
      if (url.endsWith("/results")) return Promise.resolve(resultsResponse([{
        pageUrl: "https://example.com/",
        text: "External docs",
        href: "https://docs.example.com",
        type: "External",
      }], 1));
      return Promise.resolve({ data: { job: null } });
    });

    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Scan Links" }));

    expect(await screen.findByRole("table", { name: "Scanned app links" })).toBeInTheDocument();
    expect(axios.post).toHaveBeenCalledWith(
      expect.stringMatching(/\/admin\/links\/scan$/),
      {},
      expect.objectContaining({ headers: expect.any(Object) })
    );

    fireEvent.change(screen.getByRole("combobox", { name: "Filter links by type" }), { target: { value: "External" } });
    fireEvent.change(screen.getByRole("searchbox", { name: "Search scanned links" }), { target: { value: "docs" } });

    await waitFor(() => expect(axios.get).toHaveBeenCalledWith(
      expect.stringMatching(/\/admin\/links\/scan\/results$/),
      expect.objectContaining({
        params: { page: 1, pageSize: 100, search: "docs", type: "External" },
        headers: expect.any(Object),
      })
    ));
  });

  it("exports all results matching the current search and type filter as CSV", async () => {
    axios.get.mockImplementation((url, config) => {
      if (url.endsWith("/export")) return Promise.resolve({ data: new Blob(["csv"]) });
      if (url.endsWith("/results")) return Promise.resolve(resultsResponse([{
        pageUrl: "https://example.com/",
        text: "External docs",
        href: "https://docs.example.com",
        type: "External",
      }], 1));
      return Promise.resolve({ data: { job: completedJob } });
    });
    window.URL.createObjectURL = jest.fn(() => "blob:links.csv");
    window.URL.revokeObjectURL = jest.fn();
    const click = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    renderPanel();
    await screen.findByRole("table", { name: "Scanned app links" });
    fireEvent.change(screen.getByRole("combobox", { name: "Filter links by type" }), { target: { value: "External" } });
    fireEvent.change(screen.getByRole("searchbox", { name: "Search scanned links" }), { target: { value: "docs" } });
    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));

    await waitFor(() => expect(axios.get).toHaveBeenCalledWith(
      expect.stringMatching(/\/admin\/links\/scan\/export$/),
      expect.objectContaining({
        params: { search: "docs", type: "External" },
        responseType: "blob",
        headers: expect.any(Object),
      })
    ));
    expect(click).toHaveBeenCalled();
    expect(window.URL.revokeObjectURL).toHaveBeenCalledWith("blob:links.csv");
  });

  it("disables and re-enables the page shown in the last table column", async () => {
    const links = [
      {
        pageUrl: "https://example.com/pricing?tab=plans",
        text: "Plans",
        href: "https://example.com/plans",
        type: "Internal",
      },
      {
        pageUrl: "https://example.com/pricing?tab=offers",
        text: "Offers",
        href: "https://example.com/offers",
        type: "Internal",
      },
    ];
    axios.get.mockImplementation((url) => {
      if (url.endsWith("/results")) return Promise.resolve(resultsResponse(links, 2));
      if (url.endsWith("/disabled-rows")) return Promise.resolve({ data: { links: [] } });
      return Promise.resolve({ data: { job: completedJob } });
    });
    axios.put.mockResolvedValue({ data: { page: { path: "/pricing" } } });
    axios.delete.mockResolvedValue({ data: { path: "/pricing", disabled: false } });
    window.confirm = jest.fn(() => true);

    renderPanel();
    const disableButton = await screen.findByRole("button", { name: "Disable link Plans on /pricing?tab=plans" });
    fireEvent.click(disableButton);

    expect(await screen.findByRole("button", { name: "Enable link Plans on /pricing?tab=plans" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Disable link Offers on /pricing?tab=offers" })).toBeInTheDocument();
    expect(axios.put).toHaveBeenCalledWith(
      expect.stringMatching(/\/admin\/links\/disabled-rows$/),
      {
        sourcePath: "/pricing?tab=plans",
        href: "https://example.com/plans",
        text: "Plans",
      },
      expect.objectContaining({ headers: expect.any(Object) })
    );

    fireEvent.click(screen.getByRole("button", { name: "Enable link Plans on /pricing?tab=plans" }));
    await waitFor(() => expect(axios.delete).toHaveBeenCalledWith(
      expect.stringMatching(/\/admin\/links\/disabled-rows$/),
      expect.objectContaining({
        headers: expect.any(Object),
        data: {
          sourcePath: "/pricing?tab=plans",
          href: "https://example.com/plans",
          text: "Plans",
        },
      })
    ));
    expect(await screen.findByRole("button", { name: "Disable link Plans on /pricing?tab=plans" })).toBeInTheDocument();
  });
});
