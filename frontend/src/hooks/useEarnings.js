import { API_BASE_URL } from "../utils/apiBaseUrl.js";
import { useEffect } from "react";
import axios from "axios";

export default function useEarnings({
  token,
  setEarningsStats,
}) {
  useEffect(() => {
    const fetchEarnings = async () => {
      try {
        if (!token) return;

        const res = await axios.get(
          `${API_BASE_URL}/earnings-dashboard`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );

        setEarningsStats(res.data);
      } catch (err) {
        console.error(err);
      }
    };

    fetchEarnings();
  }, [token, setEarningsStats]);
}