import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import axios from "axios";
import TermsAndConditionsPage from "./TermsAndConditionsPage";

jest.mock("axios");

describe("TermsAndConditionsPage", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("token", "admin-token");
    axios.get.mockResolvedValue({ data: { content: null } });
    axios.put.mockImplementation((_url, content) => Promise.resolve({ data: { content } }));
  });

  it("renders the public terms page and its section navigation", async () => {
    render(<TermsAndConditionsPage />);

    expect(await screen.findByRole("heading", { name: "Terms & Conditions" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Terms & Conditions sections" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Marketplace assets and licenses" })).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Terms & Conditions customization" })).not.toBeInTheDocument();
  });

  it("lets admins edit and publish terms for all visitors", async () => {
    render(<TermsAndConditionsPage isAdmin />);

    const titleInput = await screen.findByLabelText("Page title");
    fireEvent.change(titleInput, { target: { value: "Updated Terms" } });
    expect(screen.getByRole("heading", { name: "Updated Terms" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Terms sections" }));
    fireEvent.click(screen.getByRole("button", { name: "Add section" }));
    expect(screen.getByLabelText("Section heading")).toHaveValue("New section");

    fireEvent.click(screen.getByRole("button", { name: "Save for all visitors" }));
    await waitFor(() => {
      expect(axios.put).toHaveBeenCalledWith(
        expect.stringContaining("/admin/terms-and-conditions/content"),
        expect.objectContaining({
          hero: expect.objectContaining({ title: "Updated Terms" }),
          sections: expect.arrayContaining([expect.objectContaining({ title: "New section" })])
        }),
        expect.objectContaining({ headers: { Authorization: "Bearer admin-token" } })
      );
    });
  });
});
