import axios from "axios";
import { hasActiveSession, shouldTriggerAuthSessionExpired } from "../utils/authSession";
import { readLastActivityAt } from "../utils/inactivitySession";

const api = (axios && typeof axios.create === 'function')
  ? axios.create({ baseURL: process.env.REACT_APP_API_BASE_URL || "http://localhost:5000" })
  : axios;

if (api && api.interceptors && api.interceptors.response && typeof api.interceptors.response.use === 'function') {
  api.interceptors.request.use((config) => {
    const lastActivityAt = readLastActivityAt();
    if (lastActivityAt) {
      config.headers = config.headers || {};
      config.headers["X-Session-Activity"] = String(lastActivityAt);
    }
    return config;
  });
  api.interceptors.response.use(
    (response) => response,
    (error) => {
      if (error?.message === "Network Error" || error?.code === "ERR_NETWORK") {
        console.warn("Network request failed", error.message);
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
}

// ======================
// IMAGES
// ======================

export const getImages = (params) => {
  return api.get("/images", { params });
};

export const getSingleImage = (id) => {
  return api.get(`/images/${id}`);
};

// ======================
// LIKE / FAVORITE / DOWNLOAD
// ======================

export const likeImage = (id) => {
  return api.post(`/images/${id}/like`);
};

export const addFavorite = (id) => {
  return api.post(`/favorites/${id}`);
};

export const downloadImage = (id) => {
  return api.post(`/images/${id}/download`);
};

export const shareImage = (id) => {
  return api.post(`/images/${id}/share`);
};

// ======================
// AUTH (future ready)
// ======================

export const login = (data) => {
  return api.post("/login", data);
};

export const register = (data) => {
  return api.post("/register", data);
};

export default api;