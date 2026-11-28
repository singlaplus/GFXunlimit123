import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import axios from "axios";
import CookiePolicyPage from "./CookiePolicyPage";

jest.mock("axios");

describe("CookiePolicyPage", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("token", "admin-token");
    axios.get.mockResolvedValue({ data: { content: null } });
    axios.put.mockImplementation((_url, content) => Promise.resolve({ data: { content } }));
  });

  it("renders the public cookie policy and its section navigation", async () => {
    render(<CookiePolicyPage />);

    expect(await screen.findByRole("heading", { name: "Cookie Policy" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Cookie Policy sections" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Managing your choices" })).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Cookie Policy customization" })).not.toBeInTheDocument();
  });

  it("lets admins arrange and publish cookie policy content", async () => {
    render(<CookiePolicyPage isAdmin />);

    const titleInput = await screen.findByLabelText("Page title");
    fireEvent.change(titleInput, { target: { value: "Updated Cookie Policy" } });
    expect(screen.getByRole("heading", { name: "Updated Cookie Policy" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cookie sections" }));
    fireEvent.click(screen.getByRole("button", { name: "Add section" }));
    expect(screen.getByLabelText("Section heading")).toHaveValue("New section");

    fireEvent.click(screen.getByRole("button", { name: "Save for all visitors" }));
    await waitFor(() => {
      expect(axios.put).toHaveBeenCalledWith(
        expect.stringContaining("/admin/cookie-policy/content"),
        expect.objectContaining({
          hero: expect.objectContaining({ title: "Updated Cookie Policy" }),
          sections: expect.arrayContaining([expect.objectContaining({ title: "New section" })])
        }),
        expect.objectContaining({ headers: { Authorization: "Bearer admin-token" } })
      );
    });
  });
});
