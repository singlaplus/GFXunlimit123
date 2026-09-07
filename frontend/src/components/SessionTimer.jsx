import { useState } from "react";
import { useInactivitySession } from "../context/InactivitySessionContext";
import { formatRemainingTime } from "../utils/inactivitySession";

export default function SessionTimer({ darkMode }) {
  const { authenticated, remainingMs, continueSession } = useInactivitySession();
  const [warningDismissed, setWarningDismissed] = useState(false);
  if (!authenticated) return null;

  const warningVisible = remainingMs > 0 && remainingMs <= 60 * 1000 && !warningDismissed;
  const timerClass = remainingMs <= 60 * 1000 ? "session-timer critical" : remainingMs <= 5 * 60 * 1000 ? "session-timer warning" : "session-timer";

  return (
    <>
      <span className={timerClass} title="Inactivity session time remaining">{formatRemainingTime(remainingMs)}</span>
      {warningVisible && (
        <div className={`session-warning ${darkMode ? "dark" : ""}`} role="alert">
          <span>Your session will expire in 1 minute due to inactivity.</span>
          <button type="button" onClick={() => { continueSession(); setWarningDismissed(false); }}>Continue Session</button>
        </div>
      )}
    </>
  );
}