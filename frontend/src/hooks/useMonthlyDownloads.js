import { useEffect } from "react";
import axios from "axios";

export default function useMonthlyDownloads(setMonthlyDownloads) {
  useEffect(() => {
    const fetchMonthlyDownloads = async () => {
      try {
        const userId = localStorage.getItem("userId");

        if (!userId) return;

        const res = await axios.get(
          `${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"}/api/monthly-downloads/${userId}`
        );

        setMonthlyDownloads(res.data);
      } catch (err) {
        console.error(err);
      }
    };

    fetchMonthlyDownloads();
  }, [setMonthlyDownloads]);
}