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
        return Promise.resolve({ data: [{ id: "photos", name: "Photos" }] });
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
    fireEvent.change(screen.getByPlaceholderText(/title/i), { target: { value: "Single upload" } });
    fireEvent.change(screen.getByPlaceholderText(/keywords/i), { target: { value: "forest" } });
    const selects = container.querySelectorAll("select");
    fireEvent.change(selects[0], { target: { value: "Nature" } });
    fireEvent.change(selects[2], { target: { value: "Photos" } });
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
    fireEvent.change(screen.getByPlaceholderText(/title/i), { target: { value: "Single upload" } });
    fireEvent.change(screen.getByPlaceholderText(/keywords/i), { target: { value: "forest" } });
    const selects = container.querySelectorAll("select");
    fireEvent.change(selects[0], { target: { value: "Nature" } });
    fireEvent.change(selects[2], { target: { value: "Photos" } });
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
});
