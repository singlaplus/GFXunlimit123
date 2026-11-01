import { API_BASE_URL } from "../utils/apiBaseUrl.js";
import { useEffect, useRef, useState } from "react";
import axios from "axios";

const noop = () => {};

const EMPTY_HERO_STATS = {
  totalAssets: 0,
  totalSearches: 0,
  totalDownloads: 0,
  todayVisitors: 0,
};

export default function useHeroStats({
  reportResource = noop,
  retryKey = 0,
  routeId = "",
} = {}) {
  const [heroStats, setHeroStats] = useState(null);
  const [loadState, setLoadState] = useState({ status: "loading", error: "" });
  const routeIdRef = useRef(routeId);
  routeIdRef.current = routeId;

  useEffect(() => {
    let active = true;
    reportResource("hero", "loading", "", routeIdRef.current);
    setLoadState({ status: "loading", error: "" });

    const fetchHeroStats = async () => {
      try {
        const response = await axios.get(`${API_BASE_URL}/hero-stats`);
        const stats = response?.data;
        const requiredStats = ["totalAssets", "totalSearches", "totalDownloads", "todayVisitors"];
        if (!stats || typeof stats !== "object" || requiredStats.some((key) => (
          stats[key] == null || !Number.isFinite(Number(stats[key]))
        ))) {
          throw new Error("Hero statistics response was invalid.");
        }

        if (!active) return;
        setHeroStats({
          totalAssets: Number(stats.totalAssets),
          totalSearches: Number(stats.totalSearches),
          totalDownloads: Number(stats.totalDownloads),
          todayVisitors: Number(stats.todayVisitors),
        });
        setLoadState({ status: "ready", error: "" });
        reportResource("hero", "ready", "", routeIdRef.current);
      } catch (error) {
        if (!active) return;
        console.error("Failed to load hero statistics", error);
        setLoadState({ status: "error", error: "Unable to load the home page statistics." });
        reportResource("hero", "error", "Unable to load the home page statistics.", routeIdRef.current);
      }
    };

    fetchHeroStats();
    return () => { active = false; };
  }, [reportResource, retryKey]);

  useEffect(() => {
    if (loadState.status === "ready" || loadState.status === "error") {
      reportResource("hero", loadState.status, loadState.error, routeId);
    }
  }, [loadState, reportResource, routeId]);

  return heroStats || EMPTY_HERO_STATS;
}
