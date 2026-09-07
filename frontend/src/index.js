import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import axios from "axios";
import "./index.css";
import "./darkMode.css";
import "react-toastify/dist/ReactToastify.css";
import App from "./App";
import MarketProvider from "./market/MarketProvider";
import { InactivitySessionProvider } from "./context/InactivitySessionContext";
import { hasActiveSession, normalizeAuthToken, shouldTriggerAuthSessionExpired } from "./utils/authSession";
import { readLastActivityAt } from "./utils/inactivitySession";
import reportWebVitals from "./reportWebVitals";

axios.defaults.withCredentials = true;

axios.interceptors.request.use((config) => {
  const lastActivityAt = readLastActivityAt();
  const headers = config.headers || {};

  if (lastActivityAt) {
    headers["X-Session-Activity"] = String(lastActivityAt);
  }

  const rawAuthorization = headers.Authorization ?? headers.authorization;
  if (typeof rawAuthorization === "string") {
    const token = normalizeAuthToken(rawAuthorization.replace(/^Bearer\s+/i, ""));
    if (!token) {
      delete headers.Authorization;
      delete headers.authorization;
    } else {
      headers.Authorization = `Bearer ${token}`;
      delete headers.authorization;
    }
  }

  config.headers = headers;
  return config;
});

axios.interceptors.response.use(
  (response) => response,
  (error) => {
    const isNetworkError =
      !error?.response &&
      (error?.message === "Network Error" || error?.code === "ERR_NETWORK" || error?.message === "Request failed with status code 0");

    if (isNetworkError) {
      console.warn("Request failed due to network error", error.message);
      return Promise.resolve({
        data: null,
        status: 0,
        statusText: "Network Error",
        config: error.config,
      });
    }

    if (shouldTriggerAuthSessionExpired(error)) {
      window.dispatchEvent(new Event("auth-session-expired"));
    }

    return Promise.reject(error);
  }
);

const root = ReactDOM.createRoot(
  document.getElementById("root")
);

root.render(
  <BrowserRouter>
    <MarketProvider>
      <InactivitySessionProvider>
        <App />
      </InactivitySessionProvider>
    </MarketProvider>
  </BrowserRouter>
);

reportWebVitals();