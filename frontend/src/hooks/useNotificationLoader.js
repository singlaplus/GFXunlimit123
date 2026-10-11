import { API_BASE_URL } from "../utils/apiBaseUrl.js";
import { useEffect } from "react";
import axios from "axios";

export default function useNotificationLoader({
  setNotifications,
  setNotificationCount,
}) {
  useEffect(() => {
    const fetchNotifications = async () => {
      try {
        const username = localStorage.getItem("username");

        if (!username) return;

        const res = await axios.get(
          `${API_BASE_URL}/notifications/${username}`
        );

        setNotifications(res.data);

        const countRes = await axios.get(
          `${API_BASE_URL}/notifications/count/${username}`
        );

        setNotificationCount(Number(countRes.data.count));

        localStorage.setItem(
          "notificationCount",
          res.data.length
        );
      } catch (err) {
        console.error(err);
      }
    };

    fetchNotifications();
  }, [setNotifications, setNotificationCount]);
}