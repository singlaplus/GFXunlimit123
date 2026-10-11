import { API_BASE_URL } from "../utils/apiBaseUrl.js";
import { useEffect } from "react";
import axios from "axios";

export default function useMonthlyDownloads(setMonthlyDownloads) {
  useEffect(() => {
    const fetchMonthlyDownloads = async () => {
      try {
        const userId = localStorage.getItem("userId");

        if (!userId) return;

        const res = await axios.get(
          `${API_BASE_URL}/api/monthly-downloads/${userId}`
        );

        setMonthlyDownloads(res.data);
      } catch (err) {
        console.error(err);
      }
    };

    fetchMonthlyDownloads();
  }, [setMonthlyDownloads]);
}