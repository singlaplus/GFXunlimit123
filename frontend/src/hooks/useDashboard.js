import { useEffect, useState } from "react";
import axios from "axios";

export default function useDashboard() {

  const [dashboardStats, setDashboardStats] = useState({
    uploads: 0,
    downloads: 0,
    views: 0,
    likes: 0,
  });

  const fetchDashboardStats = async () => {

    try {

      const token = localStorage.getItem("token");

      if (!token) return;

      const res = await axios.get(
        `${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"}/dashboard-stats`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      setDashboardStats(res.data);

    } catch (err) {

      console.error(err);

    }

  };

  useEffect(() => {

    fetchDashboardStats();

  }, []);

  return {
    dashboardStats,
    fetchDashboardStats,
  };

}