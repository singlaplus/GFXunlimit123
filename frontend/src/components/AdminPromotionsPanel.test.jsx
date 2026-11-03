import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import axios from "axios";
import { getIndiaDateKey } from "../utils/indiaTime";
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

const readCsvBlob = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = reject;
  reader.readAsText(blob);
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

test("shows the requested banner fields and saves Popup targeting and dates", async () => {
  window.localStorage.setItem("adminPromotionsActiveSection", "banners");
  render(<AdminPromotionsPanel />);

  const bannerName = await screen.findByLabelText("Banner Name");
  expect(screen.getByLabelText("Placement")).toHaveValue("left");
  expect(screen.getByLabelText("Sparkle style")).toHaveValue("glitter_burst");
  expect(within(screen.getByLabelText("Sparkle style")).getByRole("option", { name: "Snowfall" })).toHaveValue("snowfall");
  expect(within(screen.getByLabelText("Sparkle style")).getByRole("option", { name: "Shimmer sweep" })).toHaveValue("shimmer_sweep");
  expect(within(screen.getByLabelText("Sparkle style")).getByRole("option", { name: "Fireflies" })).toHaveValue("fireflies");
  expect(within(screen.getByLabelText("Sparkle style")).getByRole("option", { name: "Star trail" })).toHaveValue("star_trail");
  expect(within(screen.getByLabelText("Sparkle style")).getByRole("option", { name: "Pulsing glow" })).toHaveValue("pulsing_glow");
  expect(within(screen.getByLabelText("Sparkle style")).getByRole("option", { name: "Aurora glow" })).toHaveValue("aurora_glow");
  expect(within(screen.getByLabelText("Sparkle style")).getByRole("option", { name: "Confetti sparkles" })).toHaveValue("confetti_sparkles");
  expect(screen.queryByLabelText("Popup audience")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Icon (original dimensions preserved)")).toHaveAttribute("type", "file");
  expect(screen.getByRole("button", { name: "Start date" })).toHaveAttribute("aria-required", "true");
  expect(screen.getByLabelText("End date (optional)")).toBeInTheDocument();
  expect(screen.getByLabelText("Status")).toHaveValue("draft");
  expect(screen.queryByLabelText("Priority")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Schedule")).not.toBeInTheDocument();

  fireEvent.change(bannerName, { target: { value: "Launch banner" } });
  fireEvent.change(screen.getByLabelText("Placement"), { target: { value: "popup" } });
  fireEvent.change(screen.getByLabelText("Popup audience"), { target: { value: "logged_in_customers" } });
  fireEvent.change(screen.getByLabelText("Sparkle style"), { target: { value: "orbiting_sparkles" } });
  fireEvent.click(screen.getByRole("button", { name: "Start date" }));
  fireEvent.click(within(screen.getByRole("dialog", { name: "Start date calendar" })).getByRole("button", { name: "Today" }));
  fireEvent.click(screen.getByRole("button", { name: "End date (optional)" }));
  fireEvent.click(within(screen.getByRole("dialog", { name: "End date (optional) calendar" })).getByRole("button", { name: "Today" }));
  fireEvent.change(screen.getByLabelText("Status"), { target: { value: "active" } });
  const iconFile = new File(["icon"], "launch.png", { type: "image/png" });
  fireEvent.change(screen.getByLabelText("Icon (original dimensions preserved)"), { target: { files: [iconFile] } });

  fireEvent.click(screen.getByRole("button", { name: "Save Promotional Banners" }));

  await waitFor(() => expect(axios.post).toHaveBeenCalledWith(
    expect.stringContaining("/admin/promotions/banners"),
    expect.any(FormData),
    expect.any(Object)
  ));
  const submittedData = axios.post.mock.calls[0][1];
  expect(submittedData.get("name")).toBe("Launch banner");
  expect(submittedData.get("placement")).toBe("popup");
  expect(submittedData.get("popup_audience")).toBe("logged_in_customers");
  expect(submittedData.get("sparkle_style")).toBe("orbiting_sparkles");
  expect(submittedData.get("start_date")).toBe(getIndiaDateKey());
  expect(submittedData.get("end_date")).toBe(getIndiaDateKey());
  expect(submittedData.get("status")).toBe("active");
  expect(submittedData.get("icon")).toBe(iconFile);
  expect(submittedData.get("icon").name).toBe("launch.png");
});

test("edits an existing banner without requiring or replacing its icon", async () => {
  window.localStorage.setItem("adminPromotionsActiveSection", "banners");
  axios.get.mockResolvedValue({
    data: {
      ...promotionData,
      banners: [{
        id: 47,
        name: "Existing campaign",
        placement: "popup",
        status: "active",
        metadata: {
          start_date: "2026-11-05",
          end_date: "2026-11-10",
          popup_audience: "logged_in_customers",
          sparkle_style: "twinkle",
          selected_asset_ids: [21],
          icon_filename: "existing-icon.png"
        }
      }]
    }
  });
  render(<AdminPromotionsPanel />);

  fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
  expect(screen.getByLabelText("Banner Name")).toHaveValue("Existing campaign");
  expect(screen.getByLabelText("Placement")).toHaveValue("popup");
  expect(screen.getByLabelText("Popup audience")).toHaveValue("logged_in_customers");
  expect(screen.getByLabelText("Sparkle style")).toHaveValue("twinkle");
  expect(screen.getByRole("button", { name: "Start date" })).not.toHaveTextContent("Choose a date");
  expect(screen.getByRole("button", { name: "End date (optional)" })).not.toHaveTextContent("Choose a date");
  expect(screen.getByLabelText("Icon (original dimensions preserved)")).not.toBeRequired();
  expect(screen.getByText("existing-icon.png")).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText("Banner Name"), { target: { value: "Updated campaign" } });
  fireEvent.click(screen.getByRole("button", { name: "Update Promotional Banner" }));

  await waitFor(() => expect(axios.post).toHaveBeenCalledWith(
    expect.stringContaining("/admin/promotions/banners"),
    expect.any(FormData),
    expect.any(Object)
  ));
  const submittedData = axios.post.mock.calls[0][1];
  expect(submittedData.get("id")).toBe("47");
  expect(submittedData.get("name")).toBe("Updated campaign");
  expect(submittedData.get("start_date")).toBe("2026-11-05");
  expect(submittedData.get("end_date")).toBe("2026-11-10");
  expect(submittedData.get("icon")).toBeNull();
  expect(await screen.findByText("Banner updated.")).toBeInTheDocument();
});

test("selects live assets from the banner asset picker and saves their ids", async () => {
  window.localStorage.setItem("adminPromotionsActiveSection", "banners");
  axios.get.mockImplementation((url) => {
    if (url.includes("/images?limit=1000&page=1")) {
      return Promise.resolve({
        data: {
          images: [{ id: 21, title: "Mountain lake", category: "Nature", collection: "Travel" }],
          totalImages: 1
        }
      });
    }
    if (url.endsWith("/categories")) return Promise.resolve({ data: [{ id: 1, name: "Nature" }] });
    if (url.endsWith("/collections")) return Promise.resolve({ data: [{ id: 2, name: "Travel" }] });
    return Promise.resolve({ data: promotionData });
  });
  render(<AdminPromotionsPanel />);

  fireEvent.click(await screen.findByRole("button", { name: /^Assets/ }));
  const dialog = await screen.findByRole("dialog", { name: "Choose assets" });
  expect(await within(dialog).findByRole("button", { name: /Mountain lake/ })).toBeInTheDocument();
  expect(within(dialog).getByLabelText("Search live assets")).toBeInTheDocument();
  expect(within(dialog).getByLabelText("Filter assets by category")).toHaveDisplayValue("All categories");
  expect(within(dialog).getByLabelText("Filter assets by collection")).toHaveDisplayValue("All collections");

  fireEvent.click(within(dialog).getByRole("button", { name: /Mountain lake/ }));
  expect(within(dialog).getByRole("button", { name: /Mountain lake/ })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(within(dialog).getByRole("button", { name: "Clear" }));
  expect(within(dialog).getByRole("button", { name: /Mountain lake/ })).toHaveAttribute("aria-pressed", "false");
  fireEvent.click(within(dialog).getByRole("button", { name: /Mountain lake/ }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  expect(screen.getByText("1 live asset selected")).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText("Banner Name"), { target: { value: "Nature feature" } });
  fireEvent.click(screen.getByRole("button", { name: "Start date" }));
  fireEvent.click(within(screen.getByRole("dialog", { name: "Start date calendar" })).getByRole("button", { name: "Today" }));
  fireEvent.change(screen.getByLabelText("Icon (original dimensions preserved)"), {
    target: { files: [new File(["icon"], "nature.png", { type: "image/png" })] }
  });
  fireEvent.click(screen.getByRole("button", { name: /Save Promotional Banners/ }));

  await waitFor(() => expect(axios.post).toHaveBeenCalledWith(
    expect.stringContaining("/admin/promotions/banners"),
    expect.any(FormData),
    expect.any(Object)
  ));
  expect(axios.post.mock.calls[0][1].get("selected_asset_ids")).toBe(JSON.stringify(["21"]));
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

test("shows the selected coupon period totals beside each dropdown", async () => {
  window.localStorage.setItem("adminPromotionsActiveSection", "dashboard");
  axios.get.mockImplementation((url) => Promise.resolve({
    data: url.endsWith("/coupon-analytics")
      ? {
          currencies: ["INR", "USD"],
          rates: { INR: 1, USD: 0.01 },
          analytics: {
            lifetime: { uses: 99, revenue_by_currency: { INR: 12000 } },
            today: { uses: 3, revenue_by_currency: { INR: 1000 } },
            yesterday: { uses: 2, revenue_by_currency: { INR: 500 } },
            last_7_days: { uses: 8, revenue_by_currency: { INR: 2200 } },
            last_30_days: { uses: 12, revenue_by_currency: { INR: 1500.5 } },
            last_quarter: { uses: 42, revenue_by_currency: { INR: 7350.25 } }
          },
          top_coupons: Array.from({ length: 6 }, (_, index) => ({
            id: index + 1,
            name: `Coupon ${index + 1}`,
            code: `SAVE${index + 1}`,
            uses: 6 - index,
            revenue_by_currency: { INR: (6 - index) * 100 },
            last_used_date: "2026-11-02",
            start_at: "2026-10-01",
            end_at: "2026-11-30"
          }))
        }
      : {
          coupons: Array.from({ length: 6 }, (_, index) => ({
            id: index + 1,
            name: `Coupon ${index + 1}`,
            code: `SAVE${index + 1}`,
            coupon_type: "manual",
            discount_type: "percentage",
            discount_value: 10,
            status: "active",
            usage_limit: 25,
            notes: "Full coupon record",
            metadata: { restricted_user_id: 17 }
          }))
        }
  }));

  render(<AdminPromotionsPanel />);

  expect(await screen.findByLabelText("Coupon usage range selector")).toBeInTheDocument();
  expect(screen.getByLabelText("Coupon revenue currency selector")).toHaveValue("INR");
  expect(await screen.findByRole("table", { name: "Top coupons ranked by usage" })).toBeInTheDocument();
  expect(screen.getByText("Coupon 1")).toBeInTheDocument();
  expect(screen.getByText("Coupon 5")).toBeInTheDocument();
  expect(screen.queryByText("Coupon 6")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Export all 6 coupons CSV" })).toBeEnabled();
  await waitFor(() => expect(screen.getByText("12")).toBeInTheDocument(), { timeout: 2000 });
  await waitFor(() => expect(screen.getByText("₹1,000.00")).toBeInTheDocument(), { timeout: 2000 });
  await waitFor(() => expect(screen.getByText("₹1,500.50")).toBeInTheDocument(), { timeout: 2000 });
  const couponsOverview = screen.getByText("Coupons", { selector: ".promotions-card-label" }).closest(".promotions-coupons-overview");
  expect(within(couponsOverview).getAllByText("Lifetime")).toHaveLength(2);
  const usagePanel = couponsOverview.querySelector(".promotions-coupons-panel:nth-child(2)");
  const revenuePanel = couponsOverview.querySelector(".promotions-coupons-panel:nth-child(3)");
  await waitFor(() => expect(within(usagePanel).getByText("Yesterday").parentElement).toHaveTextContent("2"), { timeout: 2000 });
  await waitFor(() => expect(within(revenuePanel).getByText("Yesterday").parentElement).toHaveTextContent("₹500.00"), { timeout: 2000 });
  await waitFor(() => expect(screen.getByText("99")).toBeInTheDocument(), { timeout: 2000 });
  await waitFor(() => expect(screen.getByText("₹12,000.00")).toBeInTheDocument(), { timeout: 2000 });

  fireEvent.change(screen.getByLabelText("Coupon usage range selector"), {
    target: { value: "last_quarter" }
  });
  fireEvent.change(screen.getByLabelText("Coupon revenue range selector"), {
    target: { value: "last_quarter" }
  });

  await waitFor(() => expect(screen.getByText("42")).toBeInTheDocument(), { timeout: 2000 });
  await waitFor(() => expect(screen.getByText("₹7,350.25")).toBeInTheDocument(), { timeout: 2000 });

  fireEvent.change(screen.getByLabelText("Coupon revenue currency selector"), {
    target: { value: "USD" }
  });
  await waitFor(() => expect(screen.getByText("$73.50")).toBeInTheDocument(), { timeout: 2000 });

  const previousCreateObjectURL = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
  const previousRevokeObjectURL = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
  let downloadedCsv;
  const anchorClick = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function click() {
    expect(["coupons.csv", "coupons-used.csv", "coupon-revenue.csv"]).toContain(this.download);
  });
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: jest.fn((blob) => {
      downloadedCsv = blob;
      return "blob:coupon-export";
    })
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: jest.fn()
  });
  try {
    fireEvent.click(screen.getByRole("button", { name: "Export all 6 coupons CSV" }));
    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.objectContaining({ type: "text/csv;charset=utf-8" }));
    expect(anchorClick).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:coupon-export");
    const couponsCsv = await readCsvBlob(downloadedCsv);
    expect(couponsCsv).toContain("Last used date (IST)");
    expect(couponsCsv).toContain("Start date");
    expect(couponsCsv).toContain("End date");
    expect(couponsCsv).toContain("Coupon 1");
    expect(couponsCsv).toContain("Coupon 6");
    expect(couponsCsv).toContain("2026-11-02");
    expect(couponsCsv).toContain("2026-10-01");
    expect(couponsCsv).toContain("2026-11-30");
    expect(couponsCsv).toContain("Coupon: usage_limit");
    expect(couponsCsv).toContain("Coupon: metadata");
    expect(couponsCsv).toContain('"25"');
    expect(couponsCsv).toContain('""restricted_user_id"":17');

    fireEvent.click(screen.getByRole("button", { name: "Export coupons used CSV" }));
    const usedCsv = await readCsvBlob(downloadedCsv);
    expect(usedCsv).toContain("Last used date (IST)");
    expect(usedCsv).toContain("Coupon 6");
    expect(usedCsv).toContain("Coupon: notes");
    expect(usedCsv).toContain("Full coupon record");
    expect(anchorClick).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("button", { name: "Export revenue generated CSV" }));
    const revenueCsv = await readCsvBlob(downloadedCsv);
    expect(revenueCsv).toContain("Revenue (USD)");
    expect(revenueCsv).toContain("2026-11-02");
    expect(revenueCsv).toContain("Revenue analytics: revenue_by_currency");
    expect(revenueCsv).toContain('""INR"":100');
    expect(anchorClick).toHaveBeenCalledTimes(3);
  } finally {
    anchorClick.mockRestore();
    if (previousCreateObjectURL) Object.defineProperty(URL, "createObjectURL", previousCreateObjectURL);
    else delete URL.createObjectURL;
    if (previousRevokeObjectURL) Object.defineProperty(URL, "revokeObjectURL", previousRevokeObjectURL);
    else delete URL.revokeObjectURL;
  }
});

test("top coupon and contributor offer exports remain available when there are no rows", async () => {
  window.localStorage.setItem("adminPromotionsActiveSection", "dashboard");
  axios.get.mockImplementation((url) => Promise.resolve({
    data: url.endsWith("/coupon-analytics")
      ? {
          currencies: ["INR"],
          rates: { INR: 1 },
          analytics: {},
          top_coupons: []
        }
      : { campaigns: [], contributor_applications: [] }
  }));
  const previousCreateObjectURL = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
  const previousRevokeObjectURL = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
  let downloadedCsv;
  const anchorClick = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: jest.fn((blob) => {
      downloadedCsv = blob;
      return "blob:empty-export";
    })
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: jest.fn()
  });
  try {
    render(<AdminPromotionsPanel />);
    expect(await screen.findByRole("table", { name: "Top coupons ranked by usage" })).toBeInTheDocument();
    expect(await screen.findByRole("table", { name: "Top contributor offers ranked by applications" })).toBeInTheDocument();
    const couponsExport = screen.getByRole("button", { name: "Export all 0 coupons CSV" });
    const offersExport = screen.getByRole("button", { name: "Export all 0 contributor offers CSV" });
    expect(couponsExport).toBeEnabled();
    expect(offersExport).toBeEnabled();

    fireEvent.click(couponsExport);
    expect(await readCsvBlob(downloadedCsv)).toContain("Coupon name");
    fireEvent.click(offersExport);
    expect(await readCsvBlob(downloadedCsv)).toContain("Offer name");
    expect(anchorClick).toHaveBeenCalledTimes(2);
  } finally {
    anchorClick.mockRestore();
    if (previousCreateObjectURL) Object.defineProperty(URL, "createObjectURL", previousCreateObjectURL);
    else delete URL.createObjectURL;
    if (previousRevokeObjectURL) Object.defineProperty(URL, "revokeObjectURL", previousRevokeObjectURL);
    else delete URL.revokeObjectURL;
  }
});

test("shows Flash Sales configuration analytics and exports every flash sale", async () => {
  window.localStorage.setItem("adminPromotionsActiveSection", "dashboard");
  const today = getIndiaDateKey();
  const shiftDate = (days) => {
    const [year, month, day] = today.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
  };
  const flashSales = [
    {
      id: 1,
      name: "Homepage percentage",
      status: "running",
      discount_rule: "percentage",
      featured_placement: "homepage",
      start_date: today,
      end_date: shiftDate(2),
      applications: 35,
      users_used: 30,
      assets_downloaded: 300,
      metadata: { discount_value: 20 },
      usage_details: Array.from({ length: 30 }, (_, index) => ({
        user_id: index + 1,
        username: `buyer${index + 1}`,
        full_name: `Buyer ${index + 1}`,
        email: `buyer${index + 1}@example.com`,
        uses: index === 0 ? 6 : 1,
        assets_downloaded: 10
      }))
    },
    { id: 2, name: "Category BOGO", status: "running", discount_rule: "BOGO", featured_placement: "category", start_date: today, end_date: shiftDate(2), applications: 25, users_used: 20, assets_downloaded: 200, metadata: { featured_category_id: "all", keywords: "spring" } },
    { id: 3, name: "Collection fixed", status: "scheduled", discount_rule: "fixed_amount", featured_placement: "collection", start_date: shiftDate(1), end_date: shiftDate(3), applications: 10, users_used: 10, assets_downloaded: 100, metadata: { discount_value: 100, featured_collection_id: "7" } },
    { id: 4, name: "Homepage BOG2", status: "scheduled", discount_rule: "BOG2", featured_placement: "homepage", start_date: shiftDate(1), end_date: shiftDate(3), applications: 8, users_used: 8, assets_downloaded: 80, metadata: {} },
    { id: 5, name: "Category BOG3", status: "expired", discount_rule: "BOG3", featured_placement: "category", start_date: shiftDate(-4), end_date: shiftDate(-1), applications: 5, users_used: 5, assets_downloaded: 50, metadata: { featured_category_id: "9" } },
    { id: 6, name: "Collection fixed expired", status: "expired", discount_rule: "fixed_amount", featured_placement: "collection", start_date: shiftDate(-4), end_date: shiftDate(-1), applications: 0, users_used: 0, assets_downloaded: 0, metadata: { discount_value: 50 } }
  ];
  axios.get.mockImplementation((url) => Promise.resolve({
    data: url.endsWith("/coupon-analytics")
      ? {
          currencies: ["INR"],
          rates: { INR: 1 },
          analytics: {},
          top_coupons: []
        }
      : { campaigns: [], contributor_applications: [], flash_sales: flashSales }
  }));
  const previousCreateObjectURL = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
  const previousRevokeObjectURL = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
  let downloadedCsv;
  const anchorClick = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: jest.fn((blob) => {
      downloadedCsv = blob;
      return "blob:flash-sales-export";
    })
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: jest.fn()
  });
  try {
    render(<AdminPromotionsPanel />);

    expect(await screen.findByRole("table", { name: "Flash sales ordered by usage" })).toBeInTheDocument();
    const flashOverview = document.querySelector(".promotions-flash-overview");
    const statusesPanel = flashOverview.querySelector(".promotions-coupons-panel:nth-child(1)");
    await waitFor(() => expect(within(statusesPanel).getByText("Active").parentElement).toHaveTextContent("2"), { timeout: 2000 });
    expect(within(statusesPanel).getByText("Scheduled").parentElement).toHaveTextContent("2");
    expect(within(statusesPanel).getByText("Expired").parentElement).toHaveTextContent("2");
    const discountPanel = flashOverview.querySelector(".promotions-coupons-panel:nth-child(2)");
    expect(within(discountPanel).getByText("Percentage").parentElement).toHaveTextContent("1");
    expect(within(discountPanel).getByText("Fixed Amount").parentElement).toHaveTextContent("2");
    expect(within(discountPanel).getByText("BOGO — Buy One Get One").parentElement).toHaveTextContent("1");
    const placementPanel = flashOverview.querySelector(".promotions-coupons-panel:nth-child(3)");
    expect(within(placementPanel).getByText("Homepage").parentElement).toHaveTextContent("2");
    expect(within(placementPanel).getByText("Category").parentElement).toHaveTextContent("2");
    expect(within(placementPanel).getByText("Collection").parentElement).toHaveTextContent("2");
    const topFlashSalesTable = screen.getByRole("table", { name: "Flash sales ordered by usage" });
    const topFlashSalesRows = within(topFlashSalesTable).getAllByRole("row");
    expect(topFlashSalesRows).toHaveLength(6);
    await waitFor(() => {
      expect(topFlashSalesRows[1]).toHaveTextContent("Homepage percentage");
      expect(topFlashSalesRows[1]).toHaveTextContent("35");
      expect(topFlashSalesRows[1]).toHaveTextContent("30");
      expect(topFlashSalesRows[1]).toHaveTextContent("300");
    }, { timeout: 2000 });
    expect(topFlashSalesRows[5]).toHaveTextContent("Category BOG3");
    expect(within(topFlashSalesTable).queryByText("Collection fixed expired")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Export all 6 flash sales CSV" }));
    const allSalesCsv = await readCsvBlob(downloadedCsv);
    expect(allSalesCsv).toContain("Discount value");
    expect(allSalesCsv).toContain("Featured category ID");
    expect(allSalesCsv).toContain("Featured collection ID");
    expect(allSalesCsv).toContain("Homepage percentage");
    expect(allSalesCsv).toContain("Users used");
    expect(allSalesCsv).toContain("Assets downloaded");
    expect(allSalesCsv).toContain("Applications");
    expect(allSalesCsv).toContain('"Homepage percentage","active","35","30","300"');
    expect(allSalesCsv).toContain('"20"');
    expect(allSalesCsv).toContain("spring");
    expect(allSalesCsv).toContain("Homepage BOG2");
    expect(allSalesCsv).toContain("Flash sale: id");
    expect(allSalesCsv).toContain("Flash sale: metadata");
    expect(allSalesCsv).toContain("User ID");
    expect(allSalesCsv).toContain("Username");
    expect(allSalesCsv).toContain("Times used");
    expect(allSalesCsv).toContain("Assets downloaded");
    expect(allSalesCsv).toContain('"1","buyer1","Buyer 1","buyer1@example.com","6","10"');

    fireEvent.click(screen.getByRole("button", { name: "Export flash sale statuses CSV" }));
    const statusesCsv = await readCsvBlob(downloadedCsv);
    expect(statusesCsv).toContain('"Flash sale","Status","Start date","End date"');
    expect(statusesCsv).toContain("Flash sale: id");
    expect(statusesCsv).toContain('"buyer1","Buyer 1","buyer1@example.com","6","10"');
    fireEvent.click(screen.getByRole("button", { name: "Export flash sale discount rules CSV" }));
    const discountRulesCsv = await readCsvBlob(downloadedCsv);
    expect(discountRulesCsv).toContain("Discount details");
    expect(discountRulesCsv).toContain('"buyer1","Buyer 1","buyer1@example.com","6","10"');
    fireEvent.click(screen.getByRole("button", { name: "Export flash sale placements CSV" }));
    const placementsCsv = await readCsvBlob(downloadedCsv);
    expect(placementsCsv).toContain("Placement");
    expect(placementsCsv).toContain('"buyer1","Buyer 1","buyer1@example.com","6","10"');
    expect(anchorClick).toHaveBeenCalledTimes(4);
  } finally {
    anchorClick.mockRestore();
    if (previousCreateObjectURL) Object.defineProperty(URL, "createObjectURL", previousCreateObjectURL);
    else delete URL.createObjectURL;
    if (previousRevokeObjectURL) Object.defineProperty(URL, "revokeObjectURL", previousRevokeObjectURL);
    else delete URL.revokeObjectURL;
  }
});

test("shows Bundle Discounts analytics and exports full bundle and user usage details", async () => {
  window.localStorage.setItem("adminPromotionsActiveSection", "dashboard");
  const today = getIndiaDateKey();
  const shiftDate = (days) => {
    const [year, month, day] = today.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
  };
  const bundles = [
    {
      id: 11,
      name: "Asset bundle",
      status: "active",
      applications: 6,
      users_used: 2,
      assets_downloaded: 7,
      created_at: `${today}T00:00:00.000Z`,
      metadata: {
        start_date: today,
        end_date: shiftDate(10),
        discount_tiers: [
          { asset_count: 3, discount_percent: 10 },
          { asset_count: 5, discount_percent: 20 }
        ]
      },
      usage_details: [
        { user_id: 7, username: "buyer-one", full_name: "Buyer One", email: "one@example.com", uses: 4, assets_downloaded: 4 },
        { user_id: 8, username: "buyer-two", full_name: "Buyer Two", email: "two@example.com", uses: 2, assets_downloaded: 3 }
      ]
    },
    {
      id: 12,
      name: "Scheduled bundle",
      status: "active",
      applications: 0,
      users_used: 0,
      assets_downloaded: 0,
      metadata: { start_date: shiftDate(1), end_date: shiftDate(5), discount_tiers: [{ asset_count: 4, discount_percent: 15 }] },
      usage_details: []
    },
    {
      id: 13,
      name: "Expired bundle",
      status: "active",
      metadata: { start_date: shiftDate(-5), end_date: shiftDate(-1), discount_tiers: [] },
      usage_details: []
    },
    {
      id: 14,
      name: "Draft bundle",
      status: "draft",
      metadata: { start_date: shiftDate(1), end_date: null, discount_tiers: [{ asset_count: 6, discount_percent: 25 }] },
      usage_details: []
    }
  ];
  axios.get.mockImplementation((url) => Promise.resolve({
    data: url.endsWith("/coupon-analytics")
      ? { currencies: ["INR"], rates: { INR: 1 }, analytics: {}, top_coupons: [] }
      : { campaigns: [], contributor_applications: [], flash_sales: [], bundles }
  }));
  const previousCreateObjectURL = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
  const previousRevokeObjectURL = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
  let downloadedCsv;
  const anchorClick = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: jest.fn((blob) => {
      downloadedCsv = blob;
      return "blob:bundle-export";
    })
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: jest.fn()
  });
  try {
    render(<AdminPromotionsPanel />);

    expect(await screen.findByRole("table", { name: "Bundle discounts ordered by usage" })).toBeInTheDocument();
    const bundleOverview = document.querySelector(".promotions-bundle-overview");
    const statusPanel = bundleOverview.querySelector(".promotions-coupons-panel:nth-child(1)");
    await waitFor(() => expect(within(statusPanel).getByText("Active").parentElement).toHaveTextContent("1"));
    expect(within(statusPanel).getByText("Scheduled").parentElement).toHaveTextContent("1");
    expect(within(statusPanel).getByText("Expired").parentElement).toHaveTextContent("1");
    expect(within(statusPanel).getByText("Draft").parentElement).toHaveTextContent("1");
    expect(within(bundleOverview).getByText("3 assets · 10%").parentElement).toHaveTextContent("1");
    const topBundlesTable = screen.getByRole("table", { name: "Bundle discounts ordered by usage" });
    const topRows = within(topBundlesTable).getAllByRole("row");
    await waitFor(() => {
      expect(topRows[1]).toHaveTextContent("Asset bundle");
      expect(topRows[1]).toHaveTextContent("6");
      expect(topRows[1]).toHaveTextContent("2");
      expect(topRows[1]).toHaveTextContent("7");
    });

    fireEvent.click(screen.getByRole("button", { name: "Export bundle discount statuses CSV" }));
    const statusesCsv = await readCsvBlob(downloadedCsv);
    expect(statusesCsv).toContain('"Bundle discount","Status","Start date","End date","User ID"');
    expect(statusesCsv).toContain('"7","buyer-one","Buyer One","one@example.com","4","4"');
    expect(statusesCsv).toContain('"Scheduled bundle","scheduled"');

    fireEvent.click(screen.getByRole("button", { name: "Export bundle discount tiers CSV" }));
    const tiersCsv = await readCsvBlob(downloadedCsv);
    expect(tiersCsv).toContain('"Bundle discount","Discount tiers"');
    expect(tiersCsv).toContain('"Asset bundle","3 assets: 10%; 5 assets: 20%"');
    expect(tiersCsv).toContain('"buyer-two","Buyer Two","two@example.com","2","3"');

    fireEvent.click(screen.getByRole("button", { name: "Export all 4 bundle discounts CSV" }));
    const allBundlesCsv = await readCsvBlob(downloadedCsv);
    expect(allBundlesCsv).toContain('"Bundle discount","Status","Applications","Users used","Assets downloaded"');
    expect(allBundlesCsv).toContain('"6","2","7"');
    expect(allBundlesCsv).toContain("Bundle discount: metadata");
    expect(allBundlesCsv).toContain('"buyer-one","Buyer One","one@example.com","4","4"');
    expect(allBundlesCsv).toContain("Expired bundle");
    expect(anchorClick).toHaveBeenCalledTimes(3);
  } finally {
    anchorClick.mockRestore();
    if (previousCreateObjectURL) Object.defineProperty(URL, "createObjectURL", previousCreateObjectURL);
    else delete URL.createObjectURL;
    if (previousRevokeObjectURL) Object.defineProperty(URL, "revokeObjectURL", previousRevokeObjectURL);
    else delete URL.revokeObjectURL;
  }
});

test("shows newsletter campaign status, audience, engagement, and full CSV details", async () => {
  window.localStorage.setItem("adminPromotionsActiveSection", "dashboard");
  const newsletters = [
    {
      id: 21,
      name: "Spring launch",
      subject: "New collection",
      status: "sent",
      audience: "all",
      body: "<p>Spring launch</p>",
      recipients: ["one@example.com", "two@example.com"],
      attachments: [{ filename: "launch.pdf" }],
      sent_at: "2026-11-03T10:00:00.000Z",
      queued_recipients: 2,
      sent_recipients: 1,
      opened_recipients: 1,
      clicked_recipients: 1,
      recipient_details: [
        {
          id: 101,
          recipient: "one@example.com",
          status: "queued",
          opened_at: "2026-11-03T10:10:00.000Z",
          clicked_at: "2026-11-03T10:12:00.000Z",
          metadata: { job_id: "job-101" }
        },
        { id: 102, recipient: "two@example.com", status: "queued", opened_at: null, clicked_at: null, metadata: { job_id: "job-102" } }
      ],
      created_at: "2026-11-02T10:00:00.000Z"
    },
    {
      id: 22,
      name: "Contributor update",
      subject: "Offer available",
      status: "scheduled",
      audience: "contributor_active",
      recipients: ["creator@example.com"],
      schedule: "2026-11-05T08:30:00.000Z",
      scheduled_at: "2026-11-05T08:30:00.000Z",
      queued_recipients: 0,
      recipient_details: []
    },
    {
      id: 23,
      name: "Retry campaign",
      status: "draft",
      audience: "customer_active",
      recipients: ["retry@example.com"],
      metadata: { delivery_error: "SMTP unavailable" },
      queued_recipients: 0,
      recipient_details: []
    }
  ];
  axios.get.mockImplementation((url) => Promise.resolve({
    data: url.endsWith("/coupon-analytics")
      ? { currencies: ["INR"], rates: { INR: 1 }, analytics: {}, top_coupons: [] }
      : { campaigns: [], contributor_applications: [], flash_sales: [], bundles: [], newsletters }
  }));
  const previousCreateObjectURL = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
  const previousRevokeObjectURL = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
  let downloadedCsv;
  const anchorClick = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: jest.fn((blob) => {
      downloadedCsv = blob;
      return "blob:newsletter-export";
    })
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: jest.fn()
  });
  try {
    render(<AdminPromotionsPanel />);

    expect(await screen.findByRole("table", { name: "Newsletter campaigns ranked by recipients" })).toBeInTheDocument();
    const newsletterOverview = document.querySelector(".promotions-newsletter-overview");
    const statusPanel = newsletterOverview.querySelector(".promotions-coupons-panel:nth-child(1)");
    await waitFor(() => {
      expect(within(statusPanel).getByText("Sent").parentElement).toHaveTextContent("1");
      expect(within(statusPanel).getByText("Scheduled").parentElement).toHaveTextContent("1");
      expect(within(statusPanel).getByText("Failed").parentElement).toHaveTextContent("1");
    });
    const audiencePanel = newsletterOverview.querySelector(".promotions-coupons-panel:nth-child(2)");
    await waitFor(() => {
      expect(within(audiencePanel).getByText("All customers and contributors").parentElement).toHaveTextContent("2");
      expect(within(audiencePanel).getByText("Queued").parentElement).toHaveTextContent("2");
      expect(within(audiencePanel).getByText("Opened").parentElement).toHaveTextContent("1");
      expect(within(audiencePanel).getByText("Clicked").parentElement).toHaveTextContent("1");
    });
    const newsletterRows = within(screen.getByRole("table", { name: "Newsletter campaigns ranked by recipients" })).getAllByRole("row");
    await waitFor(() => expect(newsletterRows[1]).toHaveTextContent("Spring launch"));
    expect(newsletterRows[1]).toHaveTextContent("2");
    expect(newsletterRows[1]).toHaveTextContent("1");

    fireEvent.click(screen.getByRole("button", { name: "Export newsletter campaign statuses CSV" }));
    const statusesCsv = await readCsvBlob(downloadedCsv);
    expect(statusesCsv).toContain('"Campaign","Subject","Status","Audience","Recipients"');
    expect(statusesCsv).toContain('"Retry campaign","","failed"');
    expect(statusesCsv).toContain("Newsletter campaign: body");
    expect(statusesCsv).toContain("one@example.com");

    fireEvent.click(screen.getByRole("button", { name: "Export newsletter campaign audiences CSV" }));
    const audiencesCsv = await readCsvBlob(downloadedCsv);
    expect(audiencesCsv).toContain('"Audience","Campaigns","Recipients"');
    expect(audiencesCsv).toContain('"All customers and contributors","1","2"');
    expect(audiencesCsv).toContain('"Contributor active","1","1"');

    fireEvent.click(screen.getByRole("button", { name: "Export all 3 newsletter campaigns CSV" }));
    const allNewslettersCsv = await readCsvBlob(downloadedCsv);
    expect(allNewslettersCsv).toContain('"Campaign","Subject","Status","Audience","Recipients","Queued","Sent","Opened","Clicked"');
    expect(allNewslettersCsv).toContain("Recipient email");
    expect(allNewslettersCsv).toContain("Recipient delivery: metadata");
    expect(allNewslettersCsv).toContain('"Spring launch","New collection","sent","all","2","2","1","1","1"');
    expect(allNewslettersCsv).toContain("SMTP unavailable");
    expect(allNewslettersCsv).toContain("job-101");
    expect(anchorClick).toHaveBeenCalledTimes(3);
  } finally {
    anchorClick.mockRestore();
    if (previousCreateObjectURL) Object.defineProperty(URL, "createObjectURL", previousCreateObjectURL);
    else delete URL.createObjectURL;
    if (previousRevokeObjectURL) Object.defineProperty(URL, "revokeObjectURL", previousRevokeObjectURL);
    else delete URL.revokeObjectURL;
  }
});

test("shows promotional banner configuration, derived statuses, and full CSV details", async () => {
  window.localStorage.setItem("adminPromotionsActiveSection", "dashboard");
  const banners = [
    {
      id: 31,
      name: "Popup launch",
      placement: "popup",
      status: "active",
      created_at: "2026-11-03T10:00:00.000Z",
      metadata: {
        start_date: "2026-11-01",
        end_date: "2026-11-30",
        popup_audience: "logged_in_customers",
        sparkle_style: "twinkle",
        selected_asset_ids: [21, 22],
        icon_filename: "launch-icon.png"
      }
    },
    {
      id: 32,
      name: "Scheduled banner",
      placement: "left",
      status: "active",
      metadata: { start_date: "2999-01-01", sparkle_style: "none", selected_asset_ids: [] }
    },
    {
      id: 33,
      name: "Expired banner",
      placement: "right",
      status: "active",
      metadata: { start_date: "2020-01-01", end_date: "2020-12-31", sparkle_style: "snowfall" }
    },
    {
      id: 34,
      name: "Draft banner",
      placement: "up",
      status: "draft",
      metadata: { sparkle_style: "glitter_burst" }
    }
  ];
  axios.get.mockImplementation((url) => Promise.resolve({
    data: url.endsWith("/coupon-analytics")
      ? { currencies: ["INR"], rates: { INR: 1 }, analytics: {}, top_coupons: [] }
      : { campaigns: [], contributor_applications: [], flash_sales: [], bundles: [], newsletters: [], banners }
  }));
  const previousCreateObjectURL = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
  const previousRevokeObjectURL = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
  let downloadedCsv;
  const anchorClick = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: jest.fn((blob) => {
      downloadedCsv = blob;
      return "blob:banner-export";
    })
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: jest.fn()
  });
  try {
    render(<AdminPromotionsPanel />);

    expect(await screen.findByRole("table", { name: "Recent promotional banners" })).toBeInTheDocument();
    const bannerOverview = document.querySelector(".promotions-banner-overview");
    const statusPanel = bannerOverview.querySelector(".promotions-coupons-panel:nth-child(1)");
    await waitFor(() => {
      expect(within(statusPanel).getByText("Active").parentElement).toHaveTextContent("1");
      expect(within(statusPanel).getByText("Scheduled").parentElement).toHaveTextContent("1");
      expect(within(statusPanel).getByText("Expired").parentElement).toHaveTextContent("1");
      expect(within(statusPanel).getByText("Draft").parentElement).toHaveTextContent("1");
    });
    expect(within(bannerOverview).getByText("logged in customers").parentElement).toHaveTextContent("1");
    const bannerRows = within(screen.getByRole("table", { name: "Recent promotional banners" })).getAllByRole("row");
    await waitFor(() => {
      expect(bannerRows[1]).toHaveTextContent("Popup launch");
      expect(bannerRows[1]).toHaveTextContent("2");
    });

    fireEvent.click(screen.getByRole("button", { name: "Export promotional banner statuses CSV" }));
    const statusesCsv = await readCsvBlob(downloadedCsv);
    expect(statusesCsv).toContain('"Banner","Status","Placement","Start date","End date"');
    expect(statusesCsv).toContain('"Scheduled banner","scheduled","Left"');
    expect(statusesCsv).toContain("Promotional banner: metadata");

    fireEvent.click(screen.getByRole("button", { name: "Export all 4 promotional banners CSV" }));
    const allBannersCsv = await readCsvBlob(downloadedCsv);
    expect(allBannersCsv).toContain('"Banner","Status","Placement","Popup audience","Sparkle style","Icon filename","Linked live assets"');
    expect(allBannersCsv).toContain('"Popup launch","active","Popup","logged_in_customers","Twinkle","launch-icon.png","21, 22"');
    expect(allBannersCsv).toContain("Promotional banner: metadata");
    expect(allBannersCsv).toContain("selected_asset_ids");
    expect(anchorClick).toHaveBeenCalledTimes(2);
  } finally {
    anchorClick.mockRestore();
    if (previousCreateObjectURL) Object.defineProperty(URL, "createObjectURL", previousCreateObjectURL);
    else delete URL.createObjectURL;
    if (previousRevokeObjectURL) Object.defineProperty(URL, "revokeObjectURL", previousRevokeObjectURL);
    else delete URL.revokeObjectURL;
  }
});

test("shows Contributor Offers analytics and the five most-used offers on the dashboard", async () => {
  window.localStorage.setItem("adminPromotionsActiveSection", "dashboard");
  const today = getIndiaDateKey();
  const timestamp = new Date(`${today}T12:00:00+05:30`).toISOString();
  const campaigns = Array.from({ length: 6 }, (_, index) => ({
    id: index + 1,
    name: `Contributor offer ${index + 1}`,
    objective: index === 0 ? "Upload milestone offer" : "",
    status: ["active", "scheduled", "expired", "draft", "active", "scheduled"][index],
    start_date: "2026-10-01",
    end_date: "2026-11-30",
    ...(index === 0 ? {
      metadata: {
        benefit_type: "bonus_payout",
        benefit_value: "250",
        eligibility_scope: "selected",
        eligible_contributors: ["contributor-1", "contributor-2"],
        eligibility_requirements: "uploads",
        eligibility_requirement_value: "10"
      }
    } : {})
  }));
  const contributorApplications = campaigns.flatMap((offer, index) => (
    Array.from({ length: campaigns.length - index }, (_, applicationIndex) => ({
      id: `${offer.id}-${applicationIndex}`,
      offer_id: offer.id,
      offer_name: offer.name,
      contributor_id: applicationIndex + 1,
      username: `contributor-${applicationIndex + 1}`,
      status: "completed",
      created_at: offer.id === 1 && applicationIndex === 0
        ? new Date(Date.parse(timestamp) - 24 * 60 * 60 * 1000).toISOString()
        : timestamp,
      benefit_approved: true,
      benefit_approved_at: offer.id === 1 && applicationIndex === 0
        ? new Date(Date.parse(timestamp) - 24 * 60 * 60 * 1000).toISOString()
        : timestamp,
      progress_count: applicationIndex < 3 ? 10 : 4,
      paid_amount: 10
    }))
  ));
  axios.get.mockImplementation((url) => Promise.resolve({
    data: url.endsWith("/coupon-analytics")
      ? {
          currencies: ["INR", "USD"],
          rates: { INR: 1, USD: 0.01 },
          analytics: {},
          top_coupons: []
        }
      : { campaigns, contributor_applications: contributorApplications }
  }));

  render(<AdminPromotionsPanel />);

  expect(await screen.findByRole("table", { name: "Top contributor offers ranked by applications" })).toBeInTheDocument();
  const statusPanel = screen.getByText("Offer statuses").closest(".promotions-coupons-panel");
  await waitFor(() => expect(within(statusPanel).getByText("Active").parentElement).toHaveTextContent("2"), { timeout: 2000 });
  expect(within(statusPanel).getByText("Scheduled").parentElement).toHaveTextContent("2");
  expect(within(statusPanel).getByText("Ended").parentElement).toHaveTextContent("1");
  expect(within(statusPanel).getByText("Draft").parentElement).toHaveTextContent("1");

  expect(screen.getByLabelText("Contributor application range selector")).toBeInTheDocument();
  expect(screen.getByLabelText("Contributor benefits range selector")).toBeInTheDocument();
  const contributorOverview = screen.getByText("Contributor Offers", { selector: ".promotions-card-label" }).closest(".promotions-contributor-overview");
  const applicationsPanel = contributorOverview.querySelector(".promotions-coupons-panel:nth-child(2)");
  const benefitsPanel = contributorOverview.querySelector(".promotions-coupons-panel:nth-child(3)");
  await waitFor(() => expect(within(applicationsPanel).getByText("Yesterday").parentElement).toHaveTextContent("1"), { timeout: 2000 });
  await waitFor(() => expect(within(benefitsPanel).getByText("Yesterday").parentElement).toHaveTextContent("₹10.00"), { timeout: 2000 });
  const benefitsCurrencySelector = within(benefitsPanel).getByLabelText("Contributor benefits currency selector");
  expect(benefitsCurrencySelector).toHaveValue("INR");
  fireEvent.change(benefitsCurrencySelector, { target: { value: "USD" } });
  await waitFor(() => expect(within(benefitsPanel).getByText("Yesterday").parentElement).toHaveTextContent("$0.10"), { timeout: 2000 });
  expect(screen.getByText("Contributor offer 1")).toBeInTheDocument();
  expect(screen.getByText("Contributor offer 5")).toBeInTheDocument();
  expect(screen.queryByText("Contributor offer 6")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Export all 6 contributor offers CSV" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Export contributor applications CSV" })).toBeEnabled();

  const previousCreateObjectURL = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
  const previousRevokeObjectURL = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
  let downloadedCsv;
  const anchorClick = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: jest.fn((blob) => {
      downloadedCsv = blob;
      return "blob:contributor-export";
    })
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: jest.fn()
  });
  try {
    fireEvent.click(screen.getByRole("button", { name: "Export all 6 contributor offers CSV" }));
    const offersCsv = await readCsvBlob(downloadedCsv);
    expect(offersCsv).toContain("Description");
    expect(offersCsv).toContain("Benefit type");
    expect(offersCsv).toContain("Benefit value");
    expect(offersCsv).toContain("Eligibility requirements");
    expect(offersCsv).toContain("Eligible contributors");
    expect(offersCsv).toContain("Eligibility requirement value");
    expect(offersCsv).toContain("Eligibility requirements achieved");
    expect(offersCsv).toContain("Upload milestone offer");
    expect(offersCsv).toContain("bonus_payout");
    expect(offersCsv).toContain("250");
    expect(offersCsv).toContain("uploads");
    expect(offersCsv).toContain("contributor-1, contributor-2");
    expect(offersCsv).toContain('"contributor-1, contributor-2","10","3/6 contributors"');
    expect(offersCsv).toContain("Start date");
    expect(offersCsv).toContain("End date");
    expect(offersCsv).toContain("Last used date (IST)");
    expect(offersCsv).toContain("Contributor offer 1");
    expect(offersCsv).toContain("Contributor offer 6");
    expect(offersCsv).toContain("2026-10-01");
    expect(offersCsv).toContain("2026-11-30");
    expect(offersCsv).toContain(today);
    expect(offersCsv).toContain("Contributor offer: id");
    expect(offersCsv).toContain("Contributor offer: metadata");

    fireEvent.click(screen.getByRole("button", { name: "Export contributor applications CSV" }));
    const applicationsCsv = await readCsvBlob(downloadedCsv);
    expect(applicationsCsv).toContain("Description");
    expect(applicationsCsv).toContain("Benefit type");
    expect(applicationsCsv).toContain("Benefit value");
    expect(applicationsCsv).toContain("Eligibility requirements");
    expect(applicationsCsv).toContain("Eligible contributors");
    expect(applicationsCsv).toContain("Eligibility requirement value");
    expect(applicationsCsv).toContain("Eligibility requirements achieved");
    expect(applicationsCsv).toContain('"Upload milestone offer","bonus_payout","250","uploads","contributor-1, contributor-2","10","10/10 uploads"');
    expect(applicationsCsv).toContain("Offer start date");
    expect(applicationsCsv).toContain("Offer end date");
    expect(applicationsCsv).toContain("Offer used date (IST)");
    expect(applicationsCsv).toContain("2026-10-01");
    expect(applicationsCsv).toContain("2026-11-30");
    expect(applicationsCsv).toContain(today);
    expect(applicationsCsv).toContain("Application: progress_count");
    expect(applicationsCsv).toContain("Contributor offer: metadata");

    fireEvent.click(screen.getByRole("button", { name: "Export contributor benefits paid CSV" }));
    const benefitsCsv = await readCsvBlob(downloadedCsv);
    expect(benefitsCsv).toContain("Description");
    expect(benefitsCsv).toContain("Benefit type");
    expect(benefitsCsv).toContain("Benefit value");
    expect(benefitsCsv).toContain("Eligibility requirements");
    expect(benefitsCsv).toContain("Eligible contributors");
    expect(benefitsCsv).toContain("Eligibility requirement value");
    expect(benefitsCsv).toContain("Eligibility requirements achieved");
    expect(benefitsCsv).toContain('"Upload milestone offer","bonus_payout","250","uploads","contributor-1, contributor-2","10","10/10 uploads"');
    expect(benefitsCsv).toContain("Offer used date (IST)");
    expect(benefitsCsv).toContain("Approved date");
    expect(benefitsCsv).toContain("Offer start date");
    expect(benefitsCsv).toContain("Offer end date");
    expect(benefitsCsv).toContain("Benefits paid (USD)");
    expect(benefitsCsv).toContain("Currency");
    expect(benefitsCsv).toContain("USD");
    expect(benefitsCsv).toContain("0.10");
    expect(benefitsCsv).toContain("2026-10-01");
    expect(benefitsCsv).toContain("2026-11-30");
    expect(benefitsCsv).toContain(today);
    expect(benefitsCsv).toContain("Application: paid_amount");
    expect(benefitsCsv).toContain("Contributor offer: metadata");
  } finally {
    anchorClick.mockRestore();
    if (previousCreateObjectURL) Object.defineProperty(URL, "createObjectURL", previousCreateObjectURL);
    else delete URL.createObjectURL;
    if (previousRevokeObjectURL) Object.defineProperty(URL, "revokeObjectURL", previousRevokeObjectURL);
    else delete URL.revokeObjectURL;
  }
});
