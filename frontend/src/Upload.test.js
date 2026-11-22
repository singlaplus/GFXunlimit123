import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import axios from "axios";
import { toast } from "react-toastify";
import Upload from "./Upload";

jest.mock("axios");
jest.mock("react-toastify", () => ({
  toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() }
}));

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
    axios.post.mockResolvedValue({
      data: {
        id: 1,
        file_size: 5,
        status: "upload_processing",
        upload_complete: true,
        finalized: true,
        thumbnail_processing_status: "PROCESSING"
      }
    });
  });

  it("keeps the existing single-upload request and does not opt into pre-submission", async () => {
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
        "http://localhost:5000/upload",
        expect.any(FormData),
        expect.objectContaining({ onUploadProgress: expect.any(Function) })
      );
    });
    expect(axios.post.mock.calls[0][1].get("preSubmission")).toBeNull();
    expect(axios.post.mock.calls[0][2].headers["Idempotency-Key"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  it("reuses a request key after an upload response is lost", async () => {
    axios.post
      .mockRejectedValueOnce({ message: "Connection reset." })
      .mockResolvedValueOnce({
        data: {
          id: 2,
          file_size: 5,
          upload_complete: true,
          finalized: true,
          thumbnail_processing_status: "PROCESSING"
        }
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

    await waitFor(() => expect(axios.post).toHaveBeenCalledTimes(2));
    expect(axios.post.mock.calls[1][2].headers["Idempotency-Key"]).toBe(requestId);
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

    await waitFor(() => expect(axios.post).toHaveBeenCalledTimes(1));
    expect(axios.post.mock.calls[0][1].get("thumbnail")).toBe(thumbnailFile);
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
