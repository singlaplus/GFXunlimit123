import { useEffect } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { addNotification } from "../utils/notificationUtils";
import { getEffectiveAuthToken } from "../utils/authSession";

export default function useNotifications(
  setNotifications,
  setNotificationCount
) {

  useEffect(() => {

    const fetchNotifications = async () => {

      try {

        const username =
          localStorage.getItem("username");

        if (!username) return;

        const res =
          await axios.get(
            `${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"}/notifications/${username}`,
            { headers: { Authorization: `Bearer ${getEffectiveAuthToken()}` } }
          );

        setNotifications(res.data);

        const countRes =
          await axios.get(
            `${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"}/notifications/count/${username}`,
            { headers: { Authorization: `Bearer ${getEffectiveAuthToken()}` } }
          );

        setNotificationCount(
          Number(countRes.data.count)
        );

        localStorage.setItem(
          "notificationCount",
          res.data.length
        );

      } catch (err) {

        console.error(err);

      }

    };

    fetchNotifications();
    const refreshNotifications = () => fetchNotifications();
    const timer = setInterval(refreshNotifications, 15000);
    window.addEventListener("notifications-updated", refreshNotifications);

    return () => {
      clearInterval(timer);
      window.removeEventListener("notifications-updated", refreshNotifications);
    };

  }, [setNotifications, setNotificationCount]);

  const notifySuccess = (message) => {

    toast.success(message);

    setNotifications((prev) => {

      const updated =
        addNotification(prev, message);

      setNotificationCount(updated.length);

      return updated;

    });

  };

  const notifyError = (message) => {

    toast.error(message);

  };

  const clearAllNotifications = async () => {
    const username = localStorage.getItem("username");
    if (!username) return;
    await axios.delete(
      `${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"}/notifications/${encodeURIComponent(username)}`,
      { headers: { Authorization: `Bearer ${getEffectiveAuthToken()}` } }
    );
    setNotifications([]);
    setNotificationCount(0);
    localStorage.setItem("notificationCount", "0");
  };

  return {

    notifySuccess,
    notifyError,
    clearAllNotifications,

  };

}