export const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000;
export const ACTIVITY_THROTTLE_MS = 1000;
export const INACTIVITY_STORAGE_KEY = "gfxunlimit:lastActivityAt";
export const INACTIVITY_CHANNEL_NAME = "gfxunlimit:inactivity";

export const isPageVisible = () => {
  if (typeof document === "undefined") return true;
  return document.visibilityState !== "hidden";
};

export const readLastActivityAt = () => {
  if (typeof window === "undefined") return 0;
  const value = Number(localStorage.getItem(INACTIVITY_STORAGE_KEY));
  return Number.isFinite(value) && value > 0 ? value : 0;
};

export const writeLastActivityAt = (timestamp = Date.now()) => {
  if (typeof window === "undefined") return;
  localStorage.setItem(INACTIVITY_STORAGE_KEY, String(timestamp));
  return timestamp;
};

export const clearLastActivityAt = () => {
  if (typeof window === "undefined") return;
  localStorage.removeItem(INACTIVITY_STORAGE_KEY);
};

export const getRemainingInactivityMs = (lastActivityAt = readLastActivityAt()) => {
  if (!isPageVisible()) {
    return INACTIVITY_TIMEOUT_MS;
  }

  const elapsed = Date.now() - (Number(lastActivityAt) || 0);
  return Math.max(0, INACTIVITY_TIMEOUT_MS - elapsed);
};

export const formatRemainingTime = (remainingMs) => {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
};