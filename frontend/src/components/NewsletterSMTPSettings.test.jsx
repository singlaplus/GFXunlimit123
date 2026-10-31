import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import axios from "axios";
import NewsletterSMTPSettings from "./NewsletterSMTPSettings";

jest.mock("axios");

const initialSettings = {
  sender_name: "GFXunlimit Newsletter",
  sender_email: "newsletter@example.com",
  smtp_host: "smtp.example.com",
  smtp_port: 587,
  smtp_user: "newsletter@example.com",
  smtp_pass: "*****"
};

beforeEach(() => {
  axios.get.mockResolvedValue({ data: initialSettings });
  axios.put.mockResolvedValue({ data: initialSettings });
  axios.post.mockResolvedValue({ data: { ok: true, status: "connected" } });
});

afterEach(() => {
  jest.clearAllMocks();
});

test("loads and saves newsletter-only SMTP settings", async () => {
  render(<NewsletterSMTPSettings />);

  await waitFor(() => {
    expect(screen.getByLabelText("Sender name")).toHaveValue("GFXunlimit Newsletter");
  });
  expect(screen.getByLabelText("SMTP password")).toHaveValue("*****");
  fireEvent.click(screen.getByRole("button", { name: "Save SMTP for newsletter" }));

  await waitFor(() => {
    expect(axios.put).toHaveBeenCalledWith(
      expect.stringContaining("/admin/email/newsletter-smtp-settings"),
      expect.objectContaining({
        sender_email: "newsletter@example.com",
        smtp_port: 587,
        smtp_pass: "*****"
      }),
      expect.any(Object)
    );
  });
  expect(await screen.findByRole("status")).toHaveTextContent("SMTP settings saved for newsletters.");
});

test("verifies settings and sends a test email to the entered recipient", async () => {
  render(<NewsletterSMTPSettings />);

  await waitFor(() => {
    expect(screen.getByLabelText("Sender name")).toHaveValue("GFXunlimit Newsletter");
  });
  fireEvent.click(screen.getByRole("button", { name: "Verify SMTP Settings" }));
  await waitFor(() => expect(axios.post).toHaveBeenCalledWith(
    expect.stringContaining("/newsletter-smtp-settings/verify"),
    expect.objectContaining({ smtp_host: "smtp.example.com" }),
    expect.any(Object)
  ));
  expect(await screen.findByText("SMTP connection verified successfully.")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Send Test Mail" }));
  const dialog = await screen.findByRole("dialog", { name: "Send Test Mail" });
  fireEvent.change(within(dialog).getByLabelText("Test recipient email"), {
    target: { value: "test@example.com" }
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Send Test Mail" }));

  await waitFor(() => expect(axios.post).toHaveBeenCalledWith(
    expect.stringContaining("/newsletter-smtp-settings/test"),
    expect.objectContaining({
      to: "test@example.com",
      settings: expect.objectContaining({ smtp_user: "newsletter@example.com" })
    }),
    expect.any(Object)
  ));
});
