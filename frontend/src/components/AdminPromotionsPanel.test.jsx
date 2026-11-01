import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import axios from "axios";
import AdminPromotionsPanel from "./AdminPromotionsPanel";

jest.mock("axios");

const promotionData = {
  newsletters: [
    { id: 1, name: "Sent campaign", subject: "Hello", status: "sent", recipients: ["one@example.com"] },
    { id: 2, name: "Scheduled campaign", subject: "Soon", status: "scheduled", recipients: [] },
    { id: 3, name: "Draft campaign", subject: "Later", status: "draft", recipients: [] }
  ]
};

beforeEach(() => {
  window.localStorage.setItem("adminPromotionsActiveSection", "newsletters");
  axios.get.mockResolvedValue({ data: promotionData });
  axios.post.mockResolvedValue({ data: { queued: 1, campaign: { id: 4 } } });
});

afterEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
});

test("shows newsletter fields, action choices, and filters existing entries by status", async () => {
  render(<AdminPromotionsPanel />);

  expect(await screen.findByText("Sent campaign")).toBeInTheDocument();
  expect(screen.getByLabelText("Campaign name")).toBeInTheDocument();
  expect(screen.getByLabelText("Subject")).toBeInTheDocument();
  expect(screen.getByLabelText("Emails")).toBeInTheDocument();
  expect(screen.getByLabelText("Message body")).toBeInTheDocument();
  expect(screen.queryByLabelText("Audience")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Status")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Draft Newsletter Campaigns" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Search emails" }));
  const audienceDialog = screen.getByRole("dialog", { name: "Choose your audience" });
  expect(within(audienceDialog).getByLabelText("Audience")).toBeInTheDocument();
  expect(within(audienceDialog).getByRole("button", { name: "Search recipients" })).toBeInTheDocument();
  expect(within(audienceDialog).getAllByRole("button")).toHaveLength(1);
  expect(within(audienceDialog).queryByLabelText("Search newsletter recipients")).not.toBeInTheDocument();
  fireEvent.click(within(audienceDialog).getByRole("button", { name: "Search recipients" }));
  expect(screen.getByLabelText("Search newsletter recipients")).toBeInTheDocument();
  expect(screen.getByText("Scheduled campaign")).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText("Filter newsletter campaigns"), { target: { value: "draft" } });
  expect(screen.getByText("Draft campaign")).toBeInTheDocument();
  expect(screen.queryByText("Sent campaign")).not.toBeInTheDocument();
});

test("keeps failed promotions loads visible and retries with a GET", async () => {
  axios.get.mockRejectedValueOnce(new Error("Unavailable"));
  render(<AdminPromotionsPanel />);

  expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load promotions data.");
  expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();

  axios.get.mockResolvedValueOnce({ data: promotionData });
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));

  expect(await screen.findByText("Sent campaign")).toBeInTheDocument();
  expect(axios.get).toHaveBeenCalledTimes(2);
  expect(axios.post).not.toHaveBeenCalled();
});

test("shows newsletter SMTP settings in Promotions Settings", async () => {
  window.localStorage.setItem("adminPromotionsActiveSection", "settings");
  render(<AdminPromotionsPanel />);

  expect(await screen.findByRole("heading", { name: "SMTP Settings" })).toBeInTheDocument();
  expect(screen.getByLabelText("Sender name")).toBeInTheDocument();
  expect(screen.getByLabelText("SMTP host")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Verify SMTP Settings" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save SMTP for newsletter" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Send Test Mail" })).toBeInTheDocument();
});

test("edits an existing newsletter campaign without sending it again", async () => {
  render(<AdminPromotionsPanel />);
  const campaignName = await screen.findByText("Sent campaign");
  fireEvent.click(within(campaignName.closest(".promotions-list-item")).getByRole("button", { name: "Edit" }));

  expect(screen.getByRole("heading", { name: "Edit Newsletter Campaign" })).toBeInTheDocument();
  expect(screen.getByLabelText("Campaign name")).toHaveValue("Sent campaign");
  expect(screen.getByLabelText("Status")).toBeEnabled();
  expect(within(screen.getByLabelText("Status")).getByRole("option", { name: "Send" })).toBeInTheDocument();
  expect(within(screen.getByLabelText("Status")).getByRole("option", { name: "Scheduled" })).toBeInTheDocument();
  expect(within(screen.getByLabelText("Status")).getByRole("option", { name: "Draft" })).toBeInTheDocument();
  const messageBody = screen.getByLabelText("Message body");
  messageBody.innerHTML = "<p>Updated copy</p>";
  fireEvent.input(messageBody);
  fireEvent.click(screen.getByRole("button", { name: "Save Newsletter Changes" }));

  await waitFor(() => expect(axios.post).toHaveBeenCalledWith(
    expect.stringContaining("/admin/promotions"),
    expect.objectContaining({
      resource: "newsletter",
      action: "update",
      data: expect.objectContaining({
        id: 1,
        name: "Sent campaign",
        body: "<p>Updated copy</p>",
        recipients: ["one@example.com"]
      })
    }),
    expect.any(Object)
  ));
});

test("schedules an existing newsletter campaign when editing its status", async () => {
  render(<AdminPromotionsPanel />);
  const campaignName = await screen.findByText("Draft campaign");
  fireEvent.click(within(campaignName.closest(".promotions-list-item")).getByRole("button", { name: "Edit" }));
  fireEvent.change(screen.getByLabelText("Status"), { target: { value: "scheduled" } });
  fireEvent.change(screen.getByLabelText("Campaign name"), { target: { value: "Draft campaign" } });
  fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Draft subject" } });
  fireEvent.change(screen.getByLabelText("Emails"), { target: { value: "reader@example.com" } });
  const messageBody = screen.getByLabelText("Message body");
  messageBody.innerHTML = "<p>Schedule this</p>";
  fireEvent.input(messageBody);
  fireEvent.change(screen.getByLabelText("Schedule (IST)"), { target: { value: "2027-01-01T10:00" } });
  fireEvent.click(screen.getByRole("button", { name: "Schedule Newsletter Changes" }));

  await waitFor(() => expect(axios.post).toHaveBeenCalledWith(
    expect.stringContaining("/admin/promotions"),
    expect.objectContaining({
      resource: "newsletter",
      action: "schedule",
      data: expect.objectContaining({
        id: 3,
        schedule: expect.any(String),
        recipients: ["reader@example.com"]
      })
    }),
    expect.any(Object)
  ));
});

test("sends an existing newsletter campaign when editing its status", async () => {
  render(<AdminPromotionsPanel />);
  const campaignName = await screen.findByText("Draft campaign");
  fireEvent.click(within(campaignName.closest(".promotions-list-item")).getByRole("button", { name: "Edit" }));
  fireEvent.change(screen.getByLabelText("Status"), { target: { value: "send" } });
  fireEvent.change(screen.getByLabelText("Campaign name"), { target: { value: "Draft campaign" } });
  fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Draft subject" } });
  fireEvent.change(screen.getByLabelText("Emails"), { target: { value: "reader@example.com" } });
  const messageBody = screen.getByLabelText("Message body");
  messageBody.innerHTML = "<p>Send this</p>";
  fireEvent.input(messageBody);
  fireEvent.click(screen.getByRole("button", { name: "Send Newsletter Changes" }));

  await waitFor(() => expect(axios.post).toHaveBeenCalledWith(
    expect.stringContaining("/admin/promotions"),
    expect.objectContaining({
      resource: "newsletter",
      action: "send",
      data: expect.objectContaining({
        id: 3,
        recipients: ["reader@example.com"]
      })
    }),
    expect.any(Object)
  ));
});

test("loads inline newsletter images as previews while editing a campaign", async () => {
  const imageCid = "newsletter-123e4567-e89b-42d3-a456-426614174000@newsletter.gfxunlimit";
  const imageAttachment = {
    filename: "123e4567-e89b-42d3-a456-426614174000.jpg",
    name: "hero.jpg",
    size: 128,
    cid: imageCid
  };
  axios.get.mockImplementation((url) => (
    url.includes("/newsletter-attachments/")
      ? Promise.resolve({ data: new Blob(["image"], { type: "image/jpeg" }) })
      : Promise.resolve({
        data: {
          ...promotionData,
          newsletters: [{
            id: 8,
            name: "Image campaign",
            subject: "Image subject",
            status: "draft",
            recipients: ["reader@example.com"],
            body: `<p>Welcome</p><img src="cid:${imageCid}" alt="hero.jpg">`,
            attachments: [imageAttachment]
          }]
        }
      })
  ));
  const previousCreateObjectURL = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: jest.fn(() => "blob:existing-newsletter-image")
  });
  try {
    render(<AdminPromotionsPanel />);
    const campaignName = await screen.findByText("Image campaign");
    fireEvent.click(within(campaignName.closest(".promotions-list-item")).getByRole("button", { name: "Edit" }));

    const messageBody = await screen.findByLabelText("Message body");
    expect(await within(messageBody).findByRole("img", { name: "hero.jpg" })).toHaveAttribute(
      "src",
      "blob:existing-newsletter-image"
    );
    expect(axios.get).toHaveBeenCalledWith(
      expect.stringContaining(`/admin/promotions/newsletter-attachments/${imageAttachment.filename}`),
      expect.objectContaining({ responseType: "blob" })
    );

    fireEvent.click(screen.getByRole("button", { name: "Save Newsletter Changes" }));
    await waitFor(() => expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining("/admin/promotions"),
      expect.objectContaining({
        resource: "newsletter",
        action: "draft",
        data: expect.objectContaining({
          id: 8,
          body: expect.stringContaining(`src="cid:${imageCid}"`),
          attachments: [imageAttachment]
        })
      }),
      expect.any(Object)
    ));
  } finally {
    if (previousCreateObjectURL) {
      Object.defineProperty(URL, "createObjectURL", previousCreateObjectURL);
    } else {
      delete URL.createObjectURL;
    }
  }
});

test("sends a newsletter using the selected recipients and message", async () => {
  render(<AdminPromotionsPanel />);
  await screen.findByLabelText("Campaign name");

  fireEvent.change(screen.getByLabelText("Campaign name"), { target: { value: "Launch" } });
  fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "New collection" } });
  fireEvent.change(screen.getByLabelText("Emails"), { target: { value: "reader@example.com" } });
  const messageBody = screen.getByLabelText("Message body");
  messageBody.innerHTML = "Welcome!";
  fireEvent.input(messageBody);
  fireEvent.change(screen.getByLabelText("Status"), { target: { value: "send" } });
  fireEvent.click(screen.getByRole("button", { name: "Send Newsletter Campaigns" }));

  await waitFor(() => expect(axios.post).toHaveBeenCalledWith(
    expect.stringContaining("/admin/promotions"),
    {
      resource: "newsletter",
      action: "send",
      data: expect.objectContaining({
        name: "Launch",
        subject: "New collection",
        body: "Welcome!",
        recipients: ["reader@example.com"]
      })
    },
    expect.any(Object)
  ));
  expect(await screen.findByText("Newsletter queued for 1 recipient(s).")).toBeInTheDocument();
});

test("validates and keeps every manually entered email when Tab is pressed", async () => {
  render(<AdminPromotionsPanel />);
  await screen.findByLabelText("Campaign name");

  fireEvent.change(screen.getByLabelText("Campaign name"), { target: { value: "Launch" } });
  fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "New collection" } });
  const emails = screen.getByLabelText("Emails");
  fireEvent.change(emails, {
    target: { value: "Alice@example.com; bob@example.com\nALICE@example.com" }
  });
  fireEvent.keyDown(emails, { key: "Tab", code: "Tab" });

  expect(emails).toHaveValue("alice@example.com, bob@example.com");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();

  const messageBody = screen.getByLabelText("Message body");
  messageBody.innerHTML = "Welcome!";
  fireEvent.input(messageBody);
  fireEvent.change(screen.getByLabelText("Status"), { target: { value: "send" } });
  fireEvent.click(screen.getByRole("button", { name: "Send Newsletter Campaigns" }));

  await waitFor(() => expect(axios.post).toHaveBeenCalledWith(
    expect.stringContaining("/admin/promotions"),
    expect.objectContaining({
      resource: "newsletter",
      action: "send",
      data: expect.objectContaining({
        recipients: ["alice@example.com", "bob@example.com"]
      })
    }),
    expect.any(Object)
  ));
});

test("keeps invalid email text and prevents Tab from hiding the validation issue", async () => {
  render(<AdminPromotionsPanel />);
  await screen.findByLabelText("Emails");
  const emails = screen.getByLabelText("Emails");
  fireEvent.change(emails, { target: { value: "valid@example.com, invalid-address" } });

  fireEvent.keyDown(emails, { key: "Tab", code: "Tab" });

  expect(emails).toHaveValue("valid@example.com, invalid-address");
  expect(screen.getByRole("alert")).toHaveTextContent("invalid-address");
});

test("searches eligible recipients and schedules the campaign in IST", async () => {
  axios.get.mockImplementation((url) => (
    url.includes("newsletter-recipients")
      ? { data: [{ id: 8, username: "reader", email: "reader@example.com", role: "customer" }] }
      : { data: promotionData }
  ));
  render(<AdminPromotionsPanel />);
  await screen.findByText("Sent campaign");

  fireEvent.click(screen.getByRole("button", { name: "Search emails" }));
  fireEvent.change(screen.getByLabelText("Audience"), { target: { value: "customer_active" } });
  fireEvent.click(within(screen.getByRole("dialog", { name: "Choose your audience" })).getByRole("button", { name: "Search recipients" }));
  expect(screen.getByLabelText("Search newsletter recipients")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Search newsletter recipients"), { target: { value: "reader" } });
  fireEvent.click(screen.getByRole("button", { name: "Search", exact: true }));
  await waitFor(() => expect(axios.get).toHaveBeenCalledWith(
    expect.stringContaining("audience=customer_active"),
    expect.any(Object)
  ));
  expect(await screen.findByRole("checkbox")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Add selected emails (1)" }));
  expect(screen.getByLabelText("Emails")).toHaveValue("reader@example.com");

  fireEvent.change(screen.getByLabelText("Campaign name"), { target: { value: "Launch" } });
  fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "New collection" } });
  const messageBody = screen.getByLabelText("Message body");
  messageBody.innerHTML = "Welcome!";
  fireEvent.input(messageBody);
  fireEvent.change(screen.getByLabelText("Status"), { target: { value: "scheduled" } });
  fireEvent.change(screen.getByLabelText("Schedule (IST)"), { target: { value: "2099-01-01T10:00" } });
  fireEvent.click(screen.getByRole("button", { name: "Schedule Newsletter Campaigns" }));

  await waitFor(() => expect(axios.post).toHaveBeenCalledWith(
    expect.stringContaining("/admin/promotions"),
    expect.objectContaining({
      resource: "newsletter",
      action: "schedule",
      data: expect.objectContaining({
        recipients: ["reader@example.com"],
        schedule: "2099-01-01T04:30:00.000Z"
      })
    }),
    expect.any(Object)
  ));
});

test("selects all current search results or clears the selected recipients", async () => {
  axios.get.mockImplementation((url) => (
    url.includes("newsletter-recipients")
      ? {
        data: [
          { id: 8, username: "reader", email: "reader@example.com", role: "customer" },
          { id: 9, username: "artist", email: "artist@example.com", role: "contributor" }
        ]
      }
      : { data: promotionData }
  ));
  render(<AdminPromotionsPanel />);
  await screen.findByText("Sent campaign");

  fireEvent.click(screen.getByRole("button", { name: "Search emails" }));
  fireEvent.click(within(screen.getByRole("dialog", { name: "Choose your audience" })).getByRole("button", { name: "Search recipients" }));
  fireEvent.click(screen.getByRole("button", { name: "Search", exact: true }));
  expect(await screen.findAllByRole("checkbox")).toHaveLength(2);

  fireEvent.click(screen.getByRole("button", { name: "Select all" }));
  expect(screen.getByRole("button", { name: "Add selected emails (2)" })).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Clear selected" }));
  expect(screen.getByRole("button", { name: "Add selected emails (0)" })).toBeInTheDocument();
});

test("shows search progress and the number of loaded recipients", async () => {
  let resolveSearch;
  axios.get.mockImplementation((url) => (
    url.includes("newsletter-recipients")
      ? new Promise((resolve) => {
        resolveSearch = resolve;
      })
      : Promise.resolve({ data: promotionData })
  ));
  render(<AdminPromotionsPanel />);
  await screen.findByText("Sent campaign");

  fireEvent.click(screen.getByRole("button", { name: "Search emails" }));
  fireEvent.click(within(screen.getByRole("dialog", { name: "Choose your audience" })).getByRole("button", { name: "Search recipients" }));
  fireEvent.click(screen.getByRole("button", { name: "Search", exact: true }));

  expect(screen.getByRole("progressbar", { name: "Searching newsletter recipients" })).toBeInTheDocument();
  resolveSearch({
    data: [
      { id: 8, username: "reader", email: "reader@example.com", role: "customer" },
      { id: 9, username: "artist", email: "artist@example.com", role: "contributor" }
    ]
  });

  expect(await screen.findByText("Search complete — 2 recipients loaded.")).toBeInTheDocument();
  expect(screen.getByRole("progressbar", { name: "Newsletter recipient search complete" })).toHaveAttribute("value", "100");
});

test("explains when no recently active customers match", async () => {
  axios.get.mockImplementation((url) => (
    url.includes("newsletter-recipients")
      ? Promise.resolve({ data: [] })
      : Promise.resolve({ data: promotionData })
  ));
  render(<AdminPromotionsPanel />);
  await screen.findByText("Sent campaign");

  fireEvent.click(screen.getByRole("button", { name: "Search emails" }));
  fireEvent.change(screen.getByLabelText("Audience"), { target: { value: "customer_active" } });
  fireEvent.click(within(screen.getByRole("dialog", { name: "Choose your audience" })).getByRole("button", { name: "Search recipients" }));
  fireEvent.click(screen.getByRole("button", { name: "Search", exact: true }));

  expect(await screen.findByText("No customers with a recorded login in the past 30 days matched this search.")).toBeInTheDocument();
  expect(screen.getByRole("progressbar", { name: "Newsletter recipient search complete" })).toHaveAttribute("value", "100");
});

test("provides newsletter text formatting controls", async () => {
  render(<AdminPromotionsPanel />);
  await screen.findByLabelText("Message body");

  expect(screen.getByLabelText("Font family")).toBeInTheDocument();
  expect(screen.getByLabelText("Font size")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Bold" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Italic" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Underline" })).toBeInTheDocument();
  expect(screen.getByLabelText("Text color")).toHaveAttribute("type", "color");

  const execCommand = jest.fn(() => true);
  document.execCommand = execCommand;
  fireEvent.click(screen.getByRole("button", { name: "Bold" }));
  fireEvent.change(screen.getByLabelText("Font family"), { target: { value: "Georgia" } });
  fireEvent.change(screen.getByLabelText("Font size"), { target: { value: "5" } });
  fireEvent.change(screen.getByLabelText("Text color"), { target: { value: "#ff0000" } });
  expect(execCommand).toHaveBeenCalledWith("bold", false, "");
  expect(execCommand).toHaveBeenCalledWith("fontName", false, "Georgia");
  expect(execCommand).toHaveBeenCalledWith("fontSize", false, "5");
  expect(execCommand).toHaveBeenCalledWith("foreColor", false, "#ff0000");
  delete document.execCommand;
});

test("keeps selected message text when applying toolbar formatting", async () => {
  render(<AdminPromotionsPanel />);
  const editor = await screen.findByLabelText("Message body");
  editor.textContent = "selected message";
  const range = document.createRange();
  range.selectNodeContents(editor);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  fireEvent.mouseUp(editor);

  const previousExecCommand = document.execCommand;
  const execCommand = jest.fn(() => window.getSelection().toString() === "selected message");
  document.execCommand = execCommand;
  fireEvent.click(screen.getByRole("button", { name: "Bold" }));

  expect(execCommand).toHaveBeenCalledWith("bold", false, "");
  expect(execCommand.mock.results[0].value).toBe(true);
  if (previousExecCommand) document.execCommand = previousExecCommand;
  else delete document.execCommand;
});

test("converts selected newsletter text to a validated link", async () => {
  render(<AdminPromotionsPanel />);
  const editor = await screen.findByLabelText("Message body");
  editor.textContent = "Visit our shop";
  const range = document.createRange();
  range.selectNodeContents(editor);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  fireEvent.mouseUp(editor);

  fireEvent.click(screen.getByRole("button", { name: "Insert link" }));
  fireEvent.change(screen.getByLabelText("Link URL"), {
    target: { value: "https://example.com/shop" }
  });
  fireEvent.click(screen.getByRole("button", { name: "Apply link" }));

  expect(editor.querySelector("a")).toHaveAttribute("href", "https://example.com/shop");
  expect(editor.querySelector("a")).toHaveTextContent("Visit our shop");
  expect(screen.queryByLabelText("Link URL")).not.toBeInTheDocument();

  const linkedRange = document.createRange();
  linkedRange.selectNodeContents(editor.querySelector("a"));
  selection.removeAllRanges();
  selection.addRange(linkedRange);
  fireEvent.mouseUp(editor);
  fireEvent.click(screen.getByRole("button", { name: "Insert link" }));
  fireEvent.change(screen.getByLabelText("Link URL"), {
    target: { value: "https://example.com/new-shop" }
  });
  fireEvent.click(screen.getByRole("button", { name: "Apply link" }));

  expect(editor.querySelectorAll("a")).toHaveLength(1);
  expect(editor.querySelector("a")).toHaveAttribute("href", "https://example.com/new-shop");
  expect(editor.querySelector("a")).toHaveAttribute("target", "_blank");
  expect(editor.querySelector("a")).toHaveAttribute("rel", "noopener noreferrer");
  expect(editor.querySelector("a")).toHaveTextContent("Visit our shop");

  const openWindow = jest.spyOn(window, "open").mockImplementation(() => null);
  selection.removeAllRanges();
  const linkClick = new MouseEvent("click", { bubbles: true, cancelable: true });
  editor.querySelector("a").dispatchEvent(linkClick);
  expect(linkClick.defaultPrevented).toBe(true);
  expect(editor.querySelector("a")).toHaveAttribute("target", "_blank");
  expect(openWindow).toHaveBeenCalledWith(
    "https://example.com/new-shop",
    "_blank",
    "noopener,noreferrer"
  );

  openWindow.mockClear();
  fireEvent.mouseDown(editor.querySelector("a"), { clientX: 10, clientY: 10 });
  fireEvent.mouseMove(editor.querySelector("a"), { clientX: 30, clientY: 10 });
  fireEvent.click(editor.querySelector("a"));
  expect(openWindow).not.toHaveBeenCalled();
  openWindow.mockRestore();
});

test("rejects unsafe newsletter link protocols", async () => {
  render(<AdminPromotionsPanel />);
  fireEvent.click(await screen.findByRole("button", { name: "Insert link" }));
  fireEvent.change(screen.getByLabelText("Link URL"), {
    target: { value: "javascript:alert(1)" }
  });
  fireEvent.click(screen.getByRole("button", { name: "Apply link" }));

  expect(await screen.findByText("Use a link starting with https://, http://, mailto:, or tel:.")).toBeInTheDocument();
  expect(screen.getByLabelText("Link URL")).toBeInTheDocument();
});

test("uploads and saves newsletter attachment references with the campaign", async () => {
  const uploadedAttachment = {
    filename: "123e4567-e89b-42d3-a456-426614174000.pdf",
    name: "newsletter.pdf",
    size: 128
  };
  axios.post.mockImplementation((url) => (
    url.includes("newsletter-attachments")
      ? Promise.resolve({ data: { attachments: [uploadedAttachment] } })
      : Promise.resolve({ data: { queued: 1, campaign: { id: 4 } } })
  ));
  render(<AdminPromotionsPanel />);
  await screen.findByLabelText("Message body");

  fireEvent.change(screen.getByLabelText("Attach files"), {
    target: { files: [new File(["newsletter"], "newsletter.pdf", { type: "application/pdf" })] }
  });
  expect(await screen.findByText("newsletter.pdf")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Draft Newsletter Campaigns" }));

  await waitFor(() => expect(axios.post).toHaveBeenCalledWith(
    expect.stringContaining("/admin/promotions"),
    expect.objectContaining({
      resource: "newsletter",
      action: "draft",
      data: expect.objectContaining({
        attachments: [uploadedAttachment]
      })
    }),
    expect.any(Object)
  ));
});

test("inserts uploaded newsletter images into the body and saves them as inline CID images", async () => {
  const uploadedImage = {
    filename: "123e4567-e89b-42d3-a456-426614174000.png",
    name: "hero.png",
    size: 128,
    contentType: "image/png",
    inline: true,
    cid: "newsletter-123e4567-e89b-42d3-a456-426614174000@newsletter.gfxunlimit"
  };
  const previousCreateObjectURL = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: jest.fn(() => "blob:newsletter-image")
  });
  axios.post.mockImplementation((url) => (
    url.includes("newsletter-attachments")
      ? Promise.resolve({ data: { attachments: [uploadedImage] } })
      : Promise.resolve({ data: { queued: 1, campaign: { id: 4 } } })
  ));
  try {
    render(<AdminPromotionsPanel />);
    const editor = await screen.findByLabelText("Message body");
    fireEvent.change(screen.getByLabelText("Attach files"), {
      target: { files: [new File(["image"], "hero.png", { type: "image/png" })] }
    });

    expect(await within(editor).findByRole("img", { name: "hero.png" })).toHaveAttribute(
      "src",
      "blob:newsletter-image"
    );
    fireEvent.click(screen.getByRole("button", { name: "Draft Newsletter Campaigns" }));

    await waitFor(() => expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining("/admin/promotions"),
      expect.objectContaining({
        resource: "newsletter",
        action: "draft",
        data: expect.objectContaining({
          body: expect.stringContaining(`src="cid:${uploadedImage.cid}"`),
          attachments: [{
            filename: uploadedImage.filename,
            name: uploadedImage.name,
            size: uploadedImage.size,
            cid: uploadedImage.cid
          }]
        })
      }),
      expect.any(Object)
    ));
  } finally {
    if (previousCreateObjectURL) {
      Object.defineProperty(URL, "createObjectURL", previousCreateObjectURL);
    } else {
      delete URL.createObjectURL;
    }
  }
});
