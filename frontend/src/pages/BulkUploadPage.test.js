import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import axios from "axios";
import BulkUploadPage from "./BulkUploadPage";

jest.mock("axios");
jest.mock("react-toastify", () => ({
  toast: { success: jest.fn(), error: jest.fn() }
}));

const finalizedResponse = (id, fileSize = 5) => ({
  data: { id, upload_complete: true, finalized: true, file_size: fileSize }
});

const useFastThumbnailPolling = () => {
  const originalSetTimeout = window.setTimeout.bind(window);
  jest.spyOn(window, "setTimeout").mockImplementation((callback, delay, ...args) => (
    originalSetTimeout(callback, delay === 2000 ? 0 : delay, ...args)
  ));
  return async (condition) => {
    for (let attempt = 0; attempt < 1000; attempt += 1) {
      if (condition()) return;
      await act(async () => {
        await new Promise((resolve) => originalSetTimeout(resolve, 1));
      });
    }
    throw new Error("Timed out waiting for Bulk Upload polling to finish.");
  };
};

describe("BulkUploadPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.setItem("token", "test-token");
    axios.get.mockResolvedValue({ data: [] });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("keeps one active transfer, allows queued removal, and waits for backend finalization", async () => {
    const files = Array.from({ length: 10 }, (_, index) => new File(["asset"], `asset-${index + 1}.jpg`));
    const requests = new Map();
    let activeTransfers = 0;
    let maximumTransfers = 0;
    axios.post.mockImplementation((_url, formData, config) => {
      const file = formData.get("image");
      activeTransfers += 1;
      maximumTransfers = Math.max(maximumTransfers, activeTransfers);
      config.onUploadProgress({ loaded: 5, total: 5 });
      return new Promise((resolve, reject) => {
        requests.set(file.name, {
          resolve: (response) => {
            activeTransfers -= 1;
            resolve(response);
          },
          reject: (error) => {
            activeTransfers -= 1;
            reject(error);
          },
          signal: config.signal
        });
      });
    });

    render(<BulkUploadPage />);
    fireEvent.change(screen.getByLabelText(/upload assets/i), { target: { files } });

    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("UPLOADING · 99%")).toBeInTheDocument();
    expect(await screen.findAllByText("QUEUED")).toHaveLength(9);

    const fifthFile = screen.getByText("asset-5.jpg").closest("li");
    fireEvent.click(within(fifthFile).getByRole("button", { name: "Remove" }));
    expect(screen.queryByText("asset-5.jpg")).not.toBeInTheDocument();

    requests.get("asset-1.jpg").resolve(finalizedResponse(101));
    await waitFor(() => expect(axios.post).toHaveBeenCalledTimes(2));
    expect(requests.has("asset-2.jpg")).toBe(true);
    expect(requests.has("asset-5.jpg")).toBe(false);
    expect(maximumTransfers).toBe(1);

    requests.get("asset-2.jpg").reject({ response: { data: "Upload failed" } });
    expect(await screen.findByText("Upload failed")).toBeInTheDocument();
    await waitFor(() => expect(axios.post).toHaveBeenCalledTimes(3));
    expect(requests.has("asset-3.jpg")).toBe(true);
    expect(maximumTransfers).toBe(1);
  });

  it("aborts the active HTTP transfer and advances to the next queued item", async () => {
    const firstFile = new File(["asset"], "cancel-me.jpg");
    const secondFile = new File(["asset"], "next.jpg");
    let firstSignal;
    axios.post.mockImplementation((_url, formData, config) => {
      if (formData.get("image").name === "cancel-me.jpg") {
        firstSignal = config.signal;
        return new Promise((_resolve, reject) => {
          config.signal.addEventListener("abort", () => reject({ name: "CanceledError" }));
        });
      }
      return Promise.resolve(finalizedResponse(202));
    });

    render(<BulkUploadPage />);
    fireEvent.change(screen.getByLabelText(/upload assets/i), {
      target: { files: [firstFile, secondFile] }
    });
    fireEvent.click(await screen.findByRole("button", { name: "Cancel upload" }));

    await waitFor(() => expect(firstSignal.aborted).toBe(true));
    await waitFor(() => expect(axios.post).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("CANCELLED")).toBeInTheDocument();
    expect(axios.post.mock.calls[1][1].get("image").name).toBe("next.jpg");
  });

  it("continues polling when the asset is temporarily missing, then completes when READY", async () => {
    const waitForPolling = useFastThumbnailPolling();
    axios.post.mockResolvedValue(finalizedResponse(301));
    axios.get
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({
        data: [{ id: 301, thumbnail_status: "COMPLETED", generated_thumbnail_status: "READY" }]
      });

    render(<BulkUploadPage />);
    fireEvent.change(screen.getByLabelText(/upload assets/i), {
      target: { files: [new File(["asset"], "ready.jpg")] }
    });

    await waitForPolling(() => screen.queryByText("Completed - ready to submit"));
    expect(screen.getByText("Completed - ready to submit")).toBeInTheDocument();
    expect(axios.get).toHaveBeenCalledTimes(2);
    expect(axios.post).toHaveBeenCalledWith(
      "http://localhost:5000/upload",
      expect.any(FormData),
      expect.objectContaining({ signal: expect.any(AbortSignal), onUploadProgress: expect.any(Function) })
    );
    expect(axios.get).toHaveBeenCalledWith(
      "http://localhost:5000/my-uploads?view=bulk-status",
      expect.anything()
    );
  });

  it("retains thumbnail-failed handling and the backend error when FAILED is reported", async () => {
    const waitForPolling = useFastThumbnailPolling();
    axios.post.mockResolvedValue(finalizedResponse(302));
    axios.get.mockResolvedValue({
      data: [{ id: 302, generated_thumbnail_status: "FAILED", thumbnail_error: "Processor failed." }]
    });

    render(<BulkUploadPage />);
    fireEvent.change(screen.getByLabelText(/upload assets/i), {
      target: { files: [new File(["asset"], "failed.jpg")] }
    });

    await waitForPolling(() => screen.queryByText("THUMBNAIL FAILED"));
    expect(screen.getByText("THUMBNAIL FAILED")).toBeInTheDocument();
    expect(screen.getByText("Processor failed.")).toBeInTheDocument();
    expect(axios.get).toHaveBeenCalledTimes(8);
  });

  it("reports an availability timeout if the asset never appears during polling", async () => {
    const waitForPolling = useFastThumbnailPolling();
    axios.post.mockResolvedValue(finalizedResponse(303));
    axios.get.mockResolvedValue({ data: [] });

    render(<BulkUploadPage />);
    fireEvent.change(screen.getByLabelText(/upload assets/i), {
      target: { files: [new File(["asset"], "missing.jpg")] }
    });

    await waitForPolling(() => screen.queryByText("THUMBNAIL FAILED"));
    expect(screen.getByText("THUMBNAIL FAILED")).toBeInTheDocument();
    expect(screen.getByText(/did not become available in bulk status before the thumbnail wait timed out/i)).toBeInTheDocument();
    expect(screen.queryByText("Uploaded asset is not available to this contributor.")).not.toBeInTheDocument();
    expect(axios.get).toHaveBeenCalledTimes(150);
  });

  it("rejects a batch larger than ten files without starting any transfer", async () => {
    render(<BulkUploadPage />);
    fireEvent.change(screen.getByLabelText(/upload assets/i), {
      target: { files: Array.from({ length: 11 }, (_, index) => new File(["asset"], `too-many-${index}.jpg`)) }
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(/maximum of 10/i);
    expect(axios.post).not.toHaveBeenCalled();
  });
});
