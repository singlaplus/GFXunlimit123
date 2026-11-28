import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import axios from "axios";
import HelpCenterPage from "./HelpCenterPage";

jest.mock("axios");

describe("HelpCenterPage", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("token", "admin-token");
    axios.get.mockResolvedValue({ data: { content: null } });
    axios.put.mockImplementation((_url, content) => Promise.resolve({ data: { content } }));
  });

  it("renders the public Help Center and question navigation", async () => {
    render(<HelpCenterPage />);

    expect(await screen.findByRole("heading", { name: "Help Center" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Help Center sections" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "How do I download an asset?" })).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Help Center customization" })).not.toBeInTheDocument();
  });

  it("lets verified admins edit, arrange, and publish help content", async () => {
    render(<HelpCenterPage isAdmin />);

    const titleInput = await screen.findByLabelText("Page title");
    fireEvent.change(titleInput, { target: { value: "Updated Help Center" } });
    fireEvent.click(screen.getByRole("button", { name: "Help questions" }));
    fireEvent.click(screen.getByRole("button", { name: "Add section" }));

    expect(screen.getByLabelText("Section heading")).toHaveValue("New section");
    fireEvent.click(screen.getByRole("button", { name: "Save for all visitors" }));

    await waitFor(() => {
      expect(axios.put).toHaveBeenCalledWith(
        expect.stringContaining("/admin/help-center/content"),
        expect.objectContaining({
          hero: expect.objectContaining({ title: "Updated Help Center" }),
          sections: expect.arrayContaining([expect.objectContaining({ title: "New section" })])
        }),
        expect.objectContaining({ headers: { Authorization: "Bearer admin-token" } })
      );
    });
  });
});
