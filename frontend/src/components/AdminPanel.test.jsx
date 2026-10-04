import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import AdminPanel from "./AdminPanel";
import { buildAnimatedCountSteps, getAnimatedCountDuration, getAnimatedCountIncrement, renderTaxFormTemplate } from "./AdminPanel";
import { useLocation } from "react-router-dom";
import axios from "axios";
import { toast } from "react-toastify";

jest.mock("react-router-dom", () => ({
  useLocation: jest.fn()
}), { virtual: true });

jest.mock("axios");

jest.mock("./Pagination", () => ({ currentPage, setCurrentPage }) => (
  <div data-testid="pagination">
    <button type="button" onClick={() => setCurrentPage(currentPage + 1)}>Next page</button>
  </div>
));

describe("AdminPanel collection controls", () => {
  it("uses irregular count-up increments at the requested magnitude", () => {
    expect(getAnimatedCountIncrement(100, 1)).toBe(1);
    expect(getAnimatedCountIncrement(101, 1)).toBeGreaterThanOrEqual(8);
    expect(getAnimatedCountIncrement(101, 1)).toBeLessThanOrEqual(12);
    expect(getAnimatedCountIncrement(1001, 1)).toBeGreaterThanOrEqual(85);
    expect(getAnimatedCountIncrement(1001, 1)).toBeLessThanOrEqual(115);
    expect(getAnimatedCountIncrement(1001, 1)).not.toBe(getAnimatedCountIncrement(1001, 2));
    expect(getAnimatedCountIncrement(10001, 1)).toBeGreaterThanOrEqual(850);
    expect(getAnimatedCountIncrement(100001, 1)).toBeGreaterThanOrEqual(8500);
    expect(getAnimatedCountIncrement(1000001, 1)).toBeGreaterThanOrEqual(85000);
  });

  it("distributes count-up steps across a two-second animation and reaches the exact total", () => {
    const steps = buildAnimatedCountSteps(145);

    expect(steps.length).toBe(15);
    expect(steps.reduce((total, step) => total + step, 0)).toBe(145);
    expect(new Set(steps).size).toBeGreaterThan(1);
    expect(buildAnimatedCountSteps(0)).toEqual([]);
  });

  it("uses longer count-up durations for larger asset totals", () => {
    expect(getAnimatedCountDuration(1000)).toBe(2000);
    expect(getAnimatedCountDuration(1001)).toBe(3000);
    expect(getAnimatedCountDuration(100000)).toBe(3000);
    expect(getAnimatedCountDuration(100001)).toBe(4000);
  });

  beforeEach(() => {
    window.history.pushState({}, "", "/");
    useLocation.mockReturnValue({ search: "?tab=controls" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/categories")) {
        return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      }
      if (url.includes("/admin/collections")) {
        return Promise.resolve({ data: [{ id: 1, name: "Nature" }] });
      }
      return Promise.resolve({ data: [{ id: 1, title: "Live asset", status: "approved", filename: "asset.jpg", category: "Images", keywords: "", description: "", type: "image" }] });
    });
    axios.post.mockResolvedValue({ data: { id: 2, name: "Travel" } });
    axios.delete.mockResolvedValue({ data: { id: 1, name: "Nature" } });
  });

  it("renders collection controls without approval or rejection actions", async () => {
    render(<AdminPanel />);

    expect(await screen.findByText(/active collections/i)).toBeInTheDocument();
    expect(screen.queryByText(/^approve$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^reject$/i)).not.toBeInTheDocument();
    expect(screen.getByText(/manage categories/i)).toBeInTheDocument();
  });

  it("uses dark-friendly styling in the controls tab when dark mode is active", async () => {
    document.body.classList.add("dark-mode");
    useLocation.mockReturnValue({ search: "?tab=controls" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/categories")) {
        return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      }
      if (url.includes("/admin/collections")) {
        return Promise.resolve({ data: [{ id: 1, name: "Nature" }] });
      }
      return Promise.resolve({ data: [] });
    });

    render(<AdminPanel />);

    const manageCard = (await screen.findByRole("heading", { name: /manage categories/i })).closest(".admin-panel-card");
    expect(manageCard).toHaveStyle({ color: "#f8fafc" });
    expect(screen.getByPlaceholderText(/new category name/i)).toHaveStyle({ background: "#0f172a", color: "#f8fafc" });

    document.body.classList.remove("dark-mode");
  });

  it("shows category management controls in the controls tab", async () => {
    render(<AdminPanel />);

    expect(await screen.findByText(/manage categories/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/new category name/i)).toBeInTheDocument();
  });

  it("shows no category preview in the manage categories card when no categories exist", async () => {
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/categories")) {
        return Promise.resolve({ data: [] });
      }
      return Promise.resolve({ data: [] });
    });

    render(<AdminPanel />);

    expect(await screen.findByRole("heading", { name: /manage categories/i })).toBeInTheDocument();
    expect(screen.queryByText(/images/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no categories yet/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/unnamed category/i)).not.toBeInTheDocument();
  });

  it("closes category dialogs from their close buttons and backdrops", async () => {
    render(<AdminPanel />);

    fireEvent.click(await screen.findByRole("button", { name: /view categories/i }));
    const categoriesDialog = screen.getByRole("dialog", { name: /categories/i });
    fireEvent.click(within(categoriesDialog).getByRole("button", { name: /modify/i }));

    const editDialog = screen.getByRole("dialog", { name: /edit category/i });
    fireEvent.click(within(editDialog).getByRole("button", { name: /close edit category/i }));
    expect(screen.queryByRole("dialog", { name: /edit category/i })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: /categories/i })).toBeInTheDocument();

    fireEvent.click(within(categoriesDialog).getByRole("button", { name: /modify/i }));
    fireEvent.click(screen.getByRole("dialog", { name: /edit category/i }));
    expect(screen.queryByRole("dialog", { name: /edit category/i })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: /categories/i })).toBeInTheDocument();

    fireEvent.click(within(categoriesDialog).getByRole("button", { name: /close categories/i }));
    expect(screen.queryByRole("dialog", { name: /categories/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /view categories/i }));
    const reopenedCategoriesDialog = screen.getByRole("dialog", { name: /categories/i });
    fireEvent.click(reopenedCategoriesDialog);
    expect(screen.queryByRole("dialog", { name: /categories/i })).not.toBeInTheDocument();
  });

  it("closes the collection dialog from its close button or backdrop", async () => {
    render(<AdminPanel />);

    const collectionsCard = (await screen.findByRole("heading", { name: /active collections/i })).closest(".admin-panel-card");
    fireEvent.click(within(collectionsCard).getByRole("button", { name: /view collections/i }));
    let collectionsDialog = await screen.findByRole("dialog", { name: /collections/i });
    const collectionsPanel = collectionsDialog.querySelector("h3").parentElement.parentElement;
    fireEvent.click(within(collectionsPanel).getByRole("button", { name: /close collections/i }));
    expect(screen.queryByRole("dialog", { name: /collections/i })).not.toBeInTheDocument();

    fireEvent.click(within(collectionsCard).getByRole("button", { name: /view collections/i }));
    collectionsDialog = await screen.findByRole("dialog", { name: /collections/i });
    fireEvent.click(collectionsDialog);
    expect(screen.queryByRole("dialog", { name: /collections/i })).not.toBeInTheDocument();
  });

  it("shows success toasts after adding and deleting a collection", async () => {
    const successToast = jest.spyOn(toast, "success");
    render(<AdminPanel />);

    fireEvent.change(screen.getByPlaceholderText(/new collection name/i), { target: { value: "Travel" } });
    fireEvent.click(screen.getByRole("button", { name: /^add collection$/i }));
    await waitFor(() => expect(successToast).toHaveBeenCalledWith("Collection added successfully."));

    const collectionsCard = screen.getByRole("heading", { name: /active collections/i }).closest(".admin-panel-card");
    fireEvent.click(within(collectionsCard).getByRole("button", { name: /view collections/i }));
    const collectionsDialog = await screen.findByRole("dialog", { name: /collections/i });
    fireEvent.click(within(collectionsDialog).getAllByRole("button", { name: /delete/i })[0]);
    await waitFor(() => expect(successToast).toHaveBeenCalledWith("Collection deleted successfully."));

    successToast.mockRestore();
  });

  it("shows a success toast after saving a category rename", async () => {
    axios.put.mockResolvedValue({ data: { id: 1, name: "Abstracts" } });
    const successToast = jest.spyOn(toast, "success");
    render(<AdminPanel />);

    fireEvent.click(await screen.findByRole("button", { name: /view categories/i }));
    const categoriesDialog = screen.getByRole("dialog", { name: /categories/i });
    fireEvent.click(within(categoriesDialog).getByRole("button", { name: /modify/i }));
    fireEvent.change(screen.getByRole("textbox", { name: /category name/i }), { target: { value: "Abstracts" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(successToast).toHaveBeenCalledWith("Category saved successfully."));
    expect(await screen.findByText("Abstracts")).toBeInTheDocument();
    successToast.mockRestore();
  });

  it("shows success toasts after adding and deleting a category", async () => {
    const successToast = jest.spyOn(toast, "success");
    render(<AdminPanel />);

    fireEvent.change(screen.getByPlaceholderText(/new category name/i), { target: { value: "Travel" } });
    fireEvent.click(screen.getByRole("button", { name: /add category/i }));
    await waitFor(() => expect(successToast).toHaveBeenCalledWith("Category added successfully."));

    fireEvent.click(screen.getByRole("button", { name: /view categories/i }));
    const categoriesDialog = screen.getByRole("dialog", { name: /categories/i });
    fireEvent.click(within(categoriesDialog).getAllByRole("button", { name: /delete/i })[0]);
    await waitFor(() => expect(successToast).toHaveBeenCalledWith("Category deleted successfully."));

    successToast.mockRestore();
  });

  it("renders the admin dashboard overview tab", async () => {
    useLocation.mockReturnValue({ search: "?tab=admin_dashboard" });
    render(<AdminPanel />);

    expect(await screen.findByRole("heading", { name: /^dashboard$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^dashboard$/i })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: /contributor approval/i }));
    expect(await screen.findByRole("heading", { name: /contributor approval/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /customer approval/i }));
    expect(await screen.findByRole("heading", { name: /customer approval/i })).toBeInTheDocument();
  });

  it("shows contributor and customer detail cards in the controls tab", async () => {
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/users")) {
        return Promise.resolve({ data: [
          { id: 1, full_name: "Contributor One", username: "contributor1", email: "creator@example.com", role: "contributor", status: "active" },
          { id: 2, full_name: "Customer One", username: "customer1", email: "buyer@example.com", role: "customer", status: "pending" }
        ] });
      }
      if (url.includes("/admin/categories")) return Promise.resolve({ data: [] });
      if (url.includes("/admin/collections")) return Promise.resolve({ data: [] });
      return Promise.resolve({ data: [] });
    });

    render(<AdminPanel />);

    expect(await screen.findByRole("heading", { name: /contributor details/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /customer details/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^view contributors$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^contributor details$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^tax forms$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^customer details$/i })).toBeInTheDocument();
  });

  it("shows database and assets connection cards in the controls tab", async () => {
    render(<AdminPanel />);

    expect(await screen.findByRole("heading", { name: /database connection/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /assets connection/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^database$/i }));
    expect(window.location.href).toContain("tab=controls_database");

    fireEvent.click(screen.getByRole("button", { name: /^assets$/i }));
    expect(window.location.href).toContain("tab=controls_assets");
  });

  it("shows the actual upload folder path on the assets controls page", async () => {
    useLocation.mockReturnValue({ search: "?tab=controls_assets" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/assets/location")) {
        return Promise.resolve({ data: { uploadFolderPath: "/Users/gfxunlimit/Documents/stocksite/backend/uploads", folderSizeBytes: 783 * 1024 * 1024, driveFreeBytes: 217 * 1024 * 1024 * 1024 } });
      }
      return Promise.resolve({ data: [] });
    });

    render(<AdminPanel />);

    expect(await screen.findByText("/Users/gfxunlimit/Documents/stocksite/backend/uploads")).toBeInTheDocument();
    expect(screen.getByText("Folder size: 783.00 MB")).toBeInTheDocument();
    expect(screen.getByText("Drive free space: 217.00 GB")).toBeInTheDocument();
  });

  it("shows the actual database data path on the database controls page", async () => {
    useLocation.mockReturnValue({ search: "?tab=controls_database" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/database/location")) {
        return Promise.resolve({ data: { connected: true, databaseName: "stocksite", host: "localhost", port: 5432, databasePath: "F:\\GFXunlimitDatabase", dataDirectory: "F:\\GFXunlimitDatabase", dataDirectorySizeBytes: 1024 * 1024 * 1024, dataDirectoryFreeBytes: 20 * 1024 * 1024 * 1024, databaseBackupFolder: "/Users/gfxunlimit/Documents/stocksite/Database", databaseBackupFolderSizeBytes: 5 * 1024 * 1024, databaseBackupFolderFreeBytes: 20 * 1024 * 1024 * 1024 } });
      }
      return Promise.resolve({ data: [] });
    });

    render(<AdminPanel />);

    expect(await screen.findByText("F:\\GFXunlimitDatabase")).toBeInTheDocument();
    expect(screen.getByText("Database: stocksite")).toBeInTheDocument();
    expect(screen.getByText("Host: localhost")).toBeInTheDocument();
    expect(screen.getByText("Port: 5432")).toBeInTheDocument();
    expect(screen.getByText("/Users/gfxunlimit/Documents/stocksite/Database")).toBeInTheDocument();
    expect(screen.getByText("Folder size: 5.00 MB · Drive free space: 20.00 GB")).toBeInTheDocument();
    expect(screen.queryByText("Folder size: 1.00 GB · Drive free space: 20.00 GB")).not.toBeInTheDocument();
  });

  it("refetches the database location after the admin token becomes available", async () => {
    useLocation.mockReturnValue({ search: "?tab=controls_database" });
    localStorage.removeItem("token");
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/database/location")) {
        if (!localStorage.getItem("token")) {
          return Promise.reject({ response: { status: 401, data: "Access denied" } });
        }
        return Promise.resolve({ data: { connected: true, databaseName: "stocksite", host: "localhost", port: 5432, databasePath: "F:\\GFXunlimitDatabase", dataDirectory: "F:\\GFXunlimitDatabase" } });
      }
      return Promise.resolve({ data: [] });
    });

    const { rerender } = render(<AdminPanel />);

    expect(await screen.findByText("Unable to determine database path")).toBeInTheDocument();

    localStorage.setItem("token", "admin-token");
    window.dispatchEvent(new Event("auth-changed"));
    rerender(<AdminPanel />);

    expect(await screen.findByText("F:\\GFXunlimitDatabase")).toBeInTheDocument();
    expect(screen.getByText("Database: stocksite")).toBeInTheDocument();
  });

  it("opens the controls tax forms tab with the controls_taxforms route", async () => {
    render(<AdminPanel />);

    const taxFormsButton = await screen.findByRole("button", { name: /^tax forms$/i });
    fireEvent.click(taxFormsButton);

    await waitFor(() => {
      expect(window.location.href).toContain("tab=controls_taxforms");
    });
  });

  it("shows submitted contributor tax forms in the controls tax forms tab", async () => {
    useLocation.mockReturnValue({ search: "?tab=controls_taxforms" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/users")) {
        return Promise.resolve({ data: [{
          id: 1,
          full_name: "Submitted Contributor",
          username: "submitted_creator",
          email: "submitted@example.com",
          role: "contributor",
          status: "active",
          tax_form_status: "submitted",
          tax_form_submitted_at: "2026-09-14T10:00:00.000Z",
          tax_form_data: { entityType: "Individual", city: "Patiala", country: "India" }
        }] });
      }
      return Promise.resolve({ data: [] });
    });

    render(<AdminPanel />);

    expect(await screen.findByText("Submitted Contributor")).toBeInTheDocument();
    expect(screen.getByText("submitted")).toBeInTheDocument();
    expect(screen.getByText(/Sep 14, 2026|14 Sep 2026/)).toBeInTheDocument();
    expect(screen.getByText("Individual")).toBeInTheDocument();
    expect(screen.getByText("Patiala, India")).toBeInTheDocument();
  });

  it("shows the expires in countdown in the tax forms table", async () => {
    useLocation.mockReturnValue({ search: "?tab=controls_taxforms" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/users")) {
        return Promise.resolve({ data: [{
          id: 1,
          full_name: "Submitted Contributor",
          username: "submitted_creator",
          email: "submitted@example.com",
          role: "contributor",
          status: "active",
          tax_form_status: "submitted",
          tax_form_submitted_at: "2026-09-14T10:00:00.000Z",
          tax_form_data: { entityType: "Individual", city: "Patiala", country: "India" }
        }] });
      }
      return Promise.resolve({ data: [] });
    });

    render(<AdminPanel />);

    expect(await screen.findByText(/expires in/i)).toBeInTheDocument();
    expect(screen.getByText(/\d+\s+day(s)?\s+left/i)).toBeInTheDocument();
  });

  it("expires the current tax form immediately", async () => {
    useLocation.mockReturnValue({ search: "?tab=controls_taxforms" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/users")) {
        return Promise.resolve({ data: [{
          id: 9,
          full_name: "Expiring Contributor",
          username: "expiring_user",
          email: "expiring@example.com",
          role: "contributor",
          tax_form_status: "submitted",
          tax_form_submitted_at: "2026-09-14T10:00:00.000Z",
          tax_form_data: { entityType: "Individual" }
        }] });
      }
      return Promise.resolve({ data: [] });
    });
    axios.put.mockResolvedValue({ data: { status: "expired" } });

    render(<AdminPanel />);

    fireEvent.click(await screen.findByRole("button", { name: /^expire$/i }));

    await waitFor(() => {
      expect(axios.put).toHaveBeenCalledWith(
        expect.stringContaining("/admin/tax-forms/9/status"),
        { status: "expired" },
        expect.anything()
      );
    });
  });

  it("renders the expired tax form email subject and body with the contributor's expiry date", () => {
    const template = {
      subject: "Your Tax Form Expired on {{expiry_date}}",
      body: "Hello {{contributor_name}}, your tax form expired on {{expiry_date}}."
    };

    const result = renderTaxFormTemplate(template, {
      full_name: "Expired Contributor",
      username: "expired_user",
      email: "expired@example.com",
      tax_form_submitted_at: "2026-09-14T10:00:00.000Z",
      tax_form_data: { formType: "W-8BEN" }
    }, new Date("2026-09-20T00:00:00.000Z"));

    expect(result.subject).toContain("Sep 12, 2027");
    expect(result.subject).toContain("Your Tax Form Expired on");
    expect(result.body).toContain("Expired Contributor");
    expect(result.body).toContain("Sep 12, 2027");
  });

  it("sends the saved approved template email when a tax form is approved", async () => {
    useLocation.mockReturnValue({ search: "?tab=controls_taxforms" });
    localStorage.setItem("taxMailTemplates", JSON.stringify({
      approved: {
        name: "Tax Form Approved",
        subject: "Approved template subject",
        body: "Hello {{contributor_name}} — your tax form for {{form_type}} was approved on {{submission_date}}."
      },
      rejected: {
        name: "Tax Form Requires Revision",
        subject: "Rejected template subject",
        body: "Hello {{contributor_name}} — please revise your form."
      }
    }));
    localStorage.setItem("taxMailSMTPSettings", JSON.stringify({
      smtp_from_name: "Tax Mail",
      smtp_from_email: "tax@gfxunlimit.com",
      smtp_host: "smtp.hostinger.com",
      smtp_port: 465,
      smtp_username: "tax@gfxunlimit.com",
      smtp_password: "secret"
    }));

    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/users")) {
        return Promise.resolve({ data: [{
          id: 7,
          full_name: "Approved Contributor",
          username: "approved_user",
          email: "approved@example.com",
          role: "contributor",
          status: "active",
          tax_form_status: "submitted",
          tax_form_submitted_at: "2026-09-14T10:00:00.000Z",
          tax_form_data: { formType: "W-8BEN" }
        }] });
      }
      if (url.includes("/admin/email/tax-mail-config")) {
        return Promise.resolve({ data: {
          templates: JSON.parse(localStorage.getItem("taxMailTemplates")),
          smtp_settings: { sender_email: "tax@gfxunlimit.com", smtp_host: "smtp.hostinger.com", smtp_port: 465, smtp_user: "tax@gfxunlimit.com", smtp_pass: "secret", smtp_secure: true }
        } });
      }
      return Promise.resolve({ data: [] });
    });
    axios.put.mockResolvedValue({ data: { ok: true } });
    axios.post.mockResolvedValue({ data: { ok: true } });

    render(<AdminPanel />);

    fireEvent.click(await screen.findByRole("button", { name: /approve/i }));

    await waitFor(() => {
      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining("/admin/email/tax-mail/send-test"),
        expect.objectContaining({
          to: "approved@example.com",
          subject: "Approved template subject",
          body: expect.stringContaining("Approved Contributor")
        }),
        expect.anything()
      );
    });
  });

  it("sends the saved reminder template email when the reminder button is clicked", async () => {
    useLocation.mockReturnValue({ search: "?tab=controls_taxforms" });
    localStorage.setItem("taxMailTemplates", JSON.stringify({
      reminder: {
        name: "Tax Form Reminder",
        subject: "Reminder template subject",
        body: "Hello {{contributor_name}} — please submit your {{form_type}} form."
      }
    }));
    localStorage.setItem("taxMailSMTPSettings", JSON.stringify({
      smtp_from_name: "Tax Mail",
      smtp_from_email: "tax@gfxunlimit.com",
      smtp_host: "smtp.hostinger.com",
      smtp_port: 465,
      smtp_username: "tax@gfxunlimit.com",
      smtp_password: "secret"
    }));

    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/users")) {
        return Promise.resolve({ data: [{
          id: 8,
          full_name: "Reminder Contributor",
          username: "reminder_user",
          email: "reminder@example.com",
          role: "contributor",
          status: "active",
          tax_form_status: "submitted",
          tax_form_data: { formType: "W-9" }
        }] });
      }
      if (url.includes("/admin/email/tax-mail-config")) {
        return Promise.resolve({ data: {
          templates: JSON.parse(localStorage.getItem("taxMailTemplates")),
          smtp_settings: { sender_email: "tax@gfxunlimit.com", smtp_host: "smtp.hostinger.com", smtp_port: 465, smtp_user: "tax@gfxunlimit.com", smtp_pass: "secret", smtp_secure: true }
        } });
      }
      return Promise.resolve({ data: [] });
    });
    axios.post.mockResolvedValue({ data: { ok: true } });

    render(<AdminPanel />);

    fireEvent.click(await screen.findByRole("button", { name: /reminder/i }));

    await waitFor(() => {
      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining("/admin/email/tax-mail/send-test"),
        expect.objectContaining({
          to: "reminder@example.com",
          subject: "Reminder template subject",
          body: expect.stringContaining("Reminder Contributor")
        }),
        expect.anything()
      );
    });
  });

  it("searches contributor details by username or email", async () => {
    useLocation.mockReturnValue({ search: "?tab=contributordetails" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/users")) {
        return Promise.resolve({ data: [
          { id: 1, full_name: "Alpha Creator", username: "alpha_creator", email: "alpha@example.com", role: "contributor", status: "active" },
          { id: 2, full_name: "Beta Creator", username: "beta_creator", email: "beta@example.com", role: "contributor", status: "active" }
        ] });
      }
      return Promise.resolve({ data: [] });
    });

    render(<AdminPanel />);

    const search = await screen.findByPlaceholderText(/search by username or email/i);
    fireEvent.change(search, { target: { value: "beta@example" } });
    expect(search).toHaveValue("beta@example");
  });

  it("adds the selected contributor username to the contributor details URL", async () => {
    useLocation.mockReturnValue({ search: "?tab=contributordetails" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/users")) {
        return Promise.resolve({ data: [
          { id: 1, full_name: "Alpha Creator", username: "alpha_creator", email: "alpha@example.com", role: "contributor", status: "active" },
          { id: 2, full_name: "Beta Creator", username: "beta_creator", email: "beta@example.com", role: "contributor", status: "active" }
        ] });
      }
      return Promise.resolve({ data: [] });
    });

    render(<AdminPanel />);

    const search = await screen.findByPlaceholderText(/search by username or email/i);
    fireEvent.change(search, { target: { value: "alpha@example" } });

    const alphaButton = await screen.findByRole("button", { name: /Alpha Creator/i });
    fireEvent.click(alphaButton);

    await waitFor(() => {
      expect(window.location.search).toContain("username=alpha_creator");
    });
  });

  it("normalizes legacy contributor analytics fields for the selected card", async () => {
    useLocation.mockReturnValue({ search: "?tab=contributordetails" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/users")) {
        return Promise.resolve({ data: [{
          id: 1,
          full_name: "Legacy Creator",
          username: "legacy_creator",
          email: "legacy@example.com",
          role: "contributor",
          status: "active",
          order_count: 15,
          accepted_upload_count: 4,
          pending_upload_count: 0,
          rejected_upload_count: 1,
          order_details: [{ order_id: 22, order_number: "ORD-22", order_status: "completed", payment_status: "paid", title: "Approved asset sale", created_at: "2026-09-14T10:00:00Z" }]
        }] });
      }
      if (url.includes("/admin/images")) {
        return Promise.resolve({ data: [
          { id: 4, uploaded_by: 1, contributor_username: "legacy_creator", title: "Approved asset", status: "approved", created_at: "2026-09-14T10:00:00Z" },
          { id: 5, uploaded_by: 1, contributor_username: "legacy_creator", title: "Pending asset", status: "pending", created_at: "2026-09-13T10:00:00Z" },
          { id: 6, uploaded_by: 1, contributor_username: "legacy_creator", title: "Rejected asset", status: "rejected", created_at: "2026-09-12T10:00:00Z" }
        ] });
      }
      return Promise.resolve({ data: [] });
    });

    render(<AdminPanel />);

    const search = await screen.findByPlaceholderText(/search by username or email/i);
    fireEvent.change(search, { target: { value: "legacy_creator" } });
    fireEvent.click(await screen.findByRole("button", { name: /Legacy Creator/i }));

    const details = await screen.findByRole("region", { name: /selected contributor details/i });
    expect(details).toHaveTextContent("Orders15");
    expect(details).toHaveTextContent("Approved4");
    expect(details).toHaveTextContent("Pending0");
    expect(details).toHaveTextContent("Rejected1");
    expect(details).toHaveTextContent("PermissionsBulk upload: No Upload limit: 20 GB");

    fireEvent.click(screen.getByText("Orders").closest("article"));
    const ordersDialog = await screen.findByRole("dialog", { name: "Orders" });
    expect(ordersDialog).toHaveTextContent("Approved asset sale");
    expect(within(ordersDialog).getByRole("table")).toBeInTheDocument();
    expect(within(ordersDialog).getByText("Order status")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByText("Approved").closest("article"));
    const approvedDialog = await screen.findByRole("dialog", { name: "Approved" });
    expect(approvedDialog).toHaveTextContent("Approved asset");
    expect(within(approvedDialog).getByRole("img", { name: "Approved asset" })).toBeInTheDocument();
  });

  it("renders the live reputation score returned by the admin user query", async () => {
    useLocation.mockReturnValue({ search: "?tab=contributordetails&username=live_creator" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/users")) {
        return Promise.resolve({ data: [{
          id: 1,
          full_name: "Live Creator",
          username: "live_creator",
          email: "live@example.com",
          role: "contributor",
          status: "active",
          total_uploads: 4,
          total_downloads: 6,
          total_views: 5,
          total_earnings: 123.45,
          unpaid_earnings: 98.45,
          loyalty_points: 3,
          tax_form_submitted: true,
          reputation_score: 2
        }] });
      }
      return Promise.resolve({ data: [] });
    });

    render(<AdminPanel />);

    const details = await screen.findByRole("region", { name: /selected contributor details/i });
    expect(details).toHaveTextContent("Reputation score2");
    expect(details).toHaveTextContent("Total earnings123.45");
    expect(details).toHaveTextContent("Unpaid earnings98.45");
    expect(details).toHaveTextContent("Loyalty points3");
    expect(details).toHaveTextContent("Tax Form SubmittedYes");
  });

  it("renders actual asset counts from collection payloads that use count fields", async () => {
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/categories")) {
        return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      }
      if (url.includes("/admin/collections")) {
        return Promise.resolve({ data: [{ id: 1, name: "Photos", count: 31, live_asset_count: 27 }, { id: 2, name: "Videos", count: 23, live_asset_count: 19 }] });
      }
      return Promise.resolve({ data: [{ id: 1, title: "Live asset", status: "approved", filename: "asset.jpg", category: "Images", keywords: "", description: "", type: "image" }] });
    });

    render(<AdminPanel />);

    const collectionsCard = (await screen.findByRole("heading", { name: /active collections/i })).closest(".admin-panel-card");
    expect(within(collectionsCard).queryByText("Photos")).not.toBeInTheDocument();
    expect(within(collectionsCard).queryByText("Videos")).not.toBeInTheDocument();
    fireEvent.click(within(collectionsCard).getByRole("button", { name: /view collections/i }));
    expect(await screen.findByText(/31 total assets/i)).toBeInTheDocument();
    expect(await screen.findByText(/27 live assets/i)).toBeInTheDocument();
    expect(await screen.findByText(/23 total assets/i)).toBeInTheDocument();
    expect(await screen.findByText(/19 live assets/i)).toBeInTheDocument();
  });

  it("uses the live backend collection list instead of stale cached values when the admin endpoint returns an empty array", async () => {
    const staleCollections = [{ id: 99, name: "Photos", asset_count: 0 }];
    window.localStorage.setItem("asset-collections", JSON.stringify(staleCollections));

    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/categories")) {
        return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      }
      if (url.includes("/admin/collections")) {
        return Promise.resolve({ data: [] });
      }
      if (url.includes("/collections")) {
        return Promise.resolve({ data: [{ id: 1, name: "Photos", asset_count: 31, live_asset_count: 25 }, { id: 2, name: "Videos", asset_count: 23, live_asset_count: 21 }] });
      }
      return Promise.resolve({ data: [{ id: 1, title: "Live asset", status: "approved", filename: "asset.jpg", category: "Images", keywords: "", description: "", type: "image" }] });
    });

    render(<AdminPanel />);

    const collectionsCard = (await screen.findByRole("heading", { name: /active collections/i })).closest(".admin-panel-card");
    fireEvent.click(within(collectionsCard).getByRole("button", { name: /view collections/i }));
    expect(await screen.findByText(/31 total assets/i)).toBeInTheDocument();
    expect(await screen.findByText(/25 live assets/i)).toBeInTheDocument();
    expect(await screen.findByText(/23 total assets/i)).toBeInTheDocument();
    expect(await screen.findByText(/21 live assets/i)).toBeInTheDocument();
  });

  it("shows a backup/restore card that opens the real admin route in the same tab", async () => {
    const originalLocation = window.location;
    const hrefSpy = jest.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...originalLocation,
        href: originalLocation.href,
        origin: originalLocation.origin,
        assign: jest.fn(),
        replace: jest.fn(),
        set href(next) {
          hrefSpy(next);
        },
        get href() {
          return originalLocation.href;
        }
      }
    });

    render(<AdminPanel />);

    expect(document.body.textContent).toContain("Backup/Restore");

    fireEvent.click(screen.getByText(/^Backup$/i));
    fireEvent.click(screen.getByText(/^Restore$/i));

    const adminBasePath = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm";
    expect(hrefSpy).toHaveBeenNthCalledWith(1, `${originalLocation.origin}${adminBasePath}?tab=backup`);
    expect(hrefSpy).toHaveBeenNthCalledWith(2, `${originalLocation.origin}${adminBasePath}?tab=restore`);

    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation
    });
  });

  it("shows the GFX Backup UI on the backup page only", async () => {
    useLocation.mockReturnValue({ search: "?tab=backup" });

    render(<AdminPanel />);

    expect(await screen.findByText(/GFX Backup/i)).toBeInTheDocument();
    expect(screen.getByText(/Backup Mode/i)).toBeInTheDocument();
    expect(screen.getByText(/Incremental Backup/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Create Backup/i })).toBeInTheDocument();
  });

  it("defaults the backup mode to incremental backup", async () => {
    useLocation.mockReturnValue({ search: "?tab=backup" });

    render(<AdminPanel />);

    const incrementalOption = await screen.findByLabelText(/incremental backup/i);
    expect(incrementalOption).toBeChecked();
  });

  it("shows progress steps while creating a backup and keeps the UI responsive", async () => {
    jest.useFakeTimers();
    useLocation.mockReturnValue({ search: "?tab=backup" });
    axios.post.mockResolvedValue({
      data: {
        backupId: "GFX-TEST-001",
        fileName: "GFX_BACKUP_TEST.gfxbackup",
        saveLocation: "backend/backup",
        mode: "Incremental Backup",
        downloadUrl: null
      }
    });

    render(<AdminPanel />);

    fireEvent.click(screen.getByRole("button", { name: /create backup/i }));

    expect(screen.getByText(/creating gfx backup/i)).toBeInTheDocument();
    expect(screen.getByText(/reading synchronization history/i)).toBeInTheDocument();

    jest.advanceTimersByTime(1500);
    expect(screen.getByText(/detecting changed application files/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText(/backup completed successfully\./i)).toBeInTheDocument();
    });

    jest.useRealTimers();
  });

  it("shows the selected backup from and to range in the summary", async () => {
    useLocation.mockReturnValue({ search: "?tab=backup" });
    axios.post.mockResolvedValue({
      data: {
        backupId: "GFX-TEST-002",
        fileName: "GFX_BACKUP_RANGE.gfxbackup",
        saveLocation: "backend/backup",
        mode: "Incremental Backup",
        from: "2026-08-01",
        to: "2026-08-30",
        downloadUrl: null
      }
    });

    render(<AdminPanel />);

    fireEvent.change(screen.getByLabelText(/backup from/i), { target: { value: "2026-08-01" } });
    fireEvent.change(screen.getByLabelText(/backup to/i), { target: { value: "2026-08-30" } });
    fireEvent.click(screen.getByRole("button", { name: /create backup/i }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /backup completed/i })).toBeInTheDocument();
    });

    const summaryCard = screen.getByRole("heading", { name: /backup completed/i }).closest("div");
    expect(summaryCard).toHaveTextContent(/from:/i);
    expect(summaryCard).not.toHaveTextContent(/from:\s*n\/a/i);
    expect(summaryCard).toHaveTextContent(/to:/i);
    expect(summaryCard).not.toHaveTextContent(/to:\s*n\/a/i);
  });

  it("loads the available backups from the backend so the page shows all real backup files", async () => {
    useLocation.mockReturnValue({ search: "?tab=backup" });
    
    // Mock axios.get to return backup list for this test
    jest.clearAllMocks();
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/backup/list")) {
        return Promise.resolve({
          data: [{
            fileName: "GFX_BACKUP_REAL_01.gfxbackup",
            filePath: "backend/backup/GFX_BACKUP_REAL_01.gfxbackup",
            createdAt: "2026-08-29T10:00:00.000Z",
            size: 12345,
            mode: "Incremental Backup",
            backupId: "GFX_BACKUP_REAL_01"
          }]
        });
      }
      if (url.includes("/admin/categories")) {
        return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      }
      if (url.includes("/admin/collections")) {
        return Promise.resolve({ data: [{ id: 1, name: "Nature" }] });
      }
      return Promise.resolve({ data: [{ id: 1, title: "Live asset", status: "approved", filename: "asset.jpg", category: "Images", keywords: "", description: "", type: "image" }] });
    });
    axios.post.mockResolvedValue({ data: { id: 2, name: "Travel" } });
    axios.delete.mockResolvedValue({ data: { id: 1, name: "Nature" } });

    render(<AdminPanel />);

    // Wait for the backup list to be fetched and rendered - check the real filename appears
    expect(await screen.findByText(/GFX_BACKUP_REAL_01.gfxbackup/i)).toBeInTheDocument();
  });

  it("keeps the last successful backup as the default incremental source without showing a range selector", async () => {
    useLocation.mockReturnValue({ search: "?tab=backup" });
    const lastBackup = {
      backupId: "GFX-001",
      createdAt: "2026-08-29T10:00:00.000Z",
      from: "2026-08-28T00:00:00.000Z",
      to: "2026-08-29T10:00:00.000Z",
      fileName: "GFX_BACKUP_20260829T100000Z.gfxbackup",
      filePath: "backup/GFX_BACKUP_20260829T100000Z.gfxbackup",
      file: "GFX_BACKUP_20260829T100000Z.gfxbackup",
      mode: "Incremental Backup"
    };

    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/backup/list")) {
        return Promise.resolve({ data: [lastBackup] });
      }
      return Promise.resolve({ data: [{ id: 1, title: "Live asset", status: "approved", filename: "asset.jpg", category: "Images", keywords: "", description: "", type: "image" }] });
    });
    window.localStorage.setItem("gfx-backup-history", JSON.stringify([lastBackup]));

    render(<AdminPanel />);

    expect(screen.queryByText(/Backup Range/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/last successful backup/i)).not.toBeInTheDocument();
    expect(await screen.findByText(/Available backups/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Incremental Backup/i).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /create backup/i }));

    await waitFor(() => {
      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining("/admin/backup/create"),
        expect.objectContaining({
          previousBackupId: "GFX-001",
          from: "2026-08-29T00:00:00.000Z",
          to: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
        }),
        expect.anything()
      );
    });

    window.localStorage.removeItem("gfx-backup-history");
  });

  it("uses a persistent generated device ID in GFX format instead of the raw browser user agent", async () => {
    useLocation.mockReturnValue({ search: "?tab=backup" });
    window.localStorage.removeItem("gfx-device-id");

    render(<AdminPanel />);

    fireEvent.click(screen.getByRole("button", { name: /create backup/i }));

    await waitFor(() => {
      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining("/admin/backup/create"),
        expect.objectContaining({
          deviceId: expect.stringMatching(/^GFX-(MAC|PC1|LINUX|DEVICE)-\d{3}$/i)
        }),
        expect.anything()
      );
    });

    expect(window.localStorage.getItem("gfx-device-id")).toMatch(/^GFX-(MAC|PC1|LINUX|DEVICE)-\d{3}$/i);
    window.localStorage.removeItem("gfx-device-id");
  });

  it("shows a dedicated daily reports control card in the controls tab", async () => {
    render(<AdminPanel />);

    await waitFor(() => {
      expect(screen.getByText(/daily reports/i)).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: /daily report settings/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /preview daily report/i })).toBeInTheDocument();
    expect(screen.getByText(/schedule and preview the automated daily website summary email/i)).toBeInTheDocument();
  });

  it("opens the daily report settings page without the website feature, email, or time controls", async () => {
    render(<AdminPanel />);

    fireEvent.click(screen.getByRole("button", { name: /daily report settings/i }));

    expect(window.location.pathname).toContain("/email/daily-report-settings");
    expect(screen.getByText(/daily report settings/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/entire website feature/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/daily report email id/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/daily report time/i)).not.toBeInTheDocument();
  });

  it("keeps the daily reports controls available in the controls tab", async () => {
    render(<AdminPanel />);

    await waitFor(() => {
      expect(screen.getByText(/daily reports/i)).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: /daily report settings/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /preview daily report/i })).toBeInTheDocument();
    expect(screen.getByText(/automated daily website summary email for admins and selected recipients/i)).toBeInTheDocument();
  });

  it("provides a blog link that opens in the same page from legal resources", async () => {
    render(<AdminPanel />);

    const blogLink = screen.getByRole("link", { name: "Blog" });

    expect(blogLink).toHaveAttribute("href", "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm?tab=controls_blog");
    expect(blogLink).not.toHaveAttribute("target");
    expect(blogLink).not.toHaveAttribute("rel");
  });

  it("renders currency breakdowns without duplicate React keys", async () => {
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/email/daily-report-settings")) {
        return Promise.resolve({
          data: {
            ok: true,
            settings: {
              enabled: true,
              email: "admin@example.com",
              time: "09:00",
              metrics: { totalRevenueInr: true }
            }
          }
        });
      }
      if (url.includes("/admin/email/daily-report-preview")) {
        return Promise.resolve({
          data: {
            ok: true,
            summary: {
              totalRevenueInr: 150000,
              revenueCurrencyBreakdown: [{
                currency: "INR",
                total: 120000,
                collections: [{ name: "Photos", count: 90000 }],
                categories: [{ name: "Abstract", count: 70000 }],
                type: [{ name: "Commercial", count: 110000 }]
              }, {
                currency: "EUR",
                total: 30000,
                collections: [{ name: "Videos", count: 60000 }],
                categories: [{ name: "Backgrounds", count: 80000 }],
                type: [{ name: "Editorial", count: 40000 }]
              }]
            },
            html: "<p>report preview</p>",
            subject: "Daily revenue report",
          }
        });
      }
      return Promise.resolve({ data: [{ id: 1, title: "Live asset", status: "approved", filename: "asset.jpg", category: "Images", keywords: "", description: "", type: "image" }] });
    });

    render(<AdminPanel />);

    fireEvent.click(screen.getByRole("button", { name: /preview daily report/i }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /website analytics preview/i })).toBeInTheDocument();
    });

    expect(consoleErrorSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("Encountered two children with the same key")
    );

    consoleErrorSpy.mockRestore();
  });

  it("sends the full daily report preview HTML in the test email payload", async () => {
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/email/daily-report-settings")) {
        return Promise.resolve({
          data: {
            ok: true,
            settings: {
              enabled: true,
              email: "admin@example.com",
              time: "09:00",
              metrics: { totalRevenueInr: true }
            }
          }
        });
      }
      if (url.includes("/admin/email/daily-report-preview")) {
        return Promise.resolve({
          data: {
            ok: true,
            summary: {
              generatedAt: "2026-09-15T00:00:00.000Z",
              totalRevenueInr: 150000,
              totalAssets: 1200,
              totalDownloads: 6000
            },
            html: "<html><body><h1>ENORMOUS REPORT</h1><div> this should match the preview </div></body></html>",
            subject: "Daily revenue report",
          }
        });
      }
      return Promise.resolve({ data: [] });
    });

    axios.post.mockResolvedValue({ data: { ok: true } });

    render(<AdminPanel />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /preview daily report/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /preview daily report/i }));

    const smtpSettingsButton = await screen.findByRole("button", { name: /^report smtp setting$/i });
    fireEvent.click(smtpSettingsButton);

    fireEvent.click(await screen.findByRole("button", { name: /^send test mail$/i }));

    const dialog = await screen.findByRole("dialog", { name: /send test mail/i });
    fireEvent.change(within(dialog).getByPlaceholderText(/recipient@example.com/i), {
      target: { value: "admin@example.com" }
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /^send test mail$/i }));

    await waitFor(() => {
      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining("/admin/email/send-test"),
        expect.objectContaining({
          to: "admin@example.com",
          subject: "Daily revenue report",
          body: expect.stringContaining("ENORMOUS REPORT")
        }),
        expect.anything()
      );
    });

    const sendCall = axios.post.mock.calls.find(([url]) => url.includes("/admin/email/send-test"));
    expect(sendCall[1].body).toContain("ENORMOUS REPORT");
    expect(sendCall[1].body).toContain("<html");
  });

  it("uses the saved daily report SMTP config when the draft is stale before sending", async () => {
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/email/daily-report-settings")) {
        return Promise.resolve({
          data: {
            ok: true,
            settings: {
              enabled: true,
              email: "admin@example.com",
              time: "09:00",
              metrics: { totalRevenueInr: true },
              reportSmtp: {
                sender_name: "Daily11",
                sender_email: "reports@gfxunlimit.com",
                smtp_host: "smtp.hostinger.com",
                smtp_port: "465",
                smtp_user: "reports@gfxunlimit.com",
                smtp_pass: "#Pb11bx9363",
                smtp_secure: true
              }
            }
          }
        });
      }
      if (url.includes("/admin/email/daily-report-preview")) {
        return Promise.resolve({
          data: {
            ok: true,
            summary: { generatedAt: "2026-09-15T00:00:00.000Z", totalRevenueInr: 150000, totalAssets: 1200 },
            html: "<html><body><h1>HOSTINGER REPORT</h1></body></html>",
            subject: "Daily report"
          }
        });
      }
      return Promise.resolve({ data: [] });
    });

    axios.post.mockResolvedValue({ data: { ok: true } });

    render(<AdminPanel />);

    fireEvent.click(screen.getByRole("button", { name: /preview daily report/i }));
    const smtpSettingsButton = await screen.findByRole("button", { name: /^report smtp setting$/i });
    fireEvent.click(smtpSettingsButton);

    const hostInput = await screen.findByLabelText(/smtp host/i);
    fireEvent.change(hostInput, { target: { value: "smtp.gmail.com" } });

    fireEvent.click(screen.getByRole("button", { name: /send test mail/i }));
    const dialog = await screen.findByRole("dialog", { name: /send test mail/i });
    fireEvent.change(within(dialog).getByPlaceholderText(/recipient@example.com/i), {
      target: { value: "admin@example.com" }
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /^send test mail$/i }));

    await waitFor(() => {
      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining("/admin/email/send-test"),
        expect.objectContaining({
          smtp_host: "smtp.hostinger.com",
          smtp_user: "reports@gfxunlimit.com",
          smtp_pass: "#Pb11bx9363",
          to: "admin@example.com",
          subject: "Daily report"
        }),
        expect.anything()
      );
    });
  });

  it("shows the daily report checkbox as Last 24 Hr Downloads using the last 24 hour download count", async () => {
    render(<AdminPanel />);

    fireEvent.click(screen.getByRole("button", { name: /daily report settings/i }));

    expect(window.location.pathname).toContain("/email/daily-report-settings");
    expect(await screen.findByText(/daily report settings/i)).toBeInTheDocument();
    expect(screen.getAllByLabelText(/last 24 hr downloads/i).length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText(/last 7 days downloads/i).length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText(/last 30 days downloads/i).length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText(/last 365 days downloads/i).length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText(/current month downloads/i).length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText(/current fy downloads/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/new today/i)).not.toBeInTheDocument();
  });

  it("uses the saved schedule snapshot for its preview", async () => {
    const savedSchedule = {
      id: 42,
      name: "Morning Summary",
      time: "09:00",
      frequency: "daily",
      report_settings: {
        enabled: true,
        email: "scheduled@example.com",
        time: "09:00",
        metrics: { totalUsers: false, totalAssets: true },
        reportSmtp: { provider: "smtp", host: "smtp.schedule.test" }
      }
    };

    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/email/daily-report-schedules")) {
        return Promise.resolve({ data: { ok: true, schedules: [savedSchedule] } });
      }
      if (url.includes("/admin/email/daily-report-preview")) {
        return Promise.resolve({
          data: {
            ok: true,
            summary: { totalUsers: 3 },
            html: "<p>schedule preview</p>",
            subject: "Saved schedule preview",
            reportSettings: savedSchedule.report_settings
          }
        });
      }
      return Promise.resolve({ data: [{ id: 1, title: "Live asset", status: "approved", filename: "asset.jpg", category: "Images", keywords: "", description: "", type: "image" }] });
    });

    render(<AdminPanel />);

    fireEvent.click(screen.getByRole("button", { name: /scheduled reports/i }));
    expect(await screen.findByText(/morning summary/i)).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: /^preview$/i }));

    await waitFor(() => {
      expect(axios.get).toHaveBeenCalledWith(
        expect.stringContaining("/admin/email/daily-report-preview?scheduleId=42"),
        expect.objectContaining({ headers: expect.any(Object) })
      );
    });
    expect(await screen.findByText("schedule preview")).toBeInTheDocument();
  });

  it("saves the current scheduled report settings when updating an existing schedule", async () => {
    const savedSchedule = {
      id: 42,
      name: "Morning Summary",
      time: "09:00",
      frequency: "daily",
      report_settings: {
        enabled: true,
        email: "admin@example.com",
        time: "09:00",
        metrics: { totalUsers: true },
        reportSmtp: { provider: "smtp" }
      }
    };

    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/email/daily-report-settings")) {
        return Promise.resolve({
          data: {
            ok: true,
            settings: {
              enabled: true,
              email: "admin@example.com",
              time: "09:00",
              metrics: { totalUsers: true, totalAssets: false },
              reportSmtp: { provider: "smtp" }
            }
          }
        });
      }
      if (url.includes("/admin/email/daily-report-schedules")) {
        return Promise.resolve({ data: { ok: true, schedules: [savedSchedule] } });
      }
      return Promise.resolve({ data: [{ id: 1, title: "Live asset", status: "approved", filename: "asset.jpg", category: "Images", keywords: "", description: "", type: "image" }] });
    });
    axios.put.mockResolvedValue({ data: { ok: true, schedule: savedSchedule } });

    render(<AdminPanel />);

    fireEvent.click(screen.getByRole("button", { name: /scheduled reports/i }));
    expect(await screen.findByText(/morning summary/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    fireEvent.click(screen.getByRole("button", { name: /update schedule/i }));

    await waitFor(() => {
      expect(axios.put).toHaveBeenCalledWith(
        "/admin/email/daily-report-schedules/42",
        expect.objectContaining({
          name: "Morning Summary",
          time: "09:00",
          frequency: "daily",
          reportSettings: expect.objectContaining({
            email: "admin@example.com",
            time: "09:00",
            metrics: expect.objectContaining({
              totalUsers: true,
              totalAssets: false
            })
          })
        }),
        expect.objectContaining({ headers: expect.any(Object) })
      );
    });
  });

  it("shows revenue group breakdowns under the Revenue (INR) preview card", async () => {
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/email/daily-report-settings")) {
        return Promise.resolve({
          data: {
            ok: true,
            settings: {
              enabled: true,
              email: "admin@example.com",
              time: "09:00",
              metrics: {
                totalRevenueInr: true,
                totalDiscountInr: true,
                totalEarningsInr: true,
                paymentFailedCount: true
              }
            }
          }
        });
      }
      if (url.includes("/admin/email/daily-report-preview")) {
        return Promise.resolve({
          data: {
            ok: true,
            summary: {
              totalRevenueInr: 150000,
              totalDiscountInr: 5000,
              totalEarningsInr: 20000,
              paymentFailedValue: 1250,
              paymentFailedCurrencyBreakdown: [{
                currency: "INR",
                total: 1250,
                collections: [{ name: "Photos", count: 1000 }],
                categories: [{ name: "Abstract", count: 1250 }],
                type: [{ name: "Commercial", count: 1250 }]
              }, {
                currency: "USD",
                total: 10,
                collections: [{ name: "Videos", count: 10 }],
                categories: [{ name: "Nature", count: 10 }],
                type: [{ name: "Editorial", count: 10 }]
              }],
              currencyRevenueBreakdown: [{ name: "INR", count: 120000 }, { name: "EUR", count: 30000 }],
              collectionRevenueBreakdown: [{ name: "Photos", count: 90000 }, { name: "Videos", count: 60000 }],
              categoryRevenueBreakdown: [{ name: "Abstract", count: 70000 }, { name: "Backgrounds", count: 80000 }],
              typeRevenueBreakdown: [{ name: "Commercial", count: 110000 }, { name: "Editorial", count: 40000 }],
              revenueCurrencyBreakdown: [{
                currency: "INR",
                total: 120000,
                collections: [{ name: "Photos", count: 90000 }],
                categories: [{ name: "Abstract", count: 70000 }],
                type: [{ name: "Commercial", count: 110000 }]
              }, {
                currency: "EUR",
                total: 30000,
                collections: [{ name: "Videos", count: 60000 }],
                categories: [{ name: "Backgrounds", count: 80000 }],
                type: [{ name: "Editorial", count: 40000 }]
              }],
              discountCurrencyBreakdown: [{
                currency: "INR",
                total: 2.36,
                collections: [{ name: "Photos", count: 2.36 }],
                categories: [{ name: "Abstract", count: 2.36 }],
                type: [{ name: "Commercial", count: 2.36 }]
              }, {
                currency: "USD",
                total: 6.44,
                collections: [{ name: "Psd", count: 6.44 }],
                categories: [{ name: "Animals", count: 6.44 }],
                type: [{ name: "Editorial", count: 6.44 }]
              }],
              earningsCurrencyBreakdown: [{
                currency: "INR",
                total: 4,
                collections: [{ name: "Photos", count: 4 }],
                categories: [{ name: "Interior", count: 4 }],
                type: [{ name: "Editorial", count: 4 }]
              }, {
                currency: "USD",
                total: 3.30,
                collections: [{ name: "Photos", count: 3.30 }],
                categories: [{ name: "Abstract", count: 3 }, { name: "Backgrounds", count: 0.30 }],
                type: [{ name: "Commercial", count: 3.30 }]
              }]
            }
          }
        });
      }
      if (url.includes("/admin/categories")) {
        return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      }
      if (url.includes("/admin/collections")) {
        return Promise.resolve({ data: [{ id: 1, name: "Nature" }] });
      }
      return Promise.resolve({ data: [{ id: 1, title: "Live asset", status: "approved", filename: "asset.jpg", category: "Images", keywords: "", description: "", type: "image" }] });
    });

    render(<AdminPanel />);

    fireEvent.click(screen.getByRole("button", { name: /preview daily report/i }));

    expect(await screen.findByText(/website analytics preview/i)).toBeInTheDocument();
    expect(await screen.findByText(/^revenue$/i)).toBeInTheDocument();
    expect(screen.getAllByText(/currencies:/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/collections:/i).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/categories:/i).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/type:/i).length).toBeGreaterThanOrEqual(2);
    expect(await screen.findByText(/payment failed value/i)).toBeInTheDocument();
    expect(screen.getAllByText(/₹1,000/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/\$10/).length).toBeGreaterThan(0);
    expect(screen.getByText("Photos: ₹1,000.00")).toBeInTheDocument();
    expect(screen.getByText("Videos: $10.00")).toBeInTheDocument();
    expect(screen.getAllByText("INR: ₹1,250.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("USD: $10.00").length).toBeGreaterThan(0);
    expect(screen.getByText(/^discount$/i)).toBeInTheDocument();
    expect(screen.getAllByText("INR: ₹2.36").length).toBeGreaterThan(0);
    expect(screen.getAllByText("USD: $6.44").length).toBeGreaterThan(0);
    expect(screen.getByText("Photos: ₹2.36")).toBeInTheDocument();
    expect(screen.getByText("Psd: $6.44")).toBeInTheDocument();
    expect(screen.getByText(/^earnings$/i)).toBeInTheDocument();
    expect(screen.getAllByText("INR: ₹4.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("USD: $3.30").length).toBeGreaterThan(0);
    expect(screen.getByText("Interior: ₹4.00")).toBeInTheDocument();
    expect(screen.getByText("Backgrounds: $0.30")).toBeInTheDocument();
  });

  it("shows asset, order, and download preview cards as plain whole-number counts without currency or decimal noise", async () => {
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/email/daily-report-settings")) {
        return Promise.resolve({
          data: {
            ok: true,
            settings: {
              enabled: true,
              email: "admin@example.com",
              time: "09:00",
              metrics: {
                totalAssets: true,
                totalOrders: true,
                totalDownloads: true
              }
            }
          }
        });
      }
      if (url.includes("/admin/email/daily-report-preview")) {
        return Promise.resolve({
          data: {
            ok: true,
            summary: {
              totalAssets: 1250.5,
              totalOrders: 84.25,
              totalDownloads: 3210.8,
              collectionLiveAssets: [{ name: "Photos", count: 28 }],
              collectionTotalOrders: [{ name: "Photos", count: 4 }],
              collectionTotalDownloads: [{ name: "Photos", count: 8 }]
            }
          }
        });
      }
      if (url.includes("/admin/categories")) {
        return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      }
      if (url.includes("/admin/collections")) {
        return Promise.resolve({ data: [{ id: 1, name: "Nature" }] });
      }
      return Promise.resolve({ data: [{ id: 1, title: "Live asset", status: "approved", filename: "asset.jpg", category: "Images", keywords: "", description: "", type: "image" }] });
    });

    render(<AdminPanel />);

    fireEvent.click(screen.getByRole("button", { name: /preview daily report/i }));

    expect(await screen.findByText(/website analytics preview/i)).toBeInTheDocument();
    expect(await screen.findByText("1,251")).toBeInTheDocument();
    expect(await screen.findByText("84")).toBeInTheDocument();
    expect(await screen.findByText("3,211")).toBeInTheDocument();
    expect(screen.getByText("Photos: 28")).toBeInTheDocument();
    expect(screen.getByText("Photos: 4")).toBeInTheDocument();
    expect(screen.getByText("Photos: 8")).toBeInTheDocument();
    expect(screen.queryByText("Photos: ₹28.00")).not.toBeInTheDocument();
  });

  it("shows payment failure count breakdowns in the daily report preview", async () => {
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/email/daily-report-settings")) {
        return Promise.resolve({
          data: {
            ok: true,
            settings: {
              enabled: true,
              email: "admin@example.com",
              time: "09:00",
              metrics: { paymentFailedCount: true }
            }
          }
        });
      }
      if (url.includes("/admin/email/daily-report-preview")) {
        return Promise.resolve({
          data: {
            ok: true,
            summary: {
              paymentFailedCurrencyBreakdown: [{
                currency: "INR",
                total: 1250,
                collections: [{ name: "Photos", count: 1000 }],
                categories: [{ name: "Arts", count: 250 }],
                type: [{ name: "Commercial", count: 1250 }]
              }, {
                currency: "USD",
                total: 10,
                collections: [{ name: "Videos", count: 10 }],
                categories: [{ name: "Beauty", count: 10 }],
                type: [{ name: "Editorial", count: 10 }]
              }]
            }
          }
        });
      }
      if (url.includes("/admin/categories")) {
        return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      }
      if (url.includes("/admin/collections")) {
        return Promise.resolve({ data: [{ id: 1, name: "Nature" }] });
      }
      return Promise.resolve({ data: [{ id: 1, title: "Live asset", status: "approved", filename: "asset.jpg", category: "Images", keywords: "", description: "", type: "image" }] });
    });

    render(<AdminPanel />);

    fireEvent.click(screen.getByRole("button", { name: /preview daily report/i }));

    expect(await screen.findByText(/website analytics preview/i)).toBeInTheDocument();
    expect(screen.getByText(/payment failed value/i)).toBeInTheDocument();
    expect(screen.getAllByText("INR: ₹1,250.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("USD: $10.00").length).toBeGreaterThan(0);
    expect(screen.getByText("Photos: ₹1,000.00")).toBeInTheDocument();
    expect(screen.getByText("Videos: $10.00")).toBeInTheDocument();
  });

  it("shows the hero banner card with default, add image, and save actions", async () => {
    render(<AdminPanel />);

    expect(await screen.findByText(/hero banner image/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /default/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add image/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save hero banner/i })).toBeInTheDocument();
  });

  it("does not show contributor threshold controls in the controls tab", async () => {
    render(<AdminPanel />);

    expect(await screen.findByText(/manage categories/i)).toBeInTheDocument();
    expect(screen.queryByText(/contributor threshold/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add new threshold/i })).not.toBeInTheDocument();
  });

  it("saves the contributor commission and shows a success toast", async () => {
    const toastSuccessSpy = jest.spyOn(toast, "success");
    render(<AdminPanel />);

    expect(await screen.findByText(/contributor commission/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^commission$/i }));
    fireEvent.change(screen.getByRole("spinbutton", { name: /percentage/i }), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining("/admin/settings/contributor-commission"),
        { percentage: 5 },
        expect.objectContaining({ headers: expect.any(Object) })
      );
      expect(toastSuccessSpy).toHaveBeenCalledWith("Contributor commission saved successfully.");
    });

    toastSuccessSpy.mockRestore();
  });

  it("opens a popup when a payment gateway label is clicked", async () => {
    render(<AdminPanel />);

    expect(await screen.findByText(/payment gateway/i)).toBeInTheDocument();

    fireEvent.click(screen.getByText(/google pay/i));

    expect(await screen.findByRole("heading", { name: /google pay/i })).toBeInTheDocument();
    expect(screen.getByText(/currently active/i)).toBeInTheDocument();
  });

  it("saves a Google Pay ID from the popup", async () => {
    render(<AdminPanel />);

    fireEvent.click(await screen.findByText(/google pay/i));

    fireEvent.change(screen.getByPlaceholderText(/enter google pay id/i), { target: { value: "gpay-123" } });
    fireEvent.click(screen.getByRole("button", { name: /save google pay id/i }));

    await waitFor(() => {
      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining("/admin/payment-settings"),
        expect.objectContaining({ gateway: "Google Pay", identifier: "gpay-123" }),
        expect.anything()
      );
    });
  });

  it("offers both IMAP and POP options in the email configuration modal", async () => {
    render(<AdminPanel />);

    fireEvent.click(screen.getByRole("button", { name: /email configuration/i }));

    const protocolSelect = await screen.findByLabelText(/incoming protocol/i);
    expect(protocolSelect).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /^imap$/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /^pop$/i })).toBeInTheDocument();
  });

  it("renders a live assets tab for approved assets", async () => {
    useLocation.mockReturnValue({ search: "?tab=live-assets" });

    render(<AdminPanel />);

    expect(await screen.findAllByText(/live assets/i)).not.toHaveLength(0);
    expect(screen.getAllByText(/live asset/i).length).toBeGreaterThan(0);
  });

  it("shows contributor username on each asset card", async () => {
    useLocation.mockReturnValue({ search: "?tab=live-assets" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/images?limit=1000&page=1")) {
        return Promise.resolve({ data: { images: [{ id: 2, title: "Live asset", status: "approved" }] } });
      }
      if (url.includes("/admin/images")) {
        return Promise.resolve({
          data: [
            { id: 2, title: "Live asset", status: "approved", filename: "live.jpg", category: "Images", keywords: "", description: "", type: "image", contributor_username: "alpha_uploader" }
          ]
        });
      }
      if (url.includes("/admin/categories")) {
        return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      }
      if (url.includes("/admin/collections")) {
        return Promise.resolve({ data: [] });
      }
      return Promise.resolve({ data: [] });
    });

    render(<AdminPanel />);

    expect(await screen.findByText(/Contributor: alpha_uploader/i)).toBeInTheDocument();
  });

  it("toggles individual live asset checkboxes from the Select button", async () => {
    useLocation.mockReturnValue({ search: "?tab=live-assets" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/images?limit=1000&page=1")) {
        return Promise.resolve({ data: { images: [{ id: 2, title: "Live asset", status: "approved" }] } });
      }
      if (url.includes("/admin/images")) {
        return Promise.resolve({
          data: [
            { id: 2, title: "Live asset", status: "approved", filename: "live.jpg", category: "Images", keywords: "", description: "", type: "image" }
          ]
        });
      }
      if (url.includes("/admin/categories")) {
        return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      }
      if (url.includes("/admin/collections")) {
        return Promise.resolve({ data: [] });
      }
      return Promise.resolve({ data: [] });
    });

    render(<AdminPanel />);

    const selectButton = await screen.findByRole("button", { name: "Select" });
    expect(screen.queryByRole("checkbox", { name: "Select Live asset" })).not.toBeInTheDocument();
    fireEvent.click(selectButton);

    const assetCheckbox = await screen.findByRole("checkbox", { name: "Select Live asset" });
    expect(assetCheckbox.closest("label")).toHaveStyle({
      position: "absolute",
      top: "12px",
      right: "12px"
    });
    expect(screen.getByText("0 selected")).toBeInTheDocument();
    fireEvent.click(assetCheckbox);
    expect(screen.getByText("1 selected")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("checkbox", { name: "Select Live asset" })).not.toBeInTheDocument();
  });

  it("shows bulk status and delete actions after selecting at least two live assets", async () => {
    useLocation.mockReturnValue({ search: "?tab=live-assets" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/images?limit=1000&page=1")) {
        return Promise.resolve({ data: { images: [{ id: 2, title: "Live asset A", status: "approved" }, { id: 3, title: "Live asset B", status: "approved" }] } });
      }
      if (url.includes("/admin/images")) {
        return Promise.resolve({
          data: [
            { id: 2, title: "Live asset A", status: "approved", filename: "live-a.jpg", category: "Images", keywords: "", description: "", type: "image" },
            { id: 3, title: "Live asset B", status: "approved", filename: "live-b.jpg", category: "Images", keywords: "", description: "", type: "image" }
          ]
        });
      }
      if (url.includes("/admin/categories")) {
        return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      }
      if (url.includes("/admin/collections")) {
        return Promise.resolve({ data: [] });
      }
      return Promise.resolve({ data: [] });
    });
    axios.put.mockResolvedValue({ data: { success: true } });
    axios.delete.mockResolvedValue({ data: { success: true } });
    const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);

    try {
      render(<AdminPanel />);
      fireEvent.click(await screen.findByRole("button", { name: "Select" }));

      const selectBothAssets = async () => {
        fireEvent.click(await screen.findByRole("checkbox", { name: "Select Live asset A" }));
        fireEvent.click(screen.getByRole("checkbox", { name: "Select Live asset B" }));
      };

      fireEvent.click(await screen.findByRole("checkbox", { name: "Select Live asset A" }));
      expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("checkbox", { name: "Select Live asset B" }));
      expect(await screen.findByRole("button", { name: "Approve" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Approve" }));
      await waitFor(() => {
        expect(axios.put).toHaveBeenCalledWith(expect.stringContaining("/admin/approve/2"), {}, expect.anything());
        expect(axios.put).toHaveBeenCalledWith(expect.stringContaining("/admin/approve/3"), {}, expect.anything());
      });
      await waitFor(() => expect(screen.getByText("0 selected")).toBeInTheDocument());

      await selectBothAssets();
      fireEvent.click(screen.getByRole("button", { name: "Reject" }));
      await waitFor(() => {
        expect(axios.put).toHaveBeenCalledWith(expect.stringContaining("/admin/reject/2"), {}, expect.anything());
        expect(axios.put).toHaveBeenCalledWith(expect.stringContaining("/admin/reject/3"), {}, expect.anything());
      });
      await waitFor(() => expect(screen.getByText("0 selected")).toBeInTheDocument());

      await selectBothAssets();
      fireEvent.click(screen.getByRole("button", { name: "Delete" }));
      await waitFor(() => {
        expect(confirmSpy).toHaveBeenCalledTimes(1);
        expect(axios.delete).toHaveBeenCalledWith(expect.stringContaining("/images/2"), expect.anything());
        expect(axios.delete).toHaveBeenCalledWith(expect.stringContaining("/images/3"), expect.anything());
      });
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it("offers the same bulk selection actions in the rejected assets view", async () => {
    useLocation.mockReturnValue({ search: "?status=rejected" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/images")) {
        return Promise.resolve({
          data: [
            { id: 4, title: "Rejected asset A", status: "rejected", filename: "rejected-a.jpg", category: "Images", keywords: "", description: "", type: "image" },
            { id: 5, title: "Rejected asset B", status: "rejected", filename: "rejected-b.jpg", category: "Images", keywords: "", description: "", type: "image" }
          ]
        });
      }
      if (url.includes("/admin/categories")) {
        return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      }
      if (url.includes("/admin/collections")) {
        return Promise.resolve({ data: [] });
      }
      return Promise.resolve({ data: [] });
    });
    axios.put.mockResolvedValue({ data: { success: true } });

    render(<AdminPanel />);
    const rejectedHeading = await screen.findByRole("heading", { name: "Rejected Panel" });
    expect(document.querySelector(".admin-asset-count").parentElement).toHaveTextContent("Total Assets:");
    const selectButton = screen.getByRole("button", { name: "Select" });
    expect(rejectedHeading.parentElement).toContainElement(selectButton);
    expect(rejectedHeading.parentElement).toHaveStyle({ justifyContent: "space-between" });
    fireEvent.click(selectButton);
    fireEvent.click(await screen.findByRole("checkbox", { name: "Select Rejected asset A" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Rejected asset B" }));

    expect(await screen.findByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
    expect(rejectedHeading.parentElement).toContainElement(screen.getByRole("button", { name: "Approve" }));

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => {
      expect(axios.put).toHaveBeenCalledWith(
        expect.stringContaining("/admin/approve/4"),
        {},
        expect.anything()
      );
      expect(axios.put).toHaveBeenCalledWith(
        expect.stringContaining("/admin/approve/5"),
        {},
        expect.anything()
      );
    });
  });

  it("offers the same bulk selection actions in the pending assets view", async () => {
    useLocation.mockReturnValue({ search: "?status=pending" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/images")) {
        return Promise.resolve({
          data: [
            { id: 6, title: "Pending asset A", status: "pending", filename: "pending-a.jpg", category: "Images", keywords: "", description: "", type: "image" },
            { id: 7, title: "Pending asset B", status: "pending", filename: "pending-b.jpg", category: "Images", keywords: "", description: "", type: "image" }
          ]
        });
      }
      if (url.includes("/admin/categories")) {
        return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      }
      if (url.includes("/admin/collections")) {
        return Promise.resolve({ data: [] });
      }
      return Promise.resolve({ data: [] });
    });
    axios.put.mockResolvedValue({ data: { success: true } });

    render(<AdminPanel />);
    expect(await screen.findByRole("heading", { name: "Pending Panel" })).toBeInTheDocument();
    const totalAssetsCount = document.querySelector(".admin-asset-count");
    expect(totalAssetsCount).toHaveClass("admin-asset-count");
    expect(totalAssetsCount.parentElement).toHaveTextContent("Total Assets:");
    expect(totalAssetsCount).toHaveTextContent("0");
    await waitFor(() => expect(totalAssetsCount).toHaveTextContent("2"), { timeout: 3000 });
    const pendingHeading = await screen.findByRole("heading", { name: "Pending Panel" });
    const selectButton = screen.getByRole("button", { name: "Select" });
    expect(pendingHeading.parentElement).toContainElement(selectButton);
    expect(pendingHeading.parentElement).toHaveStyle({ justifyContent: "space-between" });
    fireEvent.click(selectButton);
    fireEvent.click(await screen.findByRole("checkbox", { name: "Select Pending asset A" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Pending asset B" }));

    expect(await screen.findByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
    expect(pendingHeading.parentElement).toContainElement(screen.getByRole("button", { name: "Approve" }));

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => {
      expect(axios.put).toHaveBeenCalledWith(
        expect.stringContaining("/admin/approve/6"),
        {},
        expect.anything()
      );
      expect(axios.put).toHaveBeenCalledWith(
        expect.stringContaining("/admin/approve/7"),
        {},
        expect.anything()
      );
    });
  });

  it("offers the same bulk selection actions in the approved assets view", async () => {
    useLocation.mockReturnValue({ search: "?status=approved" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/images")) {
        return Promise.resolve({
          data: [
            { id: 8, title: "Approved asset A", status: "approved", filename: "approved-a.jpg", category: "Images", keywords: "", description: "", type: "image" },
            { id: 9, title: "Approved asset B", status: "approved", filename: "approved-b.jpg", category: "Images", keywords: "", description: "", type: "image" }
          ]
        });
      }
      if (url.includes("/admin/categories")) {
        return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      }
      if (url.includes("/admin/collections")) {
        return Promise.resolve({ data: [] });
      }
      return Promise.resolve({ data: [] });
    });
    axios.put.mockResolvedValue({ data: { success: true } });

    render(<AdminPanel />);
    const approvedHeading = await screen.findByRole("heading", { name: "Approved Panel" });
    expect(document.querySelector(".admin-asset-count").parentElement).toHaveTextContent("Total Assets:");
    const selectButton = screen.getByRole("button", { name: "Select" });
    expect(approvedHeading.parentElement).toContainElement(selectButton);
    expect(approvedHeading.parentElement).toHaveStyle({ justifyContent: "space-between" });
    fireEvent.click(selectButton);
    fireEvent.click(await screen.findByRole("checkbox", { name: "Select Approved asset A" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Approved asset B" }));

    expect(await screen.findByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
    expect(approvedHeading.parentElement).toContainElement(screen.getByRole("button", { name: "Approve" }));

    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    await waitFor(() => {
      expect(axios.put).toHaveBeenCalledWith(
        expect.stringContaining("/admin/reject/8"),
        {},
        expect.anything()
      );
      expect(axios.put).toHaveBeenCalledWith(
        expect.stringContaining("/admin/reject/9"),
        {},
        expect.anything()
      );
    });
  });

  it("clears selected assets when changing pages", async () => {
    useLocation.mockReturnValue({ search: "?status=pending" });
    const pendingAssets = [
      { id: 10, title: "Pending asset A", status: "pending", filename: "pending-a.jpg", category: "Images", keywords: "", description: "", type: "image" },
      { id: 11, title: "Pending asset B", status: "pending", filename: "pending-b.jpg", category: "Images", keywords: "", description: "", type: "image" },
      ...Array.from({ length: 19 }, (_, index) => ({
        id: 12 + index,
        title: `Pending asset ${index + 3}`,
        status: "pending",
        filename: `pending-${index + 3}.jpg`,
        category: "Images",
        keywords: "",
        description: "",
        type: "image"
      }))
    ];
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/images")) {
        return Promise.resolve({ data: pendingAssets });
      }
      if (url.includes("/admin/categories")) {
        return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      }
      if (url.includes("/admin/collections")) {
        return Promise.resolve({ data: [] });
      }
      return Promise.resolve({ data: [] });
    });

    render(<AdminPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Select" }));
    const firstAssetCheckbox = await screen.findByRole("checkbox", { name: "Select Pending asset A" });
    fireEvent.click(firstAssetCheckbox);
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Pending asset B" }));
    expect(await screen.findByText("2 selected")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));

    await waitFor(() => expect(screen.getByText("0 selected")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reject" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("exits selection mode when switching asset status views", async () => {
    useLocation.mockReturnValue({ search: "?status=approved" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/images")) {
        return Promise.resolve({
          data: [
            { id: 30, title: "Approved selection asset A", status: "approved", filename: "approved-a.jpg", category: "Images", keywords: "", description: "", type: "image" },
            { id: 31, title: "Approved selection asset B", status: "approved", filename: "approved-b.jpg", category: "Images", keywords: "", description: "", type: "image" },
            { id: 32, title: "Approved selection asset C", status: "approved", filename: "approved-c.jpg", category: "Images", keywords: "", description: "", type: "image" },
            { id: 33, title: "Rejected destination asset", status: "rejected", filename: "rejected.jpg", category: "Images", keywords: "", description: "", type: "image" }
          ]
        });
      }
      if (url.includes("/admin/categories")) {
        return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      }
      if (url.includes("/admin/collections")) {
        return Promise.resolve({ data: [] });
      }
      return Promise.resolve({ data: [] });
    });

    const { rerender } = render(<AdminPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Select" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "Select Approved selection asset A" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Approved selection asset B" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Approved selection asset C" }));
    expect(await screen.findByText("3 selected")).toBeInTheDocument();

    useLocation.mockReturnValue({ search: "?status=rejected" });
    rerender(<AdminPanel />);

    expect(await screen.findByRole("button", { name: "Select" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Done" })).not.toBeInTheDocument();
    expect(screen.queryByText("3 selected")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Select Rejected destination asset" })).not.toBeInTheDocument();
  });

  it("shows approved and rejected assets reviewed within the last 30 days", async () => {
    useLocation.mockReturnValue({ search: "?status=reviewed" });
    const now = Date.now();
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/images")) {
        return Promise.resolve({
          data: [
            { id: 40, title: "Recently approved", status: "approved", contributor_username: "approved_contributor", reviewed_at: new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString() },
            { id: 41, title: "Recently rejected", status: "rejected", contributor_username: "rejected_contributor", reviewed_at: new Date(now - 29 * 24 * 60 * 60 * 1000).toISOString() },
            { id: 42, title: "Old approval", status: "approved", reviewed_at: new Date(now - 31 * 24 * 60 * 60 * 1000).toISOString() },
            { id: 43, title: "Still pending", status: "pending", reviewed_at: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString() }
          ]
        });
      }
      if (url.includes("/admin/categories")) {
        return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      }
      if (url.includes("/admin/collections")) {
        return Promise.resolve({ data: [] });
      }
      return Promise.resolve({ data: [] });
    });

    render(<AdminPanel />);

    expect(await screen.findByRole("heading", { name: "Reviewed Panel" })).toBeInTheDocument();
    expect(await screen.findByText("Title: Recently approved")).toBeInTheDocument();
    expect(screen.getByText("Title: Recently rejected")).toBeInTheDocument();
    const reviewedAssetCount = document.querySelector(".admin-asset-count");
    expect(reviewedAssetCount.parentElement).toHaveTextContent("Total Assets:");
    expect(reviewedAssetCount).toHaveTextContent("0");
    await waitFor(() => expect(reviewedAssetCount).toHaveTextContent("2"), { timeout: 3000 });
    expect(screen.getByText("Contributor: approved_contributor")).toBeInTheDocument();
    expect(screen.getByText("Contributor: rejected_contributor")).toBeInTheDocument();
    expect(screen.getByText("Status: Approved")).toBeInTheDocument();
    expect(screen.getByText("Status: Rejected")).toBeInTheDocument();
    expect(screen.getByText(`Approved on: ${new Date(now - 10 * 24 * 60 * 60 * 1000).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })}`)).toBeInTheDocument();
    expect(screen.getByText(`Rejected on: ${new Date(now - 29 * 24 * 60 * 60 * 1000).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })}`)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Recently approved thumbnail/ })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Recently rejected thumbnail/ })).toBeInTheDocument();
    expect(screen.queryByText("Title: Old approval")).not.toBeInTheDocument();
    expect(screen.queryByText("Title: Still pending")).not.toBeInTheDocument();
  });

  it("shows all asset statuses when the All filter is selected", async () => {
    useLocation.mockReturnValue({ search: "" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/images")) {
        return Promise.resolve({
          data: [
            { id: 1, title: "Pending asset", status: "pending", filename: "pending.jpg", category: "Images", keywords: "", description: "", type: "image" },
            { id: 2, title: "Approved asset", status: "approved", filename: "approved.jpg", category: "Images", keywords: "", description: "", type: "image" },
            { id: 3, title: "Rejected asset", status: "rejected", filename: "rejected.jpg", category: "Images", keywords: "", description: "", type: "image" }
          ]
        });
      }
      if (url.includes("/admin/categories")) {
        return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      }
      if (url.includes("/admin/collections")) {
        return Promise.resolve({ data: [] });
      }
      return Promise.resolve({ data: [] });
    });

    render(<AdminPanel />);

    expect(await screen.findByRole("heading", { name: "All Assets" })).toBeInTheDocument();
    expect(document.querySelector(".admin-asset-count").parentElement).toHaveTextContent("Total Assets:");
    expect(await screen.findByText(/pending asset/i)).toBeInTheDocument();
    expect(screen.getByText(/approved asset/i)).toBeInTheDocument();
    expect(screen.getByText(/rejected asset/i)).toBeInTheDocument();
  });

  it("downloads the generated preview when no legacy thumbnail URL is present", async () => {
    useLocation.mockReturnValue({ search: "?status=pending" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/api/assets/1/thumbnail")) {
        return Promise.resolve({
          data: new Blob(["thumbnail"], { type: "image/webp" }),
          headers: { "content-type": "image/webp" }
        });
      }
      if (url.includes("/admin/images")) {
        return Promise.resolve({
          data: [
            { id: 1, title: "Pending asset", status: "pending", filename: "pending.jpg", category: "Images", keywords: "", description: "", type: "commercial", thumbnail_generated_at: "2026-10-04T00:00:00.000Z" }
          ]
        });
      }
      if (url.includes("/admin/categories")) {
        return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      }
      if (url.includes("/admin/collections")) {
        return Promise.resolve({ data: [] });
      }
      return Promise.resolve({ data: [] });
    });
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    URL.createObjectURL = jest.fn(() => "blob:download-thumbnail");
    URL.revokeObjectURL = jest.fn();

    let unmount;
    try {
      ({ unmount } = render(<AdminPanel />));
      fireEvent.click(await screen.findByTitle("Download Thumbnail"));

      await waitFor(() => {
        expect(axios.get).toHaveBeenCalledWith(
          expect.stringContaining("/api/assets/1/thumbnail"),
          expect.objectContaining({ responseType: "blob" })
        );
        expect(clickSpy).toHaveBeenCalled();
      });
      expect(clickSpy.mock.instances[0]).toHaveAttribute("download", "pending.webp");
    } finally {
      unmount?.();
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
      clickSpy.mockRestore();
    }
  });

  it("shows a success toast after saving edited asset details", async () => {
    useLocation.mockReturnValue({ search: "?status=pending" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/images")) {
        return Promise.resolve({
          data: [
            { id: 1, title: "Pending asset", status: "pending", filename: "pending.jpg", category: "Images", keywords: "", description: "", type: "commercial" }
          ]
        });
      }
      if (url.includes("/admin/categories")) {
        return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      }
      if (url.includes("/admin/collections")) {
        return Promise.resolve({ data: [] });
      }
      return Promise.resolve({ data: [] });
    });
    axios.put.mockResolvedValue({ data: { id: 1, title: "Updated asset" } });
    const successToast = jest.spyOn(toast, "success");

    render(<AdminPanel />);

    fireEvent.click((await screen.findAllByRole("button", { name: /^edit$/i }))[0]);
    fireEvent.change(screen.getByRole("textbox", { name: /title/i }), {
      target: { value: "Updated asset" }
    });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(axios.put).toHaveBeenCalledWith(
        expect.stringContaining("/images/1"),
        expect.objectContaining({ title: "Updated asset" }),
        expect.anything()
      );
      expect(successToast).toHaveBeenCalledWith("Asset details saved successfully.");
    });

    successToast.mockRestore();
  });

  it("loads assets from the admin endpoint for the All view", async () => {
    useLocation.mockReturnValue({ search: "" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/images")) {
        return Promise.resolve({ data: [{ id: 1, title: "Visible asset", status: "approved", filename: "asset.jpg", category: "Images", keywords: "", description: "", type: "image" }] });
      }
      if (url.includes("/admin/categories")) {
        return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      }
      if (url.includes("/admin/collections")) {
        return Promise.resolve({ data: [] });
      }
      return Promise.resolve({ data: [] });
    });

    render(<AdminPanel />);

    await waitFor(() => {
      expect(axios.get).toHaveBeenCalledWith(expect.stringContaining("/admin/images"), expect.anything());
    });
  });

  it("shows the Live badge only for assets that are currently on the public site", async () => {
    useLocation.mockReturnValue({ search: "" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/images?limit=1000&page=1")) {
        return Promise.resolve({ data: { images: [{ id: 2, title: "Live asset", status: "approved" }] } });
      }
      if (url.includes("/admin/images")) {
        return Promise.resolve({ data: [
          { id: 1, title: "Hidden asset", status: "approved", filename: "hidden.jpg", category: "Images", keywords: "", description: "", type: "image" },
          { id: 2, title: "Live asset", status: "approved", filename: "live.jpg", category: "Images", keywords: "", description: "", type: "image" }
        ] });
      }
      if (url.includes("/admin/categories")) {
        return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      }
      if (url.includes("/admin/collections")) {
        return Promise.resolve({ data: [] });
      }
      return Promise.resolve({ data: [] });
    });

    render(<AdminPanel />);

    expect(await screen.findByText(/live asset/i)).toBeInTheDocument();
    expect(screen.getByText((content, element) => element?.textContent === "Live" && element.tagName.toLowerCase() === "div")).toBeInTheDocument();
    expect(screen.getByText(/hidden asset/i)).toBeInTheDocument();
  });

  it("exports all live, pending, and rejected assets in the CSV", async () => {
    useLocation.mockReturnValue({ search: "?tab=live-assets" });
    const originalCreateObjectURL = URL.createObjectURL;
    const originalBlob = global.Blob;
    const createObjectURLMock = jest.fn(() => "blob:test");
    URL.createObjectURL = createObjectURLMock;
    global.Blob = jest.fn((parts) => ({
      text: jest.fn().mockResolvedValue(Array.isArray(parts) ? parts.join("") : String(parts))
    }));
    const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    axios.get.mockImplementation((url) => {
      if (url.includes("/images?limit=1000&page=1")) {
        return Promise.resolve({ data: { images: [{ id: 2, title: "Live asset", status: "approved" }] } });
      }
      if (url.includes("/admin/images")) {
        return Promise.resolve({
          data: [
            { id: 1, title: "Pending asset", status: "pending", filename: "pending.jpg", category: "Images", keywords: "", description: "", type: "image" },
            { id: 2, title: "Live asset", status: "approved", filename: "live.jpg", category: "Images", keywords: "", description: "", type: "image" },
            { id: 3, title: "Rejected asset", status: "rejected", filename: "rejected.jpg", category: "Images", keywords: "", description: "", type: "image" }
          ]
        });
      }
      if (url.includes("/admin/categories")) {
        return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      }
      if (url.includes("/admin/collections")) {
        return Promise.resolve({ data: [] });
      }
      return Promise.resolve({ data: [] });
    });

    render(<AdminPanel />);

    fireEvent.click(await screen.findByRole("button", { name: /export csv/i }));

    await waitFor(() => {
      expect(createObjectURLMock).toHaveBeenCalled();
      expect(clickSpy).toHaveBeenCalled();
    });

    const blobArg = createObjectURLMock.mock.calls[0][0];
    const csvText = await blobArg.text();
    expect(csvText).toContain("Pending asset");
    expect(csvText).toContain("Live asset");
    expect(csvText).toContain("Rejected asset");

    URL.createObjectURL = originalCreateObjectURL;
    global.Blob = originalBlob;
    clickSpy.mockRestore();
  });

  it("shows upload-style editing fields and sends collection updates", async () => {
    useLocation.mockReturnValue({ search: "?tab=live-assets" });
    axios.put.mockResolvedValue({ data: { id: 1, title: "Live asset", status: "approved", filename: "asset.jpg", category: "Images", collection: "Nature", keywords: "", description: "", type: "image" } });
    const dispatchSpy = jest.spyOn(window, "dispatchEvent");

    render(<AdminPanel />);

    fireEvent.click(await screen.findByRole("button", { name: /edit/i }));

    expect(screen.getByRole("combobox", { name: /select primary category/i })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /select optional category/i })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /collection/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /nature/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(axios.put).toHaveBeenCalledWith(
        expect.stringContaining("/images/1"),
        expect.objectContaining({ collection: expect.any(String) }),
        expect.anything()
      );
    });

    await waitFor(() => {
      expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ type: "asset-collections-updated" }));
    });

    await waitFor(() => {
      expect(screen.queryByText(/title \(max 5 words\)/i)).not.toBeInTheDocument();
    });

    dispatchSpy.mockRestore();
  });

  it("shows a success toast and preserves counts after saving a collection rename", async () => {
    useLocation.mockReturnValue({ search: "?tab=controls" });
    const dispatchSpy = jest.spyOn(window, "dispatchEvent");
    const successToast = jest.spyOn(toast, "success");
    let savedCollectionName = "Nature";
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/categories")) return Promise.resolve({ data: [] });
      if (url.includes("/admin/collections")) return Promise.resolve({ data: [{ id: 1, name: savedCollectionName, asset_count: 31, live_asset_count: 25 }] });
      return Promise.resolve({ data: [] });
    });
    axios.put.mockImplementation((url) => {
      if (url.includes("/admin/collections/")) {
        savedCollectionName = "Forest";
        return Promise.resolve({ data: { id: 1, name: "Forest" } });
      }
      return Promise.resolve({ data: { id: 1, title: "Live asset", status: "approved", filename: "asset.jpg", category: "Images", collection: "Nature", keywords: "", description: "", type: "image" } });
    });

    render(<AdminPanel />);

    const collectionsCard = (await screen.findByRole("heading", { name: /active collections/i })).closest(".admin-panel-card");
    fireEvent.click(within(collectionsCard).getByRole("button", { name: /view collections/i }));
    const collectionsHeading = await screen.findByRole("heading", { name: "Collections", exact: true });
    const collectionsPanel = collectionsHeading.parentElement.parentElement;
    fireEvent.click(within(collectionsPanel).getByRole("button", { name: /modify/i }));
    fireEvent.change(screen.getByRole("textbox", { name: /collection name/i }), { target: { value: "Forest" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ type: "asset-refresh" }));
      expect(successToast).toHaveBeenCalledWith("Collection saved successfully.");
    });
    expect(await screen.findByText("Forest")).toBeInTheDocument();
    expect(screen.getByText("31 total assets")).toBeInTheDocument();
    expect(screen.getByText("25 live assets")).toBeInTheDocument();

    dispatchSpy.mockRestore();
    successToast.mockRestore();
  });

  it("opens the Email Analytics modal when the Email Analytics button is clicked", async () => {
    useLocation.mockReturnValue({ search: "?tab=controls" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/categories")) {
        return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      }
      if (url.includes("/admin/collections")) {
        return Promise.resolve({ data: [{ id: 1, name: "Nature" }] });
      }
      if (url.includes("/admin/email/analytics")) {
        return Promise.resolve({ data: {
          totals: { sent: 1, delivered: 1, opened: 0, clicked: 0 },
          daily: [],
          range: '7d'
        } });
      }
      return Promise.resolve({ data: [{ id: 1, title: "Live asset", status: "approved", filename: "asset.jpg", category: "Images", keywords: "", description: "", type: "image" }] });
    });

    render(<AdminPanel />);

    const analyticsButton = await screen.findByRole("button", { name: /email analytics/i });
    expect(analyticsButton).toBeInTheDocument();

    fireEvent.click(analyticsButton);

    expect(await screen.findByRole('heading', { name: /email analytics/i })).toBeInTheDocument();
    expect(screen.getByText(/track delivery performance/i)).toBeInTheDocument();
  });

  it("opens Pricing modal and fetches pricing settings", async () => {
    useLocation.mockReturnValue({ search: "?tab=controls" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/settings/pricing")) {
        return Promise.resolve({ data: { enable_global_minimum_pricing: true } });
      }
      if (url.includes("/admin/categories")) return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      if (url.includes("/admin/collections")) return Promise.resolve({ data: [{ id: 1, name: "Nature" }] });
      return Promise.resolve({ data: [] });
    });

    render(<AdminPanel />);

    const btn = await screen.findByRole('button', { name: /open pricing settings/i });
    fireEvent.click(btn);

    await waitFor(() => {
      expect(axios.get).toHaveBeenCalledWith(expect.stringContaining('/admin/settings/pricing'), expect.anything());
    });
  });

  it("adds a new custom currency row from the pricing modal", async () => {
    useLocation.mockReturnValue({ search: "?tab=controls" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/settings/pricing")) {
        return Promise.resolve({ data: { enable_global_minimum_pricing: true, inr_amount: 199, usd_amount: 10, eur_amount: 9 } });
      }
      if (url.includes("/admin/categories")) return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      if (url.includes("/admin/collections")) return Promise.resolve({ data: [{ id: 1, name: "Nature" }] });
      return Promise.resolve({ data: [] });
    });

    render(<AdminPanel />);

    fireEvent.click(await screen.findByRole('button', { name: /open pricing settings/i }));

    fireEvent.click(screen.getByRole('button', { name: /add new currency/i }));

    expect(screen.getAllByRole('combobox', { name: /currency/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('spinbutton', { name: /amount/i }).length).toBeGreaterThan(0);
  });

  it("keeps a fixed tax value when switching that row to percentage", async () => {
    useLocation.mockReturnValue({ search: "?tab=controls" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/settings/pricing")) {
        return Promise.resolve({ data: {
          enable_global_minimum_pricing: true,
          tax_settings: [
            { id: 1, label: "Education Tax", enabled: true, type: "fixed", rate: 0, amount: 5 },
            { id: 2, label: "GST", enabled: true, type: "percentage", rate: 18, amount: 0 }
          ]
        } });
      }
      if (url.includes("/admin/categories")) return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      if (url.includes("/admin/collections")) return Promise.resolve({ data: [{ id: 1, name: "Nature" }] });
      return Promise.resolve({ data: [] });
    });

    render(<AdminPanel />);

    fireEvent.click(await screen.findByRole('button', { name: /open pricing settings/i }));

    const taxSelects = Array.from(document.querySelectorAll('select')).filter((el) =>
      Array.from(el.options).some((option) => option.value === 'percentage' || option.value === 'fixed')
    );
    const firstTaxType = taxSelects[0];
    const firstNumberInput = document.querySelectorAll('input[type="number"]')[0];

    expect(firstTaxType.value).toBe('fixed');
    expect(firstNumberInput.value).toBe('5');

    fireEvent.change(firstTaxType, { target: { value: 'percentage' } });

    expect(firstTaxType.value).toBe('percentage');
    expect(document.querySelectorAll('input[type="number"]')[0].value).toBe('5');
  });

  it("opens Free Assets modal and fetches free asset settings", async () => {
    useLocation.mockReturnValue({ search: "?tab=controls" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/settings/free-assets")) {
        return Promise.resolve({ data: { enable_free_assets: false } });
      }
      if (url.includes("/admin/categories")) return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      if (url.includes("/admin/collections")) return Promise.resolve({ data: [{ id: 1, name: "Nature" }] });
      return Promise.resolve({ data: [] });
    });

    render(<AdminPanel />);

    const btn = await screen.findByRole('button', { name: /open free asset settings/i });
    fireEvent.click(btn);

    await waitFor(() => {
      expect(axios.get).toHaveBeenCalledWith(expect.stringContaining('/admin/settings/free-assets'), expect.anything());
    });
  });

  it("opens the Add New Subscription Plan popup", async () => {
    useLocation.mockReturnValue({ search: "?tab=controls" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/subscription-plans")) {
        return Promise.resolve({ data: [{ id: 1, name: 'Basic' }] });
      }
      if (url.includes("/admin/categories")) return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      if (url.includes("/admin/collections")) return Promise.resolve({ data: [{ id: 1, name: "Nature" }] });
      return Promise.resolve({ data: [] });
    });

    render(<AdminPanel />);

    const btn = await screen.findByRole('button', { name: /add new subscription plan/i });
    fireEvent.click(btn);

    expect(screen.getByText('Plan Name')).toBeInTheDocument();
    const duration = screen.getByRole('checkbox', { name: /limited time/i });
    fireEvent.click(duration);
    expect(screen.getByText('Start date')).toBeInTheDocument();
    expect(screen.getByText('End date')).toBeInTheDocument();
    expect(screen.getAllByText(/INR \(source\)/i).length).toBeGreaterThan(0);
    expect(screen.getByText('Downloads')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /recommended/i })).toBeInTheDocument();
  });

  it("links to the subscriber view page", async () => {
    useLocation.mockReturnValue({ search: "?tab=controls" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/categories")) return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      if (url.includes("/admin/collections")) return Promise.resolve({ data: [{ id: 1, name: "Nature" }] });
      return Promise.resolve({ data: [] });
    });

    render(<AdminPanel />);

    const link = await screen.findByRole('link', { name: /view subscribers/i });
    expect(link).toHaveAttribute('href', '/admin/subscribers');
    expect(screen.getByRole('link', { name: /view current plans/i })).toHaveAttribute('href', '/admin/current-plans');
  });

  it("opens Custom Subscriptions modal and fetches list", async () => {
    useLocation.mockReturnValue({ search: "?tab=controls" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/custom-subscriptions")) {
        return Promise.resolve({ data: [{ id: 1, customer_name: 'Acme' }] });
      }
      if (url.includes("/admin/categories")) return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      if (url.includes("/admin/collections")) return Promise.resolve({ data: [{ id: 1, name: "Nature" }] });
      return Promise.resolve({ data: [] });
    });

    render(<AdminPanel />);

    const btn = await screen.findByRole('button', { name: /open custom subscriptions/i });
    fireEvent.click(btn);

    await waitFor(() => {
      expect(axios.get).toHaveBeenCalledWith(expect.stringContaining('/admin/custom-subscriptions'), expect.anything());
    });
  });

  it("renders a dedicated promotions hub tab for marketing management", async () => {
    useLocation.mockReturnValue({ search: "?tab=promotions" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/promotions")) {
        return Promise.resolve({ data: { dashboard: { active_campaigns: 3, scheduled_campaigns: 2 }, coupons: [], campaigns: [], flash_sales: [], banners: [], analytics: {} } });
      }
      if (url.includes("/admin/categories")) {
        return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      }
      if (url.includes("/admin/collections")) {
        return Promise.resolve({ data: [{ id: 1, name: "Nature" }] });
      }
      return Promise.resolve({ data: [{ id: 1, title: "Live asset", status: "approved", filename: "asset.jpg", category: "Images", keywords: "", description: "", type: "image" }] });
    });

    render(<AdminPanel />);

    expect(await screen.findByText(/promotions hub/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /coupons/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^campaigns$/i })).toBeInTheDocument();
  });

  it("renders a users tab for admin user management", async () => {
    useLocation.mockReturnValue({ search: "?tab=users" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/users")) {
        return Promise.resolve({ data: [
          { id: 1, full_name: "Test User", username: "tester", email: "tester@example.com", role: "contributor", identity_number: "123", credits: 5, status: "pending" },
          { id: 2, full_name: "Inactive User", username: "inactive", email: "inactive@example.com", role: "contributor", identity_number: "456", credits: 0, status: "inactive" },
          { id: 3, full_name: "Blocked User", username: "blocked", email: "blocked@example.com", role: "contributor", identity_number: "789", credits: 0, status: "blocked" }
        ] });
      }
      if (url.includes("/admin/categories")) {
        return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      }
      if (url.includes("/admin/collections")) {
        return Promise.resolve({ data: [{ id: 1, name: "Nature" }] });
      }
      return Promise.resolve({ data: [{ id: 1, title: "Live asset", status: "approved", filename: "asset.jpg", category: "Images", keywords: "", description: "", type: "image" }] });
    });

    render(<AdminPanel />);

    expect(await screen.findByText(/user management/i)).toBeInTheDocument();
    expect(screen.getByText(/test user/i)).toBeInTheDocument();
    expect(screen.getByText(/inactive user/i)).toBeInTheDocument();
    expect(screen.getByText(/blocked user/i)).toBeInTheDocument();
    const userCount = document.querySelector(".admin-asset-count");
    expect(userCount).toBeInTheDocument();
    await waitFor(() => expect(userCount).toHaveTextContent("3"), { timeout: 3000 });

    const usersHeading = screen.getByRole("heading", { name: "Users" });
    const selectButton = screen.getByRole("button", { name: "Select" });
    expect(usersHeading.parentElement).toContainElement(selectButton);
    fireEvent.click(selectButton);
    const testUserCheckbox = screen.getByRole("checkbox", { name: "Select Test User" });
    expect(testUserCheckbox.closest("label")).toHaveStyle({ position: "absolute", top: "10px", right: "10px" });
    fireEvent.click(testUserCheckbox);
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Inactive User" }));
    expect(screen.getByText("2 selected")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("checkbox", { name: "Select Test User" })).not.toBeInTheDocument();
  });

  it("filters users by customer and contributor roles", async () => {
    useLocation.mockReturnValue({ search: "?tab=users" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/users")) {
        return Promise.resolve({ data: [
          { id: 31, full_name: "Customer Account", username: "customer-one", role: "customer", status: "active" },
          { id: 32, full_name: "Contributor Account", username: "contributor-one", role: "contributor", status: "active" },
          { id: 33, full_name: "Admin Account", username: "admin-one", role: "admin", status: "active" }
        ] });
      }
      if (url.includes("/admin/categories")) return Promise.resolve({ data: [] });
      if (url.includes("/admin/collections")) return Promise.resolve({ data: [] });
      return Promise.resolve({ data: [] });
    });

    render(<AdminPanel />);
    expect(await screen.findByText(/customer account/i)).toBeInTheDocument();
    expect(screen.getByText(/contributor account/i)).toBeInTheDocument();
    expect(screen.getByText(/admin account/i)).toBeInTheDocument();
    const roleFilterButtons = ["All", "Active", "Admin", "Blocked", "Contributor", "Customer", "Pending"]
      .map((name) => screen.getByRole("button", { name }));
    expect(roleFilterButtons.map((button) => button.textContent)).toEqual([
      "All", "Active", "Admin", "Blocked", "Contributor", "Customer", "Pending"
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Customer" }));
    expect(await screen.findByText(/customer account/i)).toBeInTheDocument();
    expect(screen.queryByText(/contributor account/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/admin account/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Contributor" }));
    expect(await screen.findByText(/contributor account/i)).toBeInTheDocument();
    expect(screen.queryByText(/customer account/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/admin account/i)).not.toBeInTheDocument();
  });

  it("searches users by username, email, full name, and ID", async () => {
    useLocation.mockReturnValue({ search: "?tab=users" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/users")) {
        return Promise.resolve({ data: [
          { id: 98765, full_name: "Jane Searchable", username: "findmeuser", email: "findme@example.com", role: "customer", status: "active" },
          { id: 54321, full_name: "Other Account", username: "otheruser", email: "other@example.com", role: "contributor", status: "active" }
        ] });
      }
      if (url.includes("/admin/categories")) return Promise.resolve({ data: [] });
      if (url.includes("/admin/collections")) return Promise.resolve({ data: [] });
      return Promise.resolve({ data: [] });
    });

    render(<AdminPanel />);
    const searchBox = await screen.findByRole("searchbox", { name: "Search users" });
    expect(screen.getByPlaceholderText("Search username, email, name, or ID")).toBe(searchBox);

    for (const query of ["findmeuser", "findme@example.com", "Jane Searchable", "98765", "#98765", "id: 98765", "ID 98765"]) {
      fireEvent.change(searchBox, { target: { value: query } });
      expect(await screen.findByText("Jane Searchable")).toBeInTheDocument();
      expect(screen.queryByText("Other Account")).not.toBeInTheDocument();
    }
  });

  it("offers bulk active, inactive, block and delete actions for selected users", async () => {
    useLocation.mockReturnValue({ search: "?tab=users" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/users")) {
        return Promise.resolve({ data: [
          { id: 21, full_name: "Bulk User A", username: "bulk-a", email: "bulk-a@example.com", role: "customer", status: "active" },
          { id: 22, full_name: "Bulk User B", username: "bulk-b", email: "bulk-b@example.com", role: "contributor", status: "pending" }
        ] });
      }
      if (url.includes("/admin/categories")) return Promise.resolve({ data: [] });
      if (url.includes("/admin/collections")) return Promise.resolve({ data: [] });
      return Promise.resolve({ data: [] });
    });
    axios.put.mockImplementation((url) => {
      const id = Number(url.match(/\/users\/(\d+)\//)?.[1]);
      return Promise.resolve({ data: { id, status: url.endsWith("/approve") ? "active" : url.endsWith("/deactivate") ? "inactive" : "blocked" } });
    });
    axios.delete.mockImplementation((url) => {
      const id = Number(url.match(/\/users\/(\d+)$/)?.[1]);
      return Promise.resolve({ status: 202, data: { user: { id, deletion_requested_at: new Date().toISOString() } } });
    });
    const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);

    try {
      render(<AdminPanel />);
      const selectBothUsers = () => {
        fireEvent.click(screen.getByRole("checkbox", { name: "Select Bulk User A" }));
        fireEvent.click(screen.getByRole("checkbox", { name: "Select Bulk User B" }));
      };
      const expectActionForBothUsers = async (action, endpoint) => {
        fireEvent.click(await screen.findByRole("button", { name: "Select" }));
        selectBothUsers();
        expect(await screen.findByRole("button", { name: "Set Active" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Set Inactive" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Block Selected" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Delete Selected" })).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: action }));
        await waitFor(() => {
          expect(axios.put).toHaveBeenCalledWith(
            expect.stringContaining(`/admin/users/21/${endpoint}`),
            {},
            expect.anything()
          );
          expect(axios.put).toHaveBeenCalledWith(
            expect.stringContaining(`/admin/users/22/${endpoint}`),
            {},
            expect.anything()
          );
        });
        await waitFor(() => {
          expect(screen.getByRole("button", { name: "Select" })).toBeInTheDocument();
          expect(screen.queryByRole("button", { name: "Set Active" })).not.toBeInTheDocument();
          expect(screen.queryByRole("button", { name: "Set Inactive" })).not.toBeInTheDocument();
          expect(screen.queryByRole("button", { name: "Block Selected" })).not.toBeInTheDocument();
          expect(screen.queryByRole("button", { name: "Delete Selected" })).not.toBeInTheDocument();
          expect(screen.queryByText(/selected$/)).not.toBeInTheDocument();
        });
      };

      await expectActionForBothUsers("Set Active", "approve");
      await expectActionForBothUsers("Set Inactive", "deactivate");
      await expectActionForBothUsers("Block Selected", "block");

      fireEvent.click(screen.getByRole("button", { name: "Select" }));
      selectBothUsers();
      fireEvent.click(await screen.findByRole("button", { name: "Delete Selected" }));
      await waitFor(() => {
        expect(confirmSpy).toHaveBeenCalledTimes(1);
        expect(axios.delete).toHaveBeenCalledWith(expect.stringContaining("/admin/users/21"), expect.anything());
        expect(axios.delete).toHaveBeenCalledWith(expect.stringContaining("/admin/users/22"), expect.anything());
        expect(screen.getByRole("button", { name: "Select" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Delete Selected" })).not.toBeInTheDocument();
      });
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it("uses dark-neutral panel styling in the users tab when dark mode is active", async () => {
    document.body.classList.add("dark-mode");
    useLocation.mockReturnValue({ search: "?tab=users" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/users")) {
        return Promise.resolve({ data: [{ id: 1, full_name: "Dark User", username: "darkuser", email: "dark@example.com", role: "customer", identity_number: "101", credits: 5, status: "active" }] });
      }
      if (url.includes("/admin/categories")) {
        return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      }
      if (url.includes("/admin/collections")) {
        return Promise.resolve({ data: [{ id: 1, name: "Nature" }] });
      }
      return Promise.resolve({ data: [] });
    });

    render(<AdminPanel />);

    const panel = await screen.findByTestId("admin-users-panel");
    expect(panel).toHaveStyle({ background: "#0f172a", color: "#f5f5f5" });

    document.body.classList.remove("dark-mode");
  });

  it("keeps updated_at in the CSV export without showing it in the user list", async () => {
    useLocation.mockReturnValue({ search: "?tab=users" });
    const originalCreateObjectURL = URL.createObjectURL;
    const originalBlob = global.Blob;
    const createObjectURLMock = jest.fn(() => "blob:test");
    URL.createObjectURL = createObjectURLMock;
    global.Blob = jest.fn((parts) => ({
      text: jest.fn().mockResolvedValue(Array.isArray(parts) ? parts.join("") : String(parts))
    }));
    const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/users")) {
        return Promise.resolve({ data: [
          { id: 1, full_name: "Updated User", username: "updateduser", email: "updated@example.com", role: "customer", identity_number: "88", credits: 10, status: "active", updated_at: "2026-08-12T10:00:00.000Z" }
        ] });
      }
      if (url.includes("/admin/categories")) {
        return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      }
      if (url.includes("/admin/collections")) {
        return Promise.resolve({ data: [{ id: 1, name: "Nature" }] });
      }
      return Promise.resolve({ data: [] });
    });

    render(<AdminPanel />);

    expect(await screen.findByText(/updated user/i)).toBeInTheDocument();
    expect(screen.queryByText(/updated:/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /export csv/i }));

    await waitFor(() => {
      expect(createObjectURLMock).toHaveBeenCalled();
      expect(clickSpy).toHaveBeenCalled();
    });

    const blobArg = createObjectURLMock.mock.calls[0][0];
    const csvText = await blobArg.text();
    expect(csvText).toContain("updated_at");
    expect(csvText).toContain("2026-08-12T10:00:00.000Z");

    URL.createObjectURL = originalCreateObjectURL;
    global.Blob = originalBlob;
    clickSpy.mockRestore();
  });

  it("exports all users to CSV from the users tab", async () => {
    useLocation.mockReturnValue({ search: "?tab=users" });
    const originalCreateObjectURL = URL.createObjectURL;
    const originalBlob = global.Blob;
    const createObjectURLMock = jest.fn(() => "blob:test");
    URL.createObjectURL = createObjectURLMock;
    global.Blob = jest.fn((parts) => ({
      text: jest.fn().mockResolvedValue(Array.isArray(parts) ? parts.join("") : String(parts))
    }));
    const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/users")) {
        return Promise.resolve({ data: [
          { id: 1, full_name: "Test User", username: "tester", email: "tester@example.com", role: "contributor", identity_number: "123", credits: 5, status: "pending" },
          { id: 2, full_name: "Inactive User", username: "inactive", email: "inactive@example.com", role: "contributor", identity_number: "456", credits: 0, status: "inactive" }
        ] });
      }
      if (url.includes("/admin/categories")) {
        return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      }
      if (url.includes("/admin/collections")) {
        return Promise.resolve({ data: [{ id: 1, name: "Nature" }] });
      }
      return Promise.resolve({ data: [] });
    });

    render(<AdminPanel />);

    fireEvent.click(await screen.findByRole("button", { name: /export csv/i }));

    await waitFor(() => {
      expect(createObjectURLMock).toHaveBeenCalled();
      expect(clickSpy).toHaveBeenCalled();
    });

    const blobArg = createObjectURLMock.mock.calls[0][0];
    const csvText = await blobArg.text();
    expect(csvText).toContain("Test User");
    expect(csvText).toContain("Inactive User");
    expect(csvText).toContain("tester@example.com");

    URL.createObjectURL = originalCreateObjectURL;
    global.Blob = originalBlob;
    clickSpy.mockRestore();
  });

  it("creates a new customer account when Add New is used", async () => {
    useLocation.mockReturnValue({ search: "?tab=users" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/users")) {
        return Promise.resolve({ data: [] });
      }
      if (url.includes("/admin/categories")) {
        return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      }
      if (url.includes("/admin/collections")) {
        return Promise.resolve({ data: [{ id: 1, name: "Nature" }] });
      }
      return Promise.resolve({ data: [{ id: 1, title: "Live asset", status: "approved", filename: "asset.jpg", category: "Images", keywords: "", description: "", type: "image" }] });
    });

    axios.post.mockImplementation((url, payload) => {
      if (url.includes("/admin/users")) {
        return Promise.resolve({ data: { id: 4, ...payload } });
      }
      return Promise.resolve({ data: { id: 2, name: "Travel" } });
    });

    render(<AdminPanel />);

    fireEvent.click(await screen.findByRole("button", { name: /add new/i }));

    fireEvent.change(screen.getByPlaceholderText(/full name/i), { target: { value: "Dummy Customer" } });
    fireEvent.change(screen.getByPlaceholderText(/username/i), { target: { value: "dummycust" } });
    fireEvent.change(screen.getByPlaceholderText(/email/i), { target: { value: "dummy@customer.test" } });
    fireEvent.change(screen.getByPlaceholderText(/id #/i), { target: { value: "DUMMY001" } });
    fireEvent.change(screen.getByPlaceholderText(/credits/i), { target: { value: "10" } });
    fireEvent.change(screen.getByPlaceholderText(/password/i), { target: { value: "password123" } });
    fireEvent.change(screen.getByRole("combobox", { name: /role/i }), { target: { value: "customer" } });
    fireEvent.change(screen.getByRole("combobox", { name: /status/i }), { target: { value: "active" } });

    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining("/admin/users"),
        expect.objectContaining({
          full_name: "Dummy Customer",
          username: "dummycust",
          email: "dummy@customer.test",
          role: "customer",
          identity_number: "DUMMY001",
          credits: 10,
          status: "active",
          password: "password123"
        }),
        expect.anything()
      );
    });

    await waitFor(() => {
      expect(screen.queryByText(/update user details and save changes/i)).not.toBeInTheDocument();
    });

    expect(screen.getByText(/dummy customer/i)).toBeInTheDocument();
  });

  it("renders activate, deactivate, modify, and delete controls for users", async () => {
    useLocation.mockReturnValue({ search: "?tab=users" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/users")) {
        return Promise.resolve({ data: [
          { id: 1, full_name: "Test User", username: "tester", email: "tester@example.com", role: "contributor", identity_number: "123", credits: 5, status: "pending" }
        ] });
      }
      if (url.includes("/admin/categories")) {
        return Promise.resolve({ data: [{ id: 1, name: "Images" }] });
      }
      if (url.includes("/admin/collections")) {
        return Promise.resolve({ data: [{ id: 1, name: "Nature" }] });
      }
      return Promise.resolve({ data: [{ id: 1, title: "Live asset", status: "approved", filename: "asset.jpg", category: "Images", keywords: "", description: "", type: "image" }] });
    });
    axios.put.mockResolvedValue({ data: { id: 1, full_name: "Test User", username: "tester", email: "tester@example.com", role: "contributor", identity_number: "123", credits: 5, status: "active" } });

    render(<AdminPanel />);

    expect(await screen.findByText(/^Activate$/i)).toBeInTheDocument();
    expect(screen.getByText(/^Block$/i)).toBeInTheDocument();
    expect(screen.getByText(/^Modify$/i)).toBeInTheDocument();
    expect(screen.getByText(/^Delete$/i)).toBeInTheDocument();

    fireEvent.click(screen.getByText(/^Modify$/i));
    const editUserDialog = screen.getByRole("dialog", { name: "Edit User" });
    expect(editUserDialog).toHaveStyle({ maxHeight: "90vh", overflowY: "auto" });
    expect(within(editUserDialog).getByPlaceholderText(/full name/i)).toBeInTheDocument();
    expect(within(editUserDialog).getByPlaceholderText(/username/i)).toBeInTheDocument();
    expect(within(editUserDialog).getByRole("button", { name: /^save$/i })).toBeInTheDocument();
  });

  it("closes the edit user dialog on backdrop click without saving changes", async () => {
    useLocation.mockReturnValue({ search: "?tab=users" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/users")) {
        return Promise.resolve({ data: [
          { id: 81, full_name: "Backdrop User", username: "backdrop-user", email: "backdrop@example.com", role: "customer", status: "active" }
        ] });
      }
      if (url.includes("/admin/categories")) return Promise.resolve({ data: [] });
      if (url.includes("/admin/collections")) return Promise.resolve({ data: [] });
      return Promise.resolve({ data: [] });
    });

    render(<AdminPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Modify" }));
    fireEvent.change(screen.getByPlaceholderText("Full name"), { target: { value: "Unsaved Name" } });

    const dialog = screen.getByRole("dialog", { name: "Edit User" });
    fireEvent.click(dialog.parentElement);

    expect(screen.queryByRole("dialog", { name: "Edit User" })).not.toBeInTheDocument();
    expect(axios.put).not.toHaveBeenCalled();
    expect(screen.getByText("Backdrop User")).toBeInTheDocument();
  });

  it("starts a 60-minute cooling period before deleting a user", async () => {
    useLocation.mockReturnValue({ search: "?tab=users" });
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/users")) {
        return Promise.resolve({ data: [{ id: 1, full_name: "Cooling User", username: "cooling", role: "customer", status: "active" }] });
      }
      return Promise.resolve({ data: [] });
    });
    axios.delete.mockResolvedValue({
      status: 202,
      data: {
        user: {
          id: 1,
          full_name: "Cooling User",
          username: "cooling",
          role: "customer",
          status: "active",
          deletion_requested_at: new Date(Date.now() + 60 * 60 * 1000).toISOString()
        }
      }
    });

    render(<AdminPanel />);

    fireEvent.click(await screen.findByRole("button", { name: /^delete$/i }));
    expect(screen.getByText(/60-minute cooling period/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /start deletion period/i }));

    await waitFor(() => {
      expect(axios.delete).toHaveBeenCalledWith(
        expect.stringContaining("/admin/users/1"),
        expect.anything()
      );
    });
    expect(await screen.findByText(/deletion cooling period/i)).toBeInTheDocument();
  });

  it("offers a delete now option for immediate permanent deletion", async () => {
    useLocation.mockReturnValue({ search: "?tab=users" });
    window.confirm = jest.fn().mockReturnValue(true);
    axios.get.mockImplementation((url) => {
      if (url.includes("/admin/users")) {
        return Promise.resolve({ data: [{ id: 1, full_name: "Immediate User", username: "immediate", role: "customer", status: "active" }] });
      }
      return Promise.resolve({ data: [] });
    });
    axios.delete.mockResolvedValue({
      status: 200,
      data: { id: 1, full_name: "Immediate User", username: "immediate", role: "customer", status: "deleted" }
    });

    render(<AdminPanel />);

    fireEvent.click(await screen.findByRole("button", { name: /^delete$/i }));
    expect(screen.getByRole("button", { name: /delete now/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /delete now/i }));

    await waitFor(() => {
      expect(axios.delete).toHaveBeenCalledWith(
        expect.stringContaining("/admin/users/1/force-delete"),
        expect.anything()
      );
    });
  });

});
