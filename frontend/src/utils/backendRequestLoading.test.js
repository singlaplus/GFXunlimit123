import {
  BACKEND_REQUEST_FINISHED,
  BACKEND_REQUEST_STARTED,
  getPendingBackendRequestCount,
  trackBackendFetchRequests,
  trackBackendRequests,
} from "./backendRequestLoading";

function createAxiosClient() {
  const requestHandlers = [];
  const responseHandlers = [];
  return {
    requestHandlers,
    responseHandlers,
    interceptors: {
      request: { use: (handler) => requestHandlers.push(handler) },
      response: {
        use: (onSuccess, onError) => responseHandlers.push({ onSuccess, onError }),
      },
    },
  };
}

describe("backend request loading tracker", () => {
  it("keeps a shared count until concurrent backend requests finish", async () => {
    const client = createAxiosClient();
    const events = [];
    const onStarted = (event) => events.push(["started", event.detail.pendingRequests]);
    const onFinished = (event) => events.push(["finished", event.detail.pendingRequests]);
    window.addEventListener(BACKEND_REQUEST_STARTED, onStarted);
    window.addEventListener(BACKEND_REQUEST_FINISHED, onFinished);
    trackBackendRequests(client);

    const first = client.requestHandlers[0]({});
    const second = client.requestHandlers[0]({});
    expect(getPendingBackendRequestCount()).toBe(2);

    client.responseHandlers[0].onSuccess({ config: first });
    await expect(client.responseHandlers[0].onError({ config: second })).rejects.toBeDefined();

    expect(getPendingBackendRequestCount()).toBe(0);
    expect(events).toEqual([
      ["started", 1],
      ["started", 2],
      ["finished", 1],
      ["finished", 0],
    ]);
    window.removeEventListener(BACKEND_REQUEST_STARTED, onStarted);
    window.removeEventListener(BACKEND_REQUEST_FINISHED, onFinished);
  });

  it("does not include background requests marked to skip the global loader", () => {
    const client = createAxiosClient();
    const events = [];
    const onStarted = (event) => events.push(["started", event.detail.pendingRequests]);
    const onFinished = (event) => events.push(["finished", event.detail.pendingRequests]);
    window.addEventListener(BACKEND_REQUEST_STARTED, onStarted);
    window.addEventListener(BACKEND_REQUEST_FINISHED, onFinished);
    trackBackendRequests(client);

    const request = client.requestHandlers[0]({ skipGlobalLoading: true });
    expect(getPendingBackendRequestCount()).toBe(0);
    client.responseHandlers[0].onSuccess({ config: request });

    expect(getPendingBackendRequestCount()).toBe(0);
    expect(events).toEqual([]);
    window.removeEventListener(BACKEND_REQUEST_STARTED, onStarted);
    window.removeEventListener(BACKEND_REQUEST_FINISHED, onFinished);
  });

  it("tracks fetch requests to the configured backend origin only", async () => {
    const events = [];
    const onStarted = (event) => events.push(["started", event.detail.pendingRequests]);
    const onFinished = (event) => events.push(["finished", event.detail.pendingRequests]);
    window.addEventListener(BACKEND_REQUEST_STARTED, onStarted);
    window.addEventListener(BACKEND_REQUEST_FINISHED, onFinished);
    const fetchMock = jest.fn(() => Promise.resolve({ ok: true }));
    const targetWindow = {
      location: { href: "https://app.example/" },
      fetch: fetchMock,
    };
    trackBackendFetchRequests(targetWindow, "https://api.example");

    await targetWindow.fetch("https://api.example/availability");
    await targetWindow.fetch("https://other.example/asset.jpg");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getPendingBackendRequestCount()).toBe(0);
    expect(events).toEqual([
      ["started", 1],
      ["finished", 0],
    ]);
    window.removeEventListener(BACKEND_REQUEST_STARTED, onStarted);
    window.removeEventListener(BACKEND_REQUEST_FINISHED, onFinished);
  });
});
