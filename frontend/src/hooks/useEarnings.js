import { API_BASE_URL } from "../utils/apiBaseUrl.js";
import { useEffect } from "react";
import axios from "axios";

const noop = () => {};

export default function useEarnings({
  token,
  setEarningsStats,
  reportResource = noop,
  readinessRouteId = "",
  readinessEnabled = false,
  retryKey = 0,
}) {
  useEffect(() => {
    let active = true;
    const fetchEarnings = async () => {
      try {
        if (readinessEnabled) reportResource("earnings", "loading", "", readinessRouteId);
        const res = await axios.get(
          `${API_BASE_URL}/earnings-dashboard`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );

        const earnings = res?.data;
        if (!earnings || typeof earnings !== "object" ||
            earnings.total_earnings == null ||
            !Number.isFinite(Number(earnings.total_earnings))) {
          throw new Error("Earnings response was invalid.");
        }
        if (!active) return;
        setEarningsStats(earnings);
        if (readinessEnabled) reportResource("earnings", "ready", "", readinessRouteId);
      } catch (err) {
        console.error(err);
        if (active && readinessEnabled) {
          reportResource("earnings", "error", "Unable to load earnings information.", readinessRouteId);
        }
      }
    };

    fetchEarnings();
    return () => { active = false; };
  }, [token, setEarningsStats, reportResource, readinessRouteId, readinessEnabled, retryKey]);
}