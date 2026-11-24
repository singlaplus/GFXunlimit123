import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import axios from "axios";
import MessagesPage from "./MessagesPage";
import { useStartupReadiness } from "../startup/StartupReadinessProvider";

jest.mock("axios");
jest.mock("react-router-dom", () => ({
  useLocation: () => ({ pathname: "/messages", search: "" }),
  useNavigate: () => jest.fn(),
}));
jest.mock("../startup/StartupReadinessProvider", () => ({
  useStartupReadiness: jest.fn(),
}));

describe("MessagesPage startup readiness", () => {
  const reportResource = jest.fn();
  let retryKey;

  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    localStorage.setItem("token", "session-token");
    retryKey = 0;
    useStartupReadiness.mockImplementation(() => ({
      reportResource,
      retryKey,
      routeId: "messages-route",
    }));
    axios.get.mockImplementation((url) => {
      if (url.includes("/api/messages?")) return Promise.resolve({ data: [] });
      if (url.endsWith("/activity")) return Promise.resolve({ data: { rows: [], total: 0 } });
      if (url.endsWith("/conversations")) return Promise.resolve({ data: [] });
      if (url.endsWith("/types")) return Promise.resolve({ data: [] });
      if (url.includes("/notifications/")) return Promise.resolve({ data: [] });
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });
  });

  it("accepts valid empty inbox data and retries only GET requests", async () => {
    const view = render(<MessagesPage userRole="customer" />);
    await waitFor(() => {
      expect(reportResource).toHaveBeenLastCalledWith("messages", "ready", "", "messages-route");
    });
    const messageRequests = () => axios.get.mock.calls.filter(([url]) => url.includes("/api/messages?"));
    expect(messageRequests()).toHaveLength(1);

    retryKey = 1;
    view.rerender(<MessagesPage userRole="customer" />);
    await waitFor(() => expect(messageRequests()).toHaveLength(2));
    expect(axios.post).not.toHaveBeenCalled();
    expect(axios.put).not.toHaveBeenCalled();
  });

  it("labels inbox pagination with the total message count", async () => {
    axios.get.mockImplementation((url) => {
      if (url.includes("/api/messages?")) {
        return Promise.resolve({
          data: Array.from({ length: 6 }, (_, index) => ({
            id: index + 1,
            subject: `Message ${index + 1}`,
            body: "Inbox message",
            created_at: "2026-11-22T10:00:00Z",
            message_type: "SYSTEM_NOTIFICATION",
          })),
        });
      }
      if (url.endsWith("/activity")) return Promise.resolve({ data: { rows: [], total: 0 } });
      if (url.endsWith("/conversations")) return Promise.resolve({ data: [] });
      if (url.endsWith("/types")) return Promise.resolve({ data: [] });
      if (url.includes("/notifications/")) return Promise.resolve({ data: [] });
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });

    render(<MessagesPage userRole="customer" />);

    expect(await screen.findByText("Total Messages: 6")).toBeInTheDocument();
  });

  it("keeps malformed inbox responses from reporting readiness success", async () => {
    axios.get.mockImplementation((url) => {
      if (url.includes("/api/messages?")) return Promise.resolve({ data: {} });
      if (url.endsWith("/activity")) return Promise.resolve({ data: { rows: [], total: 0 } });
      if (url.endsWith("/conversations") || url.endsWith("/types") || url.includes("/notifications/")) {
        return Promise.resolve({ data: [] });
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });
    render(<MessagesPage userRole="customer" />);

    await waitFor(() => {
      expect(reportResource).toHaveBeenLastCalledWith(
        "messages",
        "error",
        "Unable to load your messages. Please retry.",
        "messages-route"
      );
    });
  });

  it("selects and clears broadcast date/time using the custom IST calendar", async () => {
    render(<MessagesPage userRole="admin" />);

    fireEvent.click(await screen.findByRole("button", { name: "Broadcasts" }));
    const trigger = await screen.findByRole("button", { name: "Schedule date/time (IST): Choose date and time" });
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "Schedule date/time (IST)" });
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Hour (IST)" }), { target: { value: "09" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Minute" }), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(dialog).not.toBeInTheDocument();
    expect(trigger).toHaveTextContent(/\d{2} [A-Z][a-z]{2} \d{4} · 09:30 IST/);

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(trigger).toHaveTextContent("Choose date and time");
  });
});
