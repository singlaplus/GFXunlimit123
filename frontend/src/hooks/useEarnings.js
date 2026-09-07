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
          `${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"}/earnings-dashboard`,
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