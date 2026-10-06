import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import axios from "axios";
import BulkUploadPage from "./BulkUploadPage";

jest.mock("axios");
jest.mock("react-toastify", () => ({
  toast: { success: jest.fn(), error: jest.fn() }
}));

describe("BulkUploadPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.setItem("token", "test-token");
  });

  it("uploads one file independently, shows upload progress, and waits for thumbnail readiness", async () => {
    axios.post.mockImplementation(async (_url, _formData, config) => {
      config.onUploadProgress({ loaded: 45, total: 100 });
      return { data: { id: 101 } };
    });
    axios.get.mockResolvedValue({
      data: [{ id: 101, thumbnail_status: "COMPLETED", generated_thumbnail_status: "READY" }]
    });
    const file = new File(["asset"], "design.jpg", { type: "image/jpeg" });

    render(<BulkUploadPage />);
    fireEvent.change(screen.getByLabelText(/upload assets/i), { target: { files: [file] } });

    expect(await screen.findByText("Completed - ready to submit", {}, { timeout: 4000 })).toBeInTheDocument();
    expect(await screen.findByRole("progressbar", { name: "Overall upload progress" })).toHaveAttribute("aria-valuenow", "100");
    expect(axios.post).toHaveBeenCalledWith(
      "http://localhost:5000/upload",
      expect.any(FormData),
      expect.objectContaining({ onUploadProgress: expect.any(Function) })
    );
    expect(axios.get).toHaveBeenCalledWith(
      "http://localhost:5000/my-uploads?view=bulk-status",
      expect.anything()
    );
  });

  it("uploads ten selected files as ten independent requests", async () => {
    let nextAssetId = 200;
    axios.post.mockImplementation(async () => ({ data: { id: nextAssetId++ } }));
    axios.get.mockImplementation(async () => ({
        data: Array.from({ length: 10 }, (_, index) => ({
          id: 200 + index,
          thumbnail_status: "COMPLETED",
          generated_thumbnail_status: "READY"
        }))
      }));
    const files = Array.from({ length: 10 }, (_, index) => new File(["asset"], `asset-${index}.jpg`));

    render(<BulkUploadPage />);
    fireEvent.change(screen.getByLabelText(/upload assets/i), { target: { files } });

    await waitFor(() => expect(axios.post).toHaveBeenCalledTimes(10));
    expect(await screen.findAllByText("Completed - ready to submit", {}, { timeout: 4000 })).toHaveLength(10);
  });

  it("allows retrying thumbnail generation after an upload has succeeded", async () => {
    axios.post
      .mockResolvedValueOnce({ data: { id: 250 } })
      .mockResolvedValueOnce({ data: { id: 250, thumbnail_status: "PROCESSING" } });
    axios.get
      .mockRejectedValueOnce(new Error("Temporary status check error"))
      .mockResolvedValueOnce({
        data: [{ id: 250, thumbnail_status: "COMPLETED", generated_thumbnail_status: "READY" }]
      });

    render(<BulkUploadPage />);
    fireEvent.change(screen.getByLabelText(/upload assets/i), {
      target: { files: [new File(["asset"], "retry.jpg")] }
    });
    expect(await screen.findByRole("button", { name: "Retry" }, { timeout: 4000 })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Completed - ready to submit", {}, { timeout: 4000 })).toBeInTheDocument();
    expect(axios.post).toHaveBeenNthCalledWith(
      2,
      "http://localhost:5000/images/250/thumbnail/retry",
      {},
      expect.anything()
    );
  });

  it("rejects more than ten files before uploading and continues other uploads after an individual failure", async () => {
    axios.post.mockImplementation(async (_url, formData) => {
      const file = formData.get("image");
      if (file.name === "bad.jpg") {
        throw { response: { data: "Unsupported file type" } };
      }
      return { data: { id: 301 } };
    });
    axios.get.mockResolvedValue({
      data: [{ id: 301, thumbnail_status: "COMPLETED", generated_thumbnail_status: "READY" }]
    });
    const { rerender } = render(<BulkUploadPage />);
    fireEvent.change(screen.getByLabelText(/upload assets/i), {
      target: { files: Array.from({ length: 11 }, (_, index) => new File(["asset"], `too-many-${index}.jpg`)) }
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(/maximum of 10/i);
    expect(axios.post).not.toHaveBeenCalled();

    rerender(<BulkUploadPage />);
    fireEvent.change(screen.getByLabelText(/upload assets/i), {
      target: { files: [new File(["bad"], "bad.jpg"), new File(["good"], "good.jpg")] }
    });
    expect(await screen.findByText("Unsupported file type")).toBeInTheDocument();
    expect(await screen.findByText("Completed - ready to submit", {}, { timeout: 4000 })).toBeInTheDocument();
    expect(axios.post).toHaveBeenCalledTimes(2);
  });
});
