import { render, screen } from "@testing-library/react";
import BulkUploadPage from "./BulkUploadPage";

describe("BulkUploadPage", () => {
  it("shows a single-row upload form with an add-row action", () => {
    render(<BulkUploadPage darkMode={false} />);

    expect(screen.getByPlaceholderText(/title/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /\+/i })).toBeInTheDocument();
  });
});
