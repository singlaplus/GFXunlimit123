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
          `${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"}/notifications/${username}`
        );

        setNotifications(res.data);

        const countRes = await axios.get(
          `${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"}/notifications/count/${username}`
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