export const readSessionCookie = () => {
  if (typeof document === "undefined") {
    return null;
  }

  const match = document.cookie.match(/(?:^|; )session_id=([^;]*)/);
  if (!match) {
    return null;
  }

  try {
    return decodeURIComponent(match[1]);
  } catch (err) {
    return match[1] || null;
  }
};

export const readAuthTokenFromCookie = () => {
  if (typeof document === "undefined") {
    return null;
  }

  const match = document.cookie.match(/(?:^|; )authToken=([^;]*)/);
  if (!match) {
    return null;
  }

  try {
    return decodeURIComponent(match[1]);
  } catch (err) {
    return match[1] || null;
  }
};

export const normalizeAuthToken = (value) => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = trimmed.toLowerCase();
  if (["null", "undefined", "none", "nan"].includes(normalized)) {
    return null;
  }

  return trimmed;
};

export const buildAuthHeaders = (tokenOverride = getEffectiveAuthToken()) => {
  const token = normalizeAuthToken(tokenOverride);
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export const hasActiveSession = () => {
  if (typeof window === "undefined") {
    return false;
  }

  const activeToken = normalizeAuthToken(readAuthTokenFromCookie()) || normalizeAuthToken(localStorage.getItem("token"));
  const rawToken = normalizeAuthToken(localStorage.getItem("token"));

  return Boolean(
    activeToken ||
      readSessionCookie() ||
      rawToken
  );
};

export const getEffectiveAuthToken = () => {
  if (typeof window === "undefined") {
    return null;
  }

  const localToken = normalizeAuthToken(localStorage.getItem("token"));
  const cookieToken = normalizeAuthToken(readAuthTokenFromCookie());
  const token = localToken || cookieToken;

  if (token && cookieToken && !localToken) {
    localStorage.setItem("token", token);
  }

  return token;
};

export const clearAuthSessionStorage = () => {
  if (typeof window === "undefined") return;

  localStorage.removeItem("token");
  localStorage.removeItem("username");
  localStorage.removeItem("userId");
  localStorage.removeItem("userRole");
  localStorage.removeItem("userPermissions");
  localStorage.removeItem("email");
  localStorage.removeItem("fullName");

  document.cookie = "authToken=; Max-Age=0; path=/; SameSite=Lax";
  document.cookie = "session_id=; Max-Age=0; path=/; SameSite=Lax";
};

export const shouldTriggerAuthSessionExpired = (error) => {
  if (!error || typeof error !== "object") return false;
  if (error.response?.status !== 401 || !hasActiveSession()) return false;

  const payload = error.response?.data;
  const message = typeof payload === "string" ? payload : payload?.error || payload?.message || "";
  const normalizedMessage = String(message || "").trim().toLowerCase();

  if (!normalizedMessage) {
    return false;
  }

  const expiredMarkers = [
    "session expired",
    "expired session",
    "session has expired",
    "please log in again",
  ];

  return expiredMarkers.some((marker) => normalizedMessage.includes(marker));
};
