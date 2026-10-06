import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import axios from "axios";
import Upload from "./Upload";

jest.mock("axios");
jest.mock("react-toastify", () => ({
  toast: { success: jest.fn(), error: jest.fn() }
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
    axios.post.mockResolvedValue({ data: { id: 1, status: "pending" } });
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
  });
});
