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

let refreshPromise = null;

const refreshAccessToken = () => {
  if (!refreshPromise) {
    const apiBaseUrl = process.env.REACT_APP_API_BASE_URL || "http://localhost:5000";
    refreshPromise = axios.post(`${apiBaseUrl}/auth/refresh`, {}, {
      withCredentials: true,
      _authRefreshRequest: true,
    }).then((response) => {
      const token = normalizeAuthToken(response.data?.token);
      if (!token) {
        throw new Error("Refresh response did not include an access token");
      }
      localStorage.setItem("token", token);
      if (response.data.username) localStorage.setItem("username", response.data.username);
      if (response.data.userId) localStorage.setItem("userId", String(response.data.userId));
      if (response.data.role) localStorage.setItem("userRole", response.data.role);
      if (response.data.email) localStorage.setItem("email", response.data.email);
      if (response.data.fullName) localStorage.setItem("fullName", response.data.fullName);
      if (response.data.custom_permissions) {
        localStorage.setItem("userPermissions", JSON.stringify(response.data.custom_permissions));
      }
      window.dispatchEvent(new Event("auth-changed"));
      return token;
    }).finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
};

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

    const originalRequest = error?.config;
    if (shouldTriggerAuthSessionExpired(error) && !originalRequest?._authRetry && !originalRequest?._authRefreshRequest) {
      originalRequest._authRetry = true;
      return refreshAccessToken().then((token) => {
        originalRequest.headers = originalRequest.headers || {};
        originalRequest.headers.Authorization = `Bearer ${token}`;
        return axios(originalRequest);
      }).catch((refreshError) => {
        window.dispatchEvent(new Event("auth-session-expired"));
        return Promise.reject(refreshError);
      });
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