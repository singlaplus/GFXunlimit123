import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import axios from "axios";
import { toast } from "react-toastify";
import { clearAuthSessionStorage, hasActiveSession } from "../utils/authSession";
import {
  ACTIVITY_THROTTLE_MS,
  INACTIVITY_CHANNEL_NAME,
  INACTIVITY_STORAGE_KEY,
  INACTIVITY_TIMEOUT_MS,
  clearLastActivityAt,
  getRemainingInactivityMs,
  isPageVisible,
  readLastActivityAt,
  writeLastActivityAt,
} from "../utils/inactivitySession";

const InactivitySessionContext = createContext(null);

export function InactivitySessionProvider({ children }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [authenticated, setAuthenticated] = useState(hasActiveSession);
  const [lastActivityAt, setLastActivityAt] = useState(readLastActivityAt);
  const [remainingMs, setRemainingMs] = useState(INACTIVITY_TIMEOUT_MS);
  const lastRecordedActivity = useRef(0);
  const loggingOut = useRef(false);
  const channelRef = useRef(null);

  const broadcastActivity = useCallback((timestamp) => {
    if (channelRef.current) channelRef.current.postMessage({ type: "activity", timestamp });
  }, []);

  const recordActivity = useCallback((timestamp = Date.now(), { broadcast = true } = {}) => {
    if (!authenticated || timestamp - lastRecordedActivity.current < ACTIVITY_THROTTLE_MS) return;
    lastRecordedActivity.current = timestamp;
    writeLastActivityAt(timestamp);
    setLastActivityAt(timestamp);
    setRemainingMs(INACTIVITY_TIMEOUT_MS);
    if (broadcast) broadcastActivity(timestamp);
  }, [authenticated, broadcastActivity]);

  const expireSession = useCallback(async () => {
    if (loggingOut.current) return;
    loggingOut.current = true;
    try {
      await axios.post(`${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"}/logout`, {}, { withCredentials: true });
    } catch (error) {
      // Clearing local state and redirecting must still happen when the server is unavailable.
    } finally {
      clearAuthSessionStorage();
      clearLastActivityAt();
      setAuthenticated(false);
      setLastActivityAt(0);
      setRemainingMs(0);
      window.dispatchEvent(new Event("auth-changed"));
      toast.error("Your session expired due to inactivity. Please log in again.");
      navigate("/", { replace: true });
      loggingOut.current = false;
    }
  }, [navigate]);

  useEffect(() => {
    const syncAuth = () => {
      const active = hasActiveSession();
      setAuthenticated(active);
      if (!active) {
        clearLastActivityAt();
        setLastActivityAt(0);
        setRemainingMs(0);
      } else if (!lastActivityAt) {
        recordActivity(Date.now(), { broadcast: false });
      }
    };
    window.addEventListener("auth-changed", syncAuth);
    const handleSessionExpired = () => expireSession();
    window.addEventListener("auth-session-expired", handleSessionExpired);
    return () => {
      window.removeEventListener("auth-changed", syncAuth);
      window.removeEventListener("auth-session-expired", handleSessionExpired);
    };
  }, [lastActivityAt, recordActivity, expireSession]);

  useEffect(() => {
    if (!authenticated) return undefined;
    const initialActivity = Date.now();
    recordActivity(initialActivity, { broadcast: false });
    const events = ["click", "keydown", "touchstart", "input", "change", "focus"];
    const handleActivity = () => recordActivity();
    events.forEach((eventName) => window.addEventListener(eventName, handleActivity, { passive: true, capture: true }));
    const handleVisibility = () => {
      if (document.visibilityState === "visible") recordActivity();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      events.forEach((eventName) => window.removeEventListener(eventName, handleActivity, true));
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [authenticated, recordActivity]);

  useEffect(() => {
    if (!authenticated) return undefined;
    recordActivity(Date.now());
  }, [location.pathname, location.search, authenticated, recordActivity]);

  useEffect(() => {
    if (!authenticated) return undefined;
    const handleStorage = (event) => {
      if (event.key !== INACTIVITY_STORAGE_KEY || !event.newValue) return;
      const timestamp = Number(event.newValue);
      if (Number.isFinite(timestamp) && timestamp > lastActivityAt) {
        lastRecordedActivity.current = timestamp;
        setLastActivityAt(timestamp);
      }
    };
    const handleChannel = (event) => {
      const timestamp = Number(event.data?.timestamp);
      if (event.data?.type === "activity" && Number.isFinite(timestamp) && timestamp > lastActivityAt) {
        lastRecordedActivity.current = timestamp;
        writeLastActivityAt(timestamp);
        setLastActivityAt(timestamp);
      }
    };
    window.addEventListener("storage", handleStorage);
    if (typeof BroadcastChannel !== "undefined") {
      channelRef.current = new BroadcastChannel(INACTIVITY_CHANNEL_NAME);
      channelRef.current.addEventListener("message", handleChannel);
    }
    return () => {
      window.removeEventListener("storage", handleStorage);
      channelRef.current?.close();
      channelRef.current = null;
    };
  }, [authenticated, lastActivityAt]);

  useEffect(() => {
    if (!authenticated) return undefined;
    const update = () => {
      if (!isPageVisible()) {
        setRemainingMs(INACTIVITY_TIMEOUT_MS);
        return;
      }

      const currentLastActivity = readLastActivityAt() || lastActivityAt;
      const nextRemaining = getRemainingInactivityMs(currentLastActivity);
      setRemainingMs(nextRemaining);
      if (nextRemaining <= 0) expireSession();
    };
    update();
    const interval = window.setInterval(update, 1000);
    return () => window.clearInterval(interval);
  }, [authenticated, expireSession, lastActivityAt]);

  const value = {
    authenticated,
    lastActivityAt,
    remainingMs,
    recordActivity: () => recordActivity(),
    continueSession: () => recordActivity(),
  };

  return <InactivitySessionContext.Provider value={value}>{children}</InactivitySessionContext.Provider>;
}

export const useInactivitySession = () => useContext(InactivitySessionContext) || {
  authenticated: false,
  remainingMs: 0,
  recordActivity: () => {},
  continueSession: () => {},
};