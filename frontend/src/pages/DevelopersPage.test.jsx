import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import axios from "axios";
import DevelopersPage from "./DevelopersPage";

jest.mock("axios");

describe("DevelopersPage", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("token", "admin-token");
    axios.get.mockResolvedValue({ data: { content: null } });
    axios.put.mockImplementation((_url, content) => Promise.resolve({ data: { content } }));
  });

  it("renders public developer resources and section navigation", async () => {
    render(<DevelopersPage />);

    expect(await screen.findByRole("heading", { name: "Developers" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Developers sections" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Licensing and attribution" })).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Developers customization" })).not.toBeInTheDocument();
  });

  it("lets admins edit, arrange, and publish developer resources", async () => {
    render(<DevelopersPage isAdmin />);

    const titleInput = await screen.findByLabelText("Page title");
    fireEvent.change(titleInput, { target: { value: "Developer Resources" } });
    fireEvent.click(screen.getByRole("button", { name: "Developer resources" }));
    fireEvent.click(screen.getByRole("button", { name: "Add section" }));

    expect(screen.getByLabelText("Section heading")).toHaveValue("New section");
    fireEvent.click(screen.getByRole("button", { name: "Save for all visitors" }));

    await waitFor(() => {
      expect(axios.put).toHaveBeenCalledWith(
        expect.stringContaining("/admin/developers/content"),
        expect.objectContaining({
          hero: expect.objectContaining({ title: "Developer Resources" }),
          sections: expect.arrayContaining([expect.objectContaining({ title: "New section" })])
        }),
        expect.objectContaining({ headers: { Authorization: "Bearer admin-token" } })
      );
    });
  });
});
