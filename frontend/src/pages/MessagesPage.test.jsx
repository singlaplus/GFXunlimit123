import { render, waitFor } from "@testing-library/react";
import axios from "axios";
import MessagesPage from "./MessagesPage";
import { useStartupReadiness } from "../startup/StartupReadinessProvider";

jest.mock("axios");
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
});
