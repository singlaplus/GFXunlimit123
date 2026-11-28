import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import axios from "axios";
import PrivacyPolicyPage from "./PrivacyPolicyPage";

jest.mock("axios");

describe("PrivacyPolicyPage", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("token", "admin-token");
    axios.get.mockResolvedValue({ data: { content: null } });
    axios.put.mockImplementation((_url, content) => Promise.resolve({ data: { content } }));
  });

  it("shows page customization controls only to an admin", async () => {
    const { rerender } = render(<PrivacyPolicyPage isAdmin={false} />);

    expect(await screen.findByRole("navigation", { name: "Privacy Policy sections" })).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Privacy Policy customization" })).not.toBeInTheDocument();

    rerender(<PrivacyPolicyPage isAdmin />);

    expect(await screen.findByRole("complementary", { name: "Privacy Policy customization" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Page customization menu" })).toBeInTheDocument();
  });

  it("previews admin edits and saves them for all visitors", async () => {
    render(<PrivacyPolicyPage isAdmin />);

    const titleInput = await screen.findByLabelText("Page title");
    fireEvent.change(titleInput, { target: { value: "Updated Privacy Policy" } });
    expect(screen.getByRole("heading", { name: "Updated Privacy Policy" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save for all visitors" }));

    await waitFor(() => {
      expect(axios.put).toHaveBeenCalledWith(
        expect.stringContaining("/admin/privacy-policy/content"),
        expect.objectContaining({ hero: expect.objectContaining({ title: "Updated Privacy Policy" }) }),
        expect.objectContaining({ headers: { Authorization: "Bearer admin-token" } })
      );
    });
    expect(await screen.findByRole("status")).toHaveTextContent("Published. All visitors will see these changes.");
  });

  it("lets admins choose a last-updated date from the styled calendar", async () => {
    render(<PrivacyPolicyPage isAdmin />);

    fireEvent.click(await screen.findByRole("button", { name: "Last updated: November 28, 2026" }));

    expect(screen.getByRole("dialog", { name: "Choose last updated date" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "November 2026" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(screen.getByRole("heading", { name: "December 2026" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    fireEvent.click(screen.getByRole("button", { name: "November 29, 2026" }));

    expect(screen.getByText("November 29, 2026", { selector: "time" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Last updated: November 29, 2026" })).toBeInTheDocument();
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  });

  it("previews and publishes an uploaded PNG card icon", async () => {
    const { container } = render(<PrivacyPolicyPage isAdmin />);
    const file = new File([
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/yL8AAAAASUVORK5CYII=",
        "base64"
      )
    ], "privacy-icon.png", { type: "image/png" });

    fireEvent.change(await screen.findByLabelText("Upload PNG card icon"), { target: { files: [file] } });

    const preview = await screen.findByRole("img", { name: "Card icon preview" });
    expect(preview.src).toMatch(/^data:image\/png;base64,/);
    expect(container.querySelector(".privacy-policy-hero-card-icon img")).toHaveAttribute("src", preview.src);

    fireEvent.click(screen.getByRole("button", { name: "Save for all visitors" }));
    await waitFor(() => {
      expect(axios.put).toHaveBeenCalledWith(
        expect.stringContaining("/admin/privacy-policy/content"),
        expect.objectContaining({
          hero: expect.objectContaining({
            cardIconImage: expect.stringMatching(/^data:image\/png;base64,/)
          })
        }),
        expect.objectContaining({ headers: { Authorization: "Bearer admin-token" } })
      );
    });
  });

  it("rejects non-PNG card icon uploads", async () => {
    render(<PrivacyPolicyPage isAdmin />);
    const file = new File(["not a PNG"], "privacy-icon.jpg", { type: "image/jpeg" });

    fireEvent.change(await screen.findByLabelText("Upload PNG card icon"), { target: { files: [file] } });

    expect(await screen.findByRole("alert")).toHaveTextContent("Choose a PNG image for the card icon.");
  });

  it("previews and publishes a hero background image without changing its colors", async () => {
    const file = new File([
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/yL8AAAAASUVORK5CYII=",
        "base64"
      )
    ], "hero-background.png", { type: "image/png" });
    const { container } = render(<PrivacyPolicyPage isAdmin />);

    fireEvent.change(await screen.findByLabelText("Upload hero background image"), { target: { files: [file] } });

    const preview = await screen.findByRole("img", { name: "Hero background preview" });
    expect(preview.src).toMatch(/^data:image\/png;base64,/);
    expect(container.querySelector(".privacy-policy-hero-background")).toHaveAttribute("src", preview.src);

    fireEvent.click(screen.getByRole("button", { name: "Appearance" }));
    expect(container.querySelector(".privacy-policy-editor-color input")).toHaveValue("#081a2b");
    fireEvent.click(screen.getByRole("button", { name: "Hero header" }));
    fireEvent.click(screen.getByRole("button", { name: "Save for all visitors" }));

    await waitFor(() => {
      expect(axios.put).toHaveBeenCalledWith(
        expect.stringContaining("/admin/privacy-policy/content"),
        expect.objectContaining({
          hero: expect.objectContaining({
            backgroundImage: expect.stringMatching(/^data:image\/png;base64,/)
          }),
          appearance: expect.objectContaining({ heroStart: "#081a2b" })
        }),
        expect.objectContaining({ headers: { Authorization: "Bearer admin-token" } })
      );
    });
  });
});
