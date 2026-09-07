import { useEffect, useState } from "react";
import axios from "axios";

export default function useLeaderboard(currentPage) {
  const [leaderboard, setLeaderboard] = useState([]);

  useEffect(() => {
    const fetchLeaderboard = async () => {
      try {
        const res = await axios.get(
          `${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"}/leaderboard`
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