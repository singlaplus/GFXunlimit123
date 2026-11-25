import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import axios from "axios";
import { toast } from "react-toastify";
import Upload from "./Upload";

jest.mock("axios");
jest.mock("react-toastify", () => ({
  toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() }
}));

const configureChunkedUploadApi = () => {
  const sessions = new Map();
  let nextSession = 1;
  axios.post.mockImplementation((url, body, config) => {
    if (url.endsWith("/upload/chunked/init")) {
      const uploadId = `single-session-${nextSession++}`;
      sessions.set(uploadId, { fileSize: body.file_size, body, headers: config.headers });
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
    return Promise.resolve({
      data: {
        id: 1,
        file_size: session.fileSize,
        status: "upload_processing",
        upload_complete: true,
        finalized: true,
        thumbnail_processing_status: "PROCESSING"
      }
    });
  });
  axios.put.mockImplementation((_url, chunk, config) => {
    config.onUploadProgress?.({ loaded: chunk.size, total: chunk.size });
    return Promise.resolve({ data: { received: true } });
  });
};

describe("Single Upload", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    URL.createObjectURL = jest.fn(() => "blob:single-upload-preview");
    URL.revokeObjectURL = jest.fn();
    localStorage.setItem("token", "test-token");
    axios.get.mockImplementation((url) => {
      if (url.endsWith("/categories")) {
        return Promise.resolve({ data: [{ id: "nature", name: "Nature" }] });
      }
      if (url.endsWith("/collections")) {
        return Promise.resolve({ data: [
          { id: "photos", name: "Photos" },
          { id: "templates", name: "Templates" },
        ] });
      }
      return Promise.resolve({ data: [] });
    });
    configureChunkedUploadApi();
  });

  it("uploads a single asset in chunks and preserves its standard metadata submission", async () => {
    const { container } = render(<Upload darkMode={false} fetchImages={jest.fn()} />);
    await screen.findByRole("option", { name: "Photos" });
    fireEvent.change(screen.getByLabelText(/Title/), { target: { value: "Single upload" } });
    fireEvent.change(screen.getByLabelText(/Description/), { target: { value: "Forest image" } });
    fireEvent.change(screen.getByLabelText(/Keywords/), { target: { value: "forest" } });
    const selects = container.querySelectorAll("select");
    fireEvent.change(selects[0], { target: { value: "Nature" } });
    fireEvent.change(selects[2], { target: { value: "Photos" } });
    fireEvent.change(selects[3], { target: { value: "commercial" } });
    fireEvent.change(container.querySelector('input[type="file"]'), {
      target: { files: [new File(["image"], "single.jpg", { type: "image/jpeg" })] }
    });
    fireEvent.click(screen.getByRole("button", { name: "Upload" }));

    await waitFor(() => {
      expect(axios.post).toHaveBeenCalledWith(
        "http://localhost:5000/upload/chunked/init",
        expect.objectContaining({
          filename: "single.jpg",
          file_size: 5,
          fieldname: "image",
          preSubmission: false,
          form_fields: expect.objectContaining({
            title: "Single upload",
            description: "Forest image",
            category: "Nature",
            collection: "Photos",
            keywords: "forest",
            type: "commercial"
          })
        }),
        expect.objectContaining({ skipGlobalLoading: true })
      );
    });
    const initCall = axios.post.mock.calls.find((call) => call[0].endsWith("/upload/chunked/init"));
    expect(initCall[2].headers["Idempotency-Key"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(axios.put).toHaveBeenCalledTimes(1);
    expect(axios.post.mock.calls.some((call) => call[0].endsWith("/complete"))).toBe(true);
  });

  it("reuses a request key after an upload response is lost", async () => {
    let initCount = 0;
    axios.post.mockImplementation((url, body, config) => {
      if (url.endsWith("/upload/chunked/init")) {
        initCount += 1;
        if (initCount === 1) return Promise.reject({ message: "Connection reset." });
        return Promise.resolve({
          data: {
            upload_id: "retry-single-session",
            file_size: body.file_size,
            chunk_size: 8 * 1024 * 1024,
            total_chunks: 1,
            received_chunks: [],
            request_id: config.headers["Idempotency-Key"]
          }
        });
      }
      return Promise.resolve({
        data: { id: 2, file_size: 5, upload_complete: true, finalized: true, thumbnail_processing_status: "PROCESSING" }
      });
    });
    const { container } = render(<Upload darkMode={false} fetchImages={jest.fn()} />);
    await screen.findByRole("option", { name: "Photos" });
    fireEvent.change(screen.getByLabelText(/Title/), { target: { value: "Single upload" } });
    fireEvent.change(screen.getByLabelText(/Description/), { target: { value: "Forest image" } });
    fireEvent.change(screen.getByLabelText(/Keywords/), { target: { value: "forest" } });
    const selects = container.querySelectorAll("select");
    fireEvent.change(selects[0], { target: { value: "Nature" } });
    fireEvent.change(selects[2], { target: { value: "Photos" } });
    fireEvent.change(selects[3], { target: { value: "commercial" } });
    fireEvent.change(container.querySelector('input[type="file"]'), {
      target: { files: [new File(["image"], "single.jpg", { type: "image/jpeg" })] }
    });

    fireEvent.click(screen.getByRole("button", { name: "Upload" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Connection reset."));
    const requestId = axios.post.mock.calls[0][2].headers["Idempotency-Key"];
    fireEvent.click(screen.getByRole("button", { name: "Upload" }));

    await waitFor(() => expect(axios.post.mock.calls.filter((call) => (
      call[0].endsWith("/upload/chunked/init")
    ))).toHaveLength(2));
    const initCalls = axios.post.mock.calls.filter((call) => call[0].endsWith("/upload/chunked/init"));
    expect(initCalls[1][2].headers["Idempotency-Key"]).toBe(requestId);
  });

  it("requires and uploads a thumbnail when Templates is selected", async () => {
    const { container } = render(<Upload darkMode={false} fetchImages={jest.fn()} />);
    await screen.findByRole("option", { name: "Templates" });
    const selects = container.querySelectorAll("select");
    fireEvent.change(selects[0], { target: { value: "Nature" } });
    fireEvent.change(selects[2], { target: { value: "Templates" } });
    fireEvent.change(selects[3], { target: { value: "commercial" } });
    fireEvent.change(screen.getByLabelText(/Title/), { target: { value: "Template upload" } });
    fireEvent.change(screen.getByLabelText(/Description/), { target: { value: "Template asset" } });
    fireEvent.change(screen.getByLabelText(/Keywords/), { target: { value: "template" } });

    const fileInputs = container.querySelectorAll('input[type="file"]');
    const assetFile = new File(["asset"], "template.zip", { type: "application/zip" });
    const thumbnailFile = new File(["preview"], "template-preview.png", { type: "image/png" });
    fireEvent.change(fileInputs[0], { target: { files: [assetFile] } });

    expect(fileInputs[1]).toBeRequired();
    expect(screen.getByRole("button", { name: "Upload" })).toBeDisabled();

    fireEvent.change(fileInputs[1], { target: { files: [thumbnailFile] } });
    expect(screen.getByRole("button", { name: "Upload" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Upload" }));

    await waitFor(() => expect(axios.put).toHaveBeenCalledTimes(2));
    const initCalls = axios.post.mock.calls.filter((call) => call[0].endsWith("/upload/chunked/init"));
    expect(initCalls).toHaveLength(2);
    expect(initCalls[0][1].fieldname).toBe("image");
    expect(initCalls[1][1]).toEqual(expect.objectContaining({
      filename: thumbnailFile.name,
      fieldname: "thumbnail",
      parent_upload_id: "single-session-1"
    }));
    const completeCall = axios.post.mock.calls.find((call) => call[0].endsWith("/complete"));
    expect(completeCall[1].thumbnail_upload_id).toBe("single-session-2");
  });

  it("marks the required upload fields with small red stars", async () => {
    const { container } = render(<Upload darkMode={false} fetchImages={jest.fn()} />);
    await screen.findByRole("option", { name: "Photos" });

    [/Title/, /Description/, /Keywords/, /Type/, /Asset file/].forEach((label) => {
      expect(screen.getByLabelText(label)).toBeRequired();
    });

    const markers = container.querySelectorAll('label span[aria-hidden="true"]');
    expect(markers).toHaveLength(5);
    expect(markers[0].style.color).toBe("rgb(220, 38, 38)");
    expect(markers[0].style.fontSize).toBe("0.75em");
  });

  it("uses the admin-configured contributor limit up to the 2 GB system maximum", async () => {
    localStorage.setItem("userRole", "contributor");
    localStorage.setItem("userPermissions", JSON.stringify({
      upload_limit_value: 1,
      upload_limit_unit: "GB"
    }));

    const { rerender } = render(<Upload darkMode={false} fetchImages={jest.fn()} />);
    expect(await screen.findByText("Active upload limit: 1 GB (default: 20 MB)")).toBeInTheDocument();

    localStorage.setItem("userPermissions", JSON.stringify({
      upload_limit_value: 5,
      upload_limit_unit: "GB"
    }));
    rerender(<Upload darkMode={false} fetchImages={jest.fn()} />);
    expect(screen.getByText(
      "Active upload limit: 2 GB (system maximum; admin setting: 5 GB) (default: 20 MB)"
    )).toBeInTheDocument();
  });
});
