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

const configureChunkedUpload = (assetIdForSession = () => 101) => {
  const sessions = new Map();
  let nextSessionId = 1;
  let nextAssetId = 101;
  axios.post.mockImplementation((url, body) => {
    if (url.endsWith("/upload/chunked/init")) {
      const uploadId = `session-${nextSessionId++}`;
      sessions.set(uploadId, { fileSize: body.file_size, filename: body.filename });
      return Promise.resolve({
        data: {
          upload_id: uploadId,
          file_size: body.file_size,
          chunk_size: 8 * 1024 * 1024,
          total_chunks: Math.ceil(body.file_size / (8 * 1024 * 1024)),
          received_chunks: []
        }
      });
    }
    const uploadId = decodeURIComponent(url.split("/").at(-2));
    const session = sessions.get(uploadId);
    return Promise.resolve(finalizedResponse(assetIdForSession(session, nextAssetId++), session.fileSize));
  });
  axios.put.mockImplementation((_url, chunk, config) => {
    config.onUploadProgress?.({ loaded: chunk.size, total: chunk.size });
    return Promise.resolve({ data: { received: true } });
  });
  axios.delete.mockResolvedValue({ status: 204 });
  return sessions;
};

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
    configureChunkedUpload();
    localStorage.setItem("token", "test-token");
    localStorage.setItem("userRole", "contributor");
    localStorage.setItem("userPermissions", JSON.stringify({}));
    axios.get.mockResolvedValue({ data: [] });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it("keeps one active transfer, allows queued removal, and waits for backend finalization", async () => {
    const files = Array.from({ length: 10 }, (_, index) => new File(["asset"], `asset-${index + 1}.jpg`));
    const requests = new Map();
    const sessions = new Map();
    let nextSessionId = 1;
    let activeTransfers = 0;
    let maximumTransfers = 0;
    axios.post.mockImplementation((url, body, config) => {
      if (url.endsWith("/upload/chunked/init")) {
        const uploadId = `session-${nextSessionId++}`;
        sessions.set(uploadId, body);
        return Promise.resolve({
          data: {
            upload_id: uploadId,
            file_size: body.file_size,
            chunk_size: 8 * 1024 * 1024,
            total_chunks: 1,
            received_chunks: []
          }
        });
      }
      const uploadId = decodeURIComponent(url.split("/").at(-2));
      const file = sessions.get(uploadId);
      activeTransfers += 1;
      maximumTransfers = Math.max(maximumTransfers, activeTransfers);
      return new Promise((resolve, reject) => {
        requests.set(file.filename, {
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
    axios.put.mockImplementation((_url, chunk, config) => {
      config.onUploadProgress({ loaded: chunk.size, total: chunk.size });
      return Promise.resolve({ data: { received: true } });
    });

    render(<BulkUploadPage />);
    fireEvent.change(screen.getByLabelText(/upload assets/i), { target: { files } });

    await waitFor(() => expect(axios.put).toHaveBeenCalledTimes(1));
    expect(axios.put).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("UPLOADING · 99%")).toBeInTheDocument();
    expect(await screen.findAllByText("QUEUED")).toHaveLength(9);

    const fifthFile = screen.getByText("asset-5.jpg").closest("li");
    fireEvent.click(within(fifthFile).getByRole("button", { name: "Remove" }));
    expect(screen.queryByText("asset-5.jpg")).not.toBeInTheDocument();

    requests.get("asset-1.jpg").resolve(finalizedResponse(101));
    await waitFor(() => expect(axios.put).toHaveBeenCalledTimes(2));
    expect(requests.has("asset-2.jpg")).toBe(true);
    expect(requests.has("asset-5.jpg")).toBe(false);
    expect(maximumTransfers).toBe(1);

    requests.get("asset-2.jpg").reject({ response: { data: "Upload failed" } });
    expect(await screen.findByText("Upload failed")).toBeInTheDocument();
    await waitFor(() => expect(axios.put).toHaveBeenCalledTimes(3));
    expect(requests.has("asset-3.jpg")).toBe(true);
    expect(maximumTransfers).toBe(1);
  });

  it("aborts the active HTTP transfer and advances to the next queued item", async () => {
    const firstFile = new File(["asset"], "cancel-me.jpg");
    const secondFile = new File(["asset"], "next.jpg");
    const sessions = new Map();
    let firstSignal;
    axios.post.mockImplementation((url, body) => {
      if (url.endsWith("/upload/chunked/init")) {
        const uploadId = `session-${body.filename}`;
        sessions.set(uploadId, body);
        return Promise.resolve({
          data: {
            upload_id: uploadId,
            file_size: body.file_size,
            chunk_size: 8 * 1024 * 1024,
            total_chunks: 1,
            received_chunks: []
          }
        });
      }
      return Promise.resolve(finalizedResponse(202, 5));
    });
    axios.put.mockImplementation((url, chunk, config) => {
      const uploadId = decodeURIComponent(url.split("/").at(-3));
      if (sessions.get(uploadId).filename === "cancel-me.jpg") {
        firstSignal = config.signal;
        return new Promise((_resolve, reject) => {
          config.signal.addEventListener("abort", () => reject({ name: "CanceledError" }));
        });
      }
      config.onUploadProgress({ loaded: chunk.size, total: chunk.size });
      return Promise.resolve({ data: { received: true } });
    });

    render(<BulkUploadPage />);
    fireEvent.change(screen.getByLabelText(/upload assets/i), {
      target: { files: [firstFile, secondFile] }
    });
    await waitFor(() => expect(axios.put).toHaveBeenCalledTimes(1));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel upload" }));

    await waitFor(() => expect(firstSignal.aborted).toBe(true));
    await waitFor(() => expect(axios.put).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("CANCELLED")).toBeInTheDocument();
    expect(axios.post.mock.calls.find((call) => call[1]?.filename === "next.jpg")).toBeDefined();
  });

  it("reuses the same idempotency key when retrying an upload request", async () => {
    const waitForPolling = useFastThumbnailPolling();
    let initCount = 0;
    axios.post.mockImplementation((url, body) => {
      if (url.endsWith("/upload/chunked/init")) {
        initCount += 1;
        if (initCount === 1) return Promise.reject({ message: "Connection reset." });
        return Promise.resolve({
          data: {
            upload_id: "retry-session",
            file_size: body.file_size,
            chunk_size: 8 * 1024 * 1024,
            total_chunks: 1,
            received_chunks: []
          }
        });
      }
      return Promise.resolve(finalizedResponse(203, 5));
    });
    axios.get.mockResolvedValue({
      data: [{ id: 203, generated_thumbnail_status: "READY" }]
    });

    render(<BulkUploadPage />);
    fireEvent.change(screen.getByLabelText(/upload assets/i), {
      target: { files: [new File(["asset"], "retry.jpg")] }
    });
    expect(await screen.findByText("Connection reset.")).toBeInTheDocument();
    const firstHeaders = axios.post.mock.calls[0][2].headers;
    expect(firstHeaders["Idempotency-Key"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(
      axios.post.mock.calls.filter((call) => call[0].endsWith("/upload/chunked/init"))
    ).toHaveLength(2));
    const initCalls = axios.post.mock.calls.filter((call) => call[0].endsWith("/upload/chunked/init"));
    expect(initCalls[1][2].headers["Idempotency-Key"]).toBe(firstHeaders["Idempotency-Key"]);
    expect(initCalls[1][2].skipGlobalLoading).toBe(true);
    await waitForPolling(() => screen.queryByText("Completed - ready to submit"));
  });

  it("resumes an existing session without retransmitting chunks already received", async () => {
    const chunkSize = 8 * 1024 * 1024;
    axios.post.mockImplementation((url) => {
      if (url.endsWith("/upload/chunked/init")) {
        return Promise.resolve({
          data: {
            upload_id: "resume-session",
            file_size: chunkSize + 2,
            chunk_size: chunkSize,
            total_chunks: 2,
            received_chunks: [0]
          }
        });
      }
      return Promise.resolve(finalizedResponse(204, chunkSize + 2));
    });

    render(<BulkUploadPage />);
    fireEvent.change(screen.getByLabelText(/upload assets/i), {
      target: { files: [new File([new Uint8Array(chunkSize + 2)], "resume.eps")] }
    });

    await waitFor(() => expect(axios.put).toHaveBeenCalledTimes(1));
    expect(axios.put.mock.calls[0][0]).toMatch(/\/upload\/chunked\/resume-session\/parts\/1$/);
    expect(axios.put.mock.calls[0][1].size).toBe(2);
  });

  it("continues polling when the asset is temporarily missing, then completes when READY", async () => {
    const waitForPolling = useFastThumbnailPolling();
    configureChunkedUpload(() => 301);
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
      "http://localhost:5000/upload/chunked/init",
      expect.objectContaining({ filename: "ready.jpg", file_size: 5 }),
      expect.objectContaining({ signal: expect.any(AbortSignal), skipGlobalLoading: true })
    );
    expect(axios.put).toHaveBeenCalledWith(
      expect.stringMatching(/\/upload\/chunked\/.+\/parts\/0$/),
      expect.any(Blob),
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        skipGlobalLoading: true,
        onUploadProgress: expect.any(Function)
      })
    );
    expect(axios.get).toHaveBeenCalledWith(
      "http://localhost:5000/my-uploads?view=bulk-status",
      expect.objectContaining({ skipGlobalLoading: true })
    );
  });

  it("retains thumbnail-failed handling and the backend error when FAILED is reported", async () => {
    const waitForPolling = useFastThumbnailPolling();
    configureChunkedUpload(() => 302);
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
    configureChunkedUpload(() => 303);
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

  it("shows and enforces the active per-file upload limit before transferring a large file", async () => {
    render(<BulkUploadPage />);
    expect(screen.getByText("Active per-file upload limit: 20 MB")).toBeInTheDocument();

    const oversizedFile = new File(["asset"], "large.eps");
    Object.defineProperty(oversizedFile, "size", { value: 20 * 1024 * 1024 + 1 });
    fireEvent.change(screen.getByLabelText(/upload assets/i), {
      target: { files: [oversizedFile] }
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(/large\.eps exceeds your 20 MB upload limit/i);
    expect(axios.post).not.toHaveBeenCalled();
    expect(screen.getByText("0 / 10 selected")).toBeInTheDocument();
  });

  it("uses the configured contributor limit instead of treating it as display-only", async () => {
    localStorage.setItem("userPermissions", JSON.stringify({
      upload_limit_value: 100,
      upload_limit_unit: "MB"
    }));
    render(<BulkUploadPage />);
    expect(screen.getByText("Active per-file upload limit: 100 MB")).toBeInTheDocument();

    const oversizedFile = new File(["asset"], "over-configured-limit.eps");
    Object.defineProperty(oversizedFile, "size", { value: 100 * 1024 * 1024 + 1 });
    fireEvent.drop(screen.getByText(/choose assets from your device/i).closest("label"), {
      dataTransfer: { files: [oversizedFile] }
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(/exceeds your 100 MB upload limit/i);
    expect(axios.post).not.toHaveBeenCalled();
  });

  it("accepts dropped files and adds them to the upload queue", () => {
    configureChunkedUpload(() => 404);
    render(<BulkUploadPage />);

    const dropZone = screen.getByText(/choose assets from your device/i).closest("label");
    fireEvent.drop(dropZone, {
      dataTransfer: {
        files: [
          new File(["first"], "first.jpg"),
          new File(["second"], "second.jpg")
        ]
      }
    });

    expect(screen.getByText("2 / 10 selected")).toBeInTheDocument();
  });

  it("rejects more than ten dropped files", async () => {
    render(<BulkUploadPage />);
    const dropZone = screen.getByText(/choose assets from your device/i).closest("label");

    fireEvent.drop(dropZone, {
      dataTransfer: {
        files: Array.from({ length: 11 }, (_, index) => new File(["asset"], `drop-${index}.jpg`))
      }
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(/maximum of 10/i);
    expect(axios.post).not.toHaveBeenCalled();
  });

  it("restarts an upload after ten seconds without progress using the same request ID", async () => {
    jest.useFakeTimers();
    const requests = [];
    axios.put.mockImplementation((_url, _chunk, config) => {
      requests.push(config);
      return new Promise((_resolve, reject) => {
        config.signal.addEventListener("abort", () => reject({ name: "CanceledError" }), { once: true });
      });
    });

    render(<BulkUploadPage />);
    fireEvent.change(screen.getByLabelText(/upload assets/i), {
      target: { files: [new File([new Uint8Array(100)], "stalled.jpg")] }
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => requests[0].onUploadProgress({ loaded: 10, total: 100 }));
    await act(async () => {
      jest.advanceTimersByTime(9000);
      await Promise.resolve();
    });
    expect(axios.put).toHaveBeenCalledTimes(1);

    act(() => requests[0].onUploadProgress({ loaded: 20, total: 100 }));
    await act(async () => {
      jest.advanceTimersByTime(9000);
      await Promise.resolve();
    });
    expect(axios.put).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(1000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(axios.put).toHaveBeenCalledTimes(2);
    expect(requests[0].signal.aborted).toBe(true);
    expect(requests[1].headers["Idempotency-Key"]).toBe(requests[0].headers["Idempotency-Key"]);
    expect(screen.getByText(/retrying chunk 1 \(attempt 2 of 3\)/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel upload" }));
    await act(async () => {
      await Promise.resolve();
    });
  });

  it("does not reset the stall timer for byte progress that leaves the displayed percent unchanged", async () => {
    jest.useFakeTimers();
    const requests = [];
    axios.put.mockImplementation((_url, _chunk, config) => {
      requests.push(config);
      return new Promise((_resolve, reject) => {
        config.signal.addEventListener("abort", () => reject({ name: "CanceledError" }), { once: true });
      });
    });

    render(<BulkUploadPage />);
    fireEvent.change(screen.getByLabelText(/upload assets/i), {
      target: { files: [new File([new Uint8Array(10_000)], "same-percent.jpg")] }
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => requests[0].onUploadProgress({ loaded: 100, total: 10_000 }));
    expect(screen.getByText("UPLOADING · 1%")).toBeInTheDocument();

    await act(async () => {
      jest.advanceTimersByTime(9000);
      await Promise.resolve();
    });
    act(() => requests[0].onUploadProgress({ loaded: 110, total: 10_000 }));
    expect(screen.getByText("UPLOADING · 1%")).toBeInTheDocument();

    await act(async () => {
      jest.advanceTimersByTime(1000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(axios.put).toHaveBeenCalledTimes(2);
    expect(requests[0].signal.aborted).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Cancel upload" }));
    await act(async () => {
      await Promise.resolve();
    });
  });

  it("marks the upload failed after three consecutive stalled attempts", async () => {
    jest.useFakeTimers();
    axios.put.mockImplementation((_url, _chunk, config) => new Promise((_resolve, reject) => {
      config.signal.addEventListener("abort", () => reject({ name: "CanceledError" }), { once: true });
    }));

    render(<BulkUploadPage />);
    fireEvent.change(screen.getByLabelText(/upload assets/i), {
      target: { files: [new File(["asset"], "always-stalled.jpg")] }
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await act(async () => {
        jest.advanceTimersByTime(10_000);
        await Promise.resolve();
        await Promise.resolve();
      });
    }

    expect(axios.put).toHaveBeenCalledTimes(3);
    expect(screen.getByText("FAILED")).toBeInTheDocument();
    expect(screen.getByText(/after 3 attempts/i)).toBeInTheDocument();
  });

  it("removes completed items after thirty seconds and releases their batch slots", async () => {
    const originalSetTimeout = window.setTimeout.bind(window);
    jest.spyOn(window, "setTimeout").mockImplementation((callback, delay, ...args) => {
      const fastDelay = delay === 2000 || delay === 30000 ? 0 : delay;
      return originalSetTimeout(callback, fastDelay, ...args);
    });
    configureChunkedUpload(() => 305);
    axios.get.mockResolvedValue({
      data: [{ id: 305, generated_thumbnail_status: "READY" }]
    });

    render(<BulkUploadPage />);
    fireEvent.change(screen.getByLabelText(/upload assets/i), {
      target: { files: [new File(["asset"], "release-slot.jpg")] }
    });

    await waitFor(() => expect(screen.queryByText("1 / 10 selected")).not.toBeInTheDocument());
    expect(screen.queryByText("1 / 10 selected")).not.toBeInTheDocument();

    fireEvent.drop(screen.getByText(/choose assets from your device/i).closest("label"), {
      dataTransfer: {
        files: [new File(["next"], "next.jpg")]
      }
    });
    expect(screen.getByText("1 / 10 selected")).toBeInTheDocument();
  });

  it("marks the bulk asset file selector as required", () => {
    render(<BulkUploadPage />);

    expect(screen.getByLabelText(/upload assets/i)).toBeRequired();
    expect(screen.getByText("Choose assets from your device").parentElement.querySelector("span[aria-hidden='true']"))
      .toHaveStyle({ color: "rgb(220, 38, 38)" });
  });
});
