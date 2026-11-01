import { API_BASE_URL } from "../utils/apiBaseUrl.js";
import { useCallback, useEffect, useState } from "react";
import axios from "axios";

const noop = () => {};

export default function useDashboard({
  reportResource = noop,
  readinessRouteId = "",
  readinessEnabled = false,
  retryKey = 0,
} = {}) {

  const [dashboardStats, setDashboardStats] = useState({
    uploads: 0,
    downloads: 0,
    views: 0,
    likes: 0,
  });

  const fetchDashboardStats = useCallback(async () => {

    try {

      const token = localStorage.getItem("token");
      if (!token && !localStorage.getItem("userRole")) return;

      if (readinessEnabled) reportResource("dashboard", "loading", "", readinessRouteId);

      const res = await axios.get(
        `${API_BASE_URL}/dashboard-stats`,
        {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          withCredentials: true,
        }
      );

      const stats = res?.data;
      const requiredStats = ["uploads", "downloads", "views", "likes"];
      if (!stats || typeof stats !== "object" || requiredStats.some((key) => (
        stats[key] == null || !Number.isFinite(Number(stats[key]))
      ))) {
        throw new Error("Dashboard statistics response was invalid.");
      }

      setDashboardStats(res.data);
      if (readinessEnabled) reportResource("dashboard", "ready", "", readinessRouteId);

    } catch (err) {

      console.error(err);
      if (readinessEnabled) {
        reportResource("dashboard", "error", "Unable to load dashboard statistics.", readinessRouteId);
      }

    }

  }, [reportResource, readinessEnabled, readinessRouteId]);

  useEffect(() => {
    fetchDashboardStats();
  }, [fetchDashboardStats, retryKey]);

  return {
    dashboardStats,
    fetchDashboardStats,
  };

}