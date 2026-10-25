export const BACKEND_REQUEST_STARTED = "backend-request-started";
export const BACKEND_REQUEST_FINISHED = "backend-request-finished";

const TRACKED_REQUEST = "__gfxBackendRequestTracked";
const TRACKED_FETCH = "__gfxBackendFetchTracked";
let pendingRequests = 0;

function dispatchRequestCount(eventName) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(eventName, { detail: { pendingRequests } }));
}

function startTrackingRequest() {
  pendingRequests += 1;
  dispatchRequestCount(BACKEND_REQUEST_STARTED);
}

function finishTrackingRequest() {
  pendingRequests = Math.max(0, pendingRequests - 1);
  dispatchRequestCount(BACKEND_REQUEST_FINISHED);
}

export function trackBackendRequests(client) {
  if (!client?.interceptors?.request?.use || !client?.interceptors?.response?.use) {
    return client;
  }

  client.interceptors.request.use((config) => {
    if (config.skipGlobalLoading) return config;

    if (!config[TRACKED_REQUEST]) {
      config[TRACKED_REQUEST] = true;
      startTrackingRequest();
    }
    return config;
  });

  const finishRequest = (config) => {
    if (!config?.[TRACKED_REQUEST]) return;
    config[TRACKED_REQUEST] = false;
    finishTrackingRequest();
  };

  client.interceptors.response.use(
    (response) => {
      finishRequest(response.config);
      return response;
    },
    (error) => {
      finishRequest(error.config);
      return Promise.reject(error);
    }
  );

  return client;
}

export function trackBackendFetchRequests(targetWindow, apiBaseUrl) {
  if (typeof targetWindow?.fetch !== "function" || !apiBaseUrl || targetWindow.fetch[TRACKED_FETCH]) {
    return;
  }

  const originalFetch = targetWindow.fetch;
  let apiOrigin;
  try {
    apiOrigin = new URL(apiBaseUrl, targetWindow.location.href).origin;
  } catch {
    return;
  }

  const trackedFetch = function trackedFetch(input, ...args) {
    let requestOrigin;
    try {
      const requestUrl = typeof input === "string" ? input : input.url;
      requestOrigin = new URL(requestUrl, targetWindow.location.href).origin;
    } catch {
      return originalFetch.call(this, input, ...args);
    }
    if (requestOrigin !== apiOrigin) {
      return originalFetch.call(this, input, ...args);
    }

    startTrackingRequest();
    return originalFetch.call(this, input, ...args).finally(finishTrackingRequest);
  };
  trackedFetch[TRACKED_FETCH] = true;
  targetWindow.fetch = trackedFetch;
}

export function getPendingBackendRequestCount() {
  return pendingRequests;
}
