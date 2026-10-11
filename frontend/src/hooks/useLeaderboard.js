import { API_BASE_URL } from "../utils/apiBaseUrl.js";
import { useEffect, useState } from "react";
import axios from "axios";

export default function useLeaderboard(currentPage) {
  const [leaderboard, setLeaderboard] = useState([]);

  useEffect(() => {
    const fetchLeaderboard = async () => {
      try {
        const res = await axios.get(
          `${API_BASE_URL}/leaderboard`
        );

        setLeaderboard(res.data);
      } catch (err) {
        console.error(err);
      }
    };

    fetchLeaderboard();
  }, [currentPage]);

  return leaderboard;
}