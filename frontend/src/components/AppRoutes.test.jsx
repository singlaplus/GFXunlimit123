import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import AppRoutes from "./AppRoutes";
import axios from "axios";

const mockLocation = {
  pathname: "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm/analytics",
  search: "",
  state: null,
};
const mockNavigate = jest.fn();

jest.mock("react-router-dom", () => ({
  useLocation: () => mockLocation,
  useNavigate: () => mockNavigate,
  Navigate: ({ to }) => <div>{to}</div>,
}), { virtual: true });

jest.mock("../pages/AdminAnalyticsPage", () => () => <div>Admin Analytics</div>);
jest.mock("../pages/AdminOrdersPage", () => () => <div>Admin Orders</div>);
jest.mock("../pages/ExplorePage", () => () => <div>Explore Page</div>);
jest.mock("../pages/OrderHistoryPage", () => () => <div>Order History</div>);
jest.mock("axios");

describe("AppRoutes", () => {
  it("renders admin analytics for admin users regardless of role casing", () => {
    render(<AppRoutes userRole="Admin" activePage="analytics" />);
    expect(screen.getByText("Admin Analytics")).toBeInTheDocument();
  });

  it("renders a blank protected page with the blog sidebar menu", () => {
    mockLocation.pathname = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm";
    mockLocation.search = "?tab=controls_blog";

    const { container } = render(<AppRoutes userRole="admin" activePage="admin" />);

    expect(screen.getByRole("complementary", { name: "Blog menu" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dashboard" })).not.toHaveAttribute("href");
    expect(screen.getByRole("button", { name: "Add New" })).not.toHaveAttribute("href");
    expect(screen.getByRole("button", { name: "Drafts" })).not.toHaveAttribute("href");
    expect(screen.getByRole("button", { name: "View" })).not.toHaveAttribute("href");
    expect(screen.getByRole("button", { name: "Schedule" })).not.toHaveAttribute("href");
    expect(screen.getByRole("button", { name: "Analytics" })).not.toHaveAttribute("href");
    expect(container.querySelector("main")).toBeEmptyDOMElement();

    fireEvent.click(screen.getByRole("button", { name: "Analytics" }));
    expect(window.location.search).toBe("?tab=controls_blog&section=analytics");
  });

  it("renders the Blog Analytics panel from the Blog analytics section", async () => {
    mockLocation.pathname = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm";
    mockLocation.search = "?tab=controls_blog&section=analytics";
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ overview: { totalViews: 4, uniqueVisitors: 2 }, topBlogs: [], timeline: [] }) });

    render(<AppRoutes userRole="admin" activePage="admin" />);

    expect(await screen.findByText("Blog Analytics")).toBeInTheDocument();
    expect(screen.getByText("Total Blog Views")).toBeInTheDocument();
    global.fetch = originalFetch;
  });

  it("shows total, draft, and scheduled blog cards on the dashboard", async () => {
    mockLocation.pathname = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm";
    mockLocation.search = "?tab=controls_blog&section=dashboard";
    axios.get.mockImplementation((url) => {
      if (url.includes("status=published")) return Promise.resolve({ data: { drafts: [{ id: 1 }, { id: 2 }] } });
      if (url.includes("status=draft")) return Promise.resolve({ data: { drafts: [{ id: 3 }] } });
      return Promise.resolve({ data: { drafts: [{ id: 4 }, { id: 5 }] } });
    });

    render(<AppRoutes userRole="admin" activePage="admin" />);

    await waitFor(() => expect(screen.getByLabelText("Total blogs count")).toHaveTextContent("5"));
    expect(screen.getByLabelText("Live count")).toHaveTextContent("2");
    expect(screen.getByLabelText("Drafts count")).toHaveTextContent("1");
    expect(screen.getByLabelText("Scheduled blogs count")).toHaveTextContent("2");
  });

  it("renders the complete new blog form for the add-new section", () => {
    mockLocation.pathname = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm";
    mockLocation.search = "?tab=controls_blog&section=add-new";

    render(<AppRoutes userRole="admin" activePage="admin" />);

    expect(screen.getByRole("heading", { name: "Add New Blog" })).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toBeInTheDocument();
    expect(screen.getByLabelText("Content")).toBeInTheDocument();
    expect(screen.getByLabelText("Cover image")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish" })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Schedule" })[1]);
    expect(screen.getByLabelText("Schedule publish date and time")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Schedule publish date and time"), { target: { value: "2099-09-19T20:00" } });
    expect(screen.getByRole("button", { name: "Schedule Publish" })).toBeInTheDocument();
  });

  it("shows rich text controls for the content editor", () => {
    mockLocation.pathname = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm";
    mockLocation.search = "?tab=controls_blog&section=add-new";

    render(<AppRoutes userRole="admin" activePage="admin" />);

    expect(screen.getByRole("button", { name: "Bold" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Italic" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bullet list" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Quote" })).toBeInTheDocument();
  });

  it("shows direct text color shortcuts for black, blue, and red", () => {
    mockLocation.pathname = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm";
    mockLocation.search = "?tab=controls_blog&section=add-new";

    render(<AppRoutes userRole="admin" activePage="admin" />);

    expect(screen.getByRole("button", { name: "Text color black" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Text color blue" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Text color red" })).toBeInTheDocument();
  });

  it("supports linking to an internal asset from the link dialog", async () => {
    mockLocation.pathname = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm";
    mockLocation.search = "?tab=controls_blog&section=add-new";
    axios.get.mockResolvedValue({ data: { images: [{ id: 42, title: "Forest sample", description: "Nature", category: "Photos" }] } });

    render(<AppRoutes userRole="admin" activePage="admin" />);

    fireEvent.click(screen.getByRole("button", { name: "Link" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Use asset" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Use asset" }));
    fireEvent.change(screen.getByPlaceholderText("Search internal asset"), { target: { value: "Forest" } });

    await waitFor(() => expect(screen.getByRole("button", { name: /Forest sample/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Forest sample/ }));

    expect(screen.getByLabelText("Link URL")).toHaveValue("/asset/42");
  });

  it("shows link editing controls and rejects dangerous URLs", () => {
    mockLocation.pathname = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm";
    mockLocation.search = "?tab=controls_blog&section=add-new";

    render(<AppRoutes userRole="admin" activePage="admin" />);

    fireEvent.click(screen.getByRole("button", { name: "Link" }));
    expect(screen.getByLabelText("Selected text")).toBeInTheDocument();
    expect(screen.getByLabelText("Open in")).toBeInTheDocument();
    expect(screen.getByLabelText("Link relationship")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Selected text"), { target: { value: "Unsafe link" } });
    fireEvent.change(screen.getByLabelText("URL", { selector: "input" }), { target: { value: "javascript:alert(1)" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply Link" }));

    expect(screen.getByRole("alert")).toHaveTextContent("This URL is not allowed.");
  });

  it("loads and removes an existing link without removing its text", () => {
    mockLocation.pathname = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm";
    mockLocation.search = "?tab=controls_blog&section=add-new";

    render(<AppRoutes userRole="admin" activePage="admin" />);
    const editor = document.querySelector('[contenteditable="true"]');
    editor.innerHTML = '<p><a href="https://example.com" target="_blank" rel="nofollow">Example</a></p>';
    const link = editor.querySelector("a");
    const range = document.createRange();
    range.selectNodeContents(link.firstChild);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    fireEvent.click(screen.getByRole("button", { name: "Link" }));
    expect(screen.getByLabelText("Selected text")).toHaveValue("Example");
    expect(screen.getByLabelText("URL", { selector: "input" })).toHaveValue("https://example.com");
    expect(screen.getByLabelText("Open in")).toHaveValue("new-tab");
    expect(screen.getByLabelText("Link relationship")).toHaveValue("nofollow");

    fireEvent.click(screen.getByRole("button", { name: "Remove Link" }));
    expect(editor.textContent).toContain("Example");
    expect(editor.querySelector("a")).toBeNull();
  });

  it("automatically styles internal and external links differently", () => {
    mockLocation.pathname = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm";
    mockLocation.search = "?tab=controls_blog&section=add-new";

    render(<AppRoutes userRole="admin" activePage="admin" />);
    const editor = document.querySelector('[contenteditable="true"]');

    fireEvent.click(screen.getByRole("button", { name: "Link" }));
    fireEvent.change(screen.getByLabelText("Selected text"), { target: { value: "Stock assets" } });
    fireEvent.change(screen.getByLabelText("URL", { selector: "input" }), { target: { value: "/stock-assets" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply Link" }));

    const link = editor.querySelector("a");
    expect(link).toHaveStyle({ color: "#2563eb", fontWeight: "700", textDecoration: "none" });

    const range = document.createRange();
    range.selectNodeContents(link.firstChild);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    fireEvent.click(screen.getByRole("button", { name: "Link" }));
    fireEvent.change(screen.getByLabelText("URL", { selector: "input" }), { target: { value: "https://example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply Link" }));

    expect(link).toHaveStyle({ color: "#dc2626", fontWeight: "700", textDecoration: "underline" });
  });

  it("falls back to an inline URL dialog when prompt() is unavailable", () => {
    mockLocation.pathname = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm";
    mockLocation.search = "?tab=controls_blog&section=add-new";

    const originalPrompt = window.prompt;
    window.prompt = undefined;

    render(<AppRoutes userRole="admin" activePage="admin" />);

    expect(() => fireEvent.click(screen.getByRole("button", { name: "Image" }))).not.toThrow();
    expect(screen.getByRole("dialog", { name: "Image URL dialog" })).toBeInTheDocument();

    window.prompt = originalPrompt;
  });

  it("uses a curated open-source Google font list in the editor", () => {
    mockLocation.pathname = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm";
    mockLocation.search = "?tab=controls_blog&section=add-new";

    render(<AppRoutes userRole="admin" activePage="admin" />);

    const fontSelect = screen.getByLabelText("Font family");
    const fontValues = Array.from(fontSelect.options).map((option) => option.value);

    expect(fontValues.length).toBeGreaterThan(10);
    expect(fontValues).toContain("Open Sans");
    expect(fontValues).not.toContain("Arial");
  });

  it("shows saved blog drafts in the drafts section", () => {
    mockLocation.pathname = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm";
    mockLocation.search = "?tab=controls_blog&section=drafts";
    window.localStorage.setItem("gfx-blog-drafts", JSON.stringify([{ id: 1, title: "A saved post", excerpt: "Draft summary", savedAt: "2026-09-19T10:00:00.000Z", category: "News", tags: "update", addedBy: "ankit1" }]));

    render(<AppRoutes userRole="admin" activePage="admin" />);

    expect(screen.getByRole("heading", { name: "Drafts" })).toBeInTheDocument();
    expect(screen.getByText("A saved post")).toBeInTheDocument();
    expect(screen.getByText("Draft summary")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search blogs" }), { target: { value: "saved post" } });
    expect(screen.getByText("A saved post")).toBeInTheDocument();
    expect(screen.getByText("1 draft")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /Added by/ })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Status" })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Tags" })).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /Saved/ })).toHaveAttribute("aria-sort", "descending");
    fireEvent.click(screen.getByRole("button", { name: /Blog post/ }));
    expect(screen.getByRole("columnheader", { name: /Blog post/ })).toHaveAttribute("aria-sort", "ascending");
    expect(screen.getByText("ankit1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "View Published post" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit Published post" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete Published post" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("heading", { name: "Add New Blog" })).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveValue("A saved post");
    window.localStorage.removeItem("gfx-blog-drafts");
  });

  it("hides publish scheduling metadata from the blog editor", () => {
    mockLocation.pathname = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm";
    mockLocation.search = "?tab=controls_blog&section=add-new&draft=12";
    window.localStorage.setItem("gfx-blog-drafts", JSON.stringify([{ id: 12, title: "Scheduled article", status: "scheduled", publishAt: "2026-09-19T14:30:00.000Z" }]));

    render(<AppRoutes userRole="admin" activePage="admin" />);

    expect(screen.queryByLabelText("Publish date and time")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Canonical URL")).not.toBeInTheDocument();
    window.localStorage.removeItem("gfx-blog-drafts");
  });

  it("confirms before deleting a saved draft", () => {
    mockLocation.pathname = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm";
    mockLocation.search = "?tab=controls_blog&section=drafts";
    window.localStorage.setItem("gfx-blog-drafts", JSON.stringify([{ id: 7, title: "Delete me", savedAt: "2026-09-19T10:00:00.000Z" }]));
    const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(false);

    render(<AppRoutes userRole="admin" activePage="admin" />);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(confirmSpy).toHaveBeenCalledWith("Delete this draft? This action cannot be undone.");
    expect(screen.getByText("Delete me")).toBeInTheDocument();
    confirmSpy.mockReturnValue(true);
    window.localStorage.removeItem("gfx-blog-drafts");
    confirmSpy.mockRestore();
  });

  it("keeps the drafts table visible when there are no drafts", () => {
    mockLocation.pathname = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm";
    mockLocation.search = "?tab=controls_blog&section=drafts";
    window.localStorage.removeItem("gfx-blog-drafts");

    render(<AppRoutes userRole="admin" activePage="admin" />);

    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /Added by/ })).toBeInTheDocument();
    expect(screen.getByText("No saved drafts yet.")).toBeInTheDocument();
  });

  it("shows published blogs in the view section", async () => {
    mockLocation.pathname = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm";
    mockLocation.search = "?tab=controls_blog&section=view";
    axios.get.mockResolvedValueOnce({ data: { drafts: [{ id: 9, title: "Published post", excerpt: "Live summary", category: "News", addedBy: "ankit1", status: "published", publishAt: "2026-09-19T10:00:00.000Z", content: "Live content" }] } });

    render(<AppRoutes userRole="admin" activePage="admin" />);

    expect(await screen.findByRole("heading", { name: "Published Blogs" })).toBeInTheDocument();
    expect(await screen.findByText("Published post")).toBeInTheDocument();
    expect(screen.getByText("ankit1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View Published post" }));
    expect(mockNavigate).toHaveBeenCalledWith("/blog/news/published-post_9");
  });

  it("shows five latest published blogs per page", async () => {
    mockLocation.pathname = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm";
    mockLocation.search = "?tab=controls_blog&section=view";
    axios.get.mockResolvedValueOnce({ data: { drafts: Array.from({ length: 6 }, (_, index) => ({ id: index + 1, title: `Post ${index + 1}`, excerpt: `Summary ${index + 1}`, publishAt: "2026-09-19T10:00:00.000Z" })) } });

    render(<AppRoutes userRole="admin" activePage="admin" />);

    expect(await screen.findByText("Post 1")).toBeInTheDocument();
    expect(screen.getByText("Post 5")).toBeInTheDocument();
    expect(screen.queryByText("Post 6")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "2" }));
    expect(screen.getByText("Post 6")).toBeInTheDocument();
    expect(screen.queryByText("Post 1")).not.toBeInTheDocument();
  });

  it("sorts published blogs by clickable table headers", async () => {
    mockLocation.pathname = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm";
    mockLocation.search = "?tab=controls_blog&section=view";
    axios.get.mockResolvedValueOnce({ data: { drafts: [
      { id: 1, title: "Alpha", category: "Zeta", addedBy: "zoe", publishAt: "2026-09-17T10:00:00.000Z" },
      { id: 2, title: "Charlie", category: "Alpha", addedBy: "amy", publishAt: "2026-09-19T10:00:00.000Z" },
      { id: 3, title: "Bravo", category: "Beta", addedBy: "max", publishAt: "2026-09-18T10:00:00.000Z" },
    ] } });

    render(<AppRoutes userRole="admin" activePage="admin" />);

    expect(await screen.findByText("Charlie")).toBeInTheDocument();
    const titleHeader = screen.getByRole("button", { name: /Blog post/ });
    fireEvent.click(titleHeader);
    const firstBlogTitle = screen.getAllByRole("row")[1].textContent;
    expect(firstBlogTitle).toContain("Alpha");
    fireEvent.click(titleHeader);
    expect(screen.getAllByRole("row")[1].textContent).toContain("Charlie");
  });

  it("filters published blogs live from the search field", async () => {
    mockLocation.pathname = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm";
    mockLocation.search = "?tab=controls_blog&section=view";
    axios.get.mockResolvedValueOnce({ data: { drafts: [
      { id: 1, title: "Forest guide", category: "Nature", publishAt: "2026-09-19T10:00:00.000Z" },
      { id: 2, title: "Design trends", category: "Inspiration", publishAt: "2026-09-18T10:00:00.000Z" },
    ] } });

    render(<AppRoutes userRole="admin" activePage="admin" />);

    expect(await screen.findByText("Forest guide")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Search blogs"), { target: { value: "nature" } });
    expect(screen.getByText("Forest guide")).toBeInTheDocument();
    expect(screen.queryByText("Design trends")).not.toBeInTheDocument();
  });

  it("shows published blogs on the public blog page newest first", async () => {
    mockLocation.pathname = "/blog";
    mockLocation.search = "";
    axios.get.mockResolvedValueOnce({ data: { posts: [{ id: 1, title: "Latest post", excerpt: "Latest summary", publishAt: "2026-09-19T12:00:00.000Z" }] } });

    render(<AppRoutes userRole="customer" activePage="home" />);

    expect(await screen.findByRole("heading", { name: "Latest from the blog" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Latest post" })).toBeInTheDocument();
    expect(screen.getByLabelText("Search blogs")).toBeInTheDocument();
  });

  it("renders the public blog detail page from a category and title URL", async () => {
    mockLocation.pathname = "/blog/tips-tricks/demo-published-blog-01_7";
    mockLocation.search = "";
    axios.get.mockResolvedValueOnce({ data: { post: { id: 7, title: "Demo Published Blog 01", category: "Tips & Tricks", excerpt: "A demo blog post", content: "Blog content", author: "ankit", publishAt: "2026-09-19T12:00:00.000Z" } } });

    render(<AppRoutes userRole="customer" activePage="home" />);

    expect(await screen.findByRole("heading", { name: "Demo Published Blog 01" })).toBeInTheDocument();
    expect(screen.getByText("A demo blog post")).toBeInTheDocument();
    expect(screen.getByText("Tips & Tricks")).toBeInTheDocument();
  });

  it("uses the shared website pagination controls on the public blog page", async () => {
    mockLocation.pathname = "/blog";
    mockLocation.search = "";
    const posts = Array.from({ length: 11 }, (_, index) => ({
      id: index + 1,
      title: `Blog post ${index + 1}`,
      excerpt: `Summary ${index + 1}`,
      publishAt: "2026-09-19T12:00:00.000Z",
    }));
    axios.get.mockResolvedValueOnce({ data: { posts } });

    render(<AppRoutes userRole="customer" activePage="home" />);

    expect(await screen.findByRole("button", { name: /First/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Last/i })).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
  });

  it("saves and publishes a new blog through the shared API", async () => {
    mockLocation.pathname = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm";
    mockLocation.search = "?tab=controls_blog&section=add-new";
    axios.post.mockResolvedValueOnce({ data: { draft: { id: 42 } } }).mockResolvedValueOnce({ data: { draft: { id: 42, status: "published" } } });

    render(<AppRoutes userRole="admin" activePage="admin" />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Shared post" } });
    fireEvent.change(screen.getByLabelText("Content"), { target: { value: "Shared content" } });
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));

    await waitFor(() => expect(axios.post).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("/admin/blog/drafts/42/publish"),
      {},
      expect.anything()
    ));
  });

  it("saves edits to an already published blog without forcing publish", async () => {
    mockLocation.pathname = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm";
    mockLocation.search = "?tab=controls_blog&section=add-new&draft=9";
    render(<AppRoutes userRole="admin" activePage="admin" />);

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Updated published post" } });
    fireEvent.change(screen.getByLabelText("Content"), { target: { value: "Updated content" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    await waitFor(() => expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining("/admin/blog/drafts"),
      expect.objectContaining({ title: "Updated published post" }),
      expect.anything()
    ));
  });

  it("opens a saved blog preview in a new page", async () => {
    mockLocation.pathname = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm";
    mockLocation.search = "?tab=controls_blog&section=add-new";
    const openSpy = jest.spyOn(window, "open").mockImplementation(() => null);
    axios.post.mockResolvedValueOnce({ data: { draft: { id: 12 } } });

    render(<AppRoutes userRole="admin" activePage="admin" />);
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    await waitFor(() => expect(openSpy).toHaveBeenCalledWith(
      expect.stringContaining("section=blog_preview&draft=12"),
      "_blank",
      "noopener,noreferrer"
    ));
    openSpy.mockRestore();
  });

  it("uses the blog title with preview suffix for the preview page title", async () => {
    mockLocation.pathname = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm";
    mockLocation.search = "?tab=controls_blog&section=blog_preview&draft=12";
    axios.get.mockResolvedValueOnce({ data: { draft: { id: 12, title: "My blog" } } });

    render(<AppRoutes userRole="admin" activePage="admin" />);

    await waitFor(() => expect(document.title).toBe("My blog_preview"));
    document.title = "GFXunlimit";
  });

  it("renders the page for the current pathname even when the cached active page is stale", () => {
    mockLocation.pathname = "/explore";
    render(
      <AppRoutes
        userRole="customer"
        activePage="home"
        homeSectionProps={{
          homePageProps: {},
          galleryProps: {},
          containerProps: {
            loading: false,
            filteredImages: [],
            currentPage: 1,
            totalPages: 1,
            totalImages: 0,
            setCurrentPage: jest.fn(),
            selectedImage: null,
            setSelectedImage: jest.fn(),
            darkMode: false,
            relatedImages: [],
            fetchSingleImage: jest.fn(),
            goToPreviousImage: jest.fn(),
            goToNextImage: jest.fn(),
            likeImage: jest.fn(),
            addFavorite: jest.fn(),
            downloadImage: jest.fn(),
            shareImage: jest.fn(),
          },
          popupProps: {
            selectedContributor: null,
            setSelectedContributor: jest.fn(),
            contributorImages: [],
            contributorLikes: [],
            contributorViews: [],
            contributorDownloads: [],
            contributorBestImage: null,
          },
        }}
      />
    );
    expect(screen.getByText("Explore Page")).toBeInTheDocument();
  });

  it("renders order history for customer orders route", () => {
    mockLocation.pathname = "/orders";
    render(<AppRoutes userRole="customer" activePage="home" homeSectionProps={{ homePageProps: {}, galleryProps: {}, containerProps: { loading: false, filteredImages: [], currentPage: 1, totalPages: 1, totalImages: 0, setCurrentPage: jest.fn(), selectedImage: null, setSelectedImage: jest.fn(), darkMode: false, relatedImages: [], fetchSingleImage: jest.fn(), goToPreviousImage: jest.fn(), goToNextImage: jest.fn(), likeImage: jest.fn(), addFavorite: jest.fn(), downloadImage: jest.fn(), shareImage: jest.fn() }, popupProps: { selectedContributor: null, setSelectedContributor: jest.fn(), contributorImages: [], contributorLikes: [], contributorViews: [], contributorDownloads: [], contributorBestImage: null } }} />);
    expect(screen.getByText("Order History")).toBeInTheDocument();
  });

  it("renders the tax form review screen for the review tab", () => {
    mockLocation.pathname = "/dashboard";
    mockLocation.search = "?tab=filltaxform_review";
    mockLocation.state = {
      formType: "W-8BEN",
      formData: { name: "Amit Patel", citizenship: "India", treatyCountry: "India" },
    };

    render(<AppRoutes userRole="contributor" activePage="tax" />);

    expect(screen.getByText("Review tax form")).toBeInTheDocument();
    expect(screen.getByText("Amit Patel")).toBeInTheDocument();
  });

  it("submits the reviewed tax form before returning to Tax Center", async () => {
    axios.post.mockResolvedValue({ data: { submitted: true } });
    mockNavigate.mockClear();

    render(<AppRoutes userRole="contributor" activePage="tax" />);

    fireEvent.click(screen.getByRole("button", { name: /^submit$/i }));

    await waitFor(() => {
      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining("/profile/tax-form"),
        expect.objectContaining({ formType: "W-8BEN", name: "Amit Patel" }),
        expect.objectContaining({ headers: expect.any(Object) })
      );
      expect(mockNavigate).toHaveBeenCalledWith("/dashboard?tab=taxcenter");
    });
  });
});
