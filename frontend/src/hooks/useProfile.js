import { useEffect } from "react";
import axios from "axios";
import { normalizeRole } from "../utils/role";
import { getEffectiveAuthToken } from "../utils/authSession";

export default function useProfile(setUserRole, setUserPermissions) {
  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const token = typeof window !== "undefined" ? getEffectiveAuthToken() : null;
        const cookieSessionExists = typeof document !== "undefined" && /(?:^|;\s*)authToken=/.test(document.cookie);
        const storedRole = typeof window !== "undefined" ? localStorage.getItem("userRole") || "" : "";
        const storedPermissions = typeof window !== "undefined" ? (() => {
          try {
            return JSON.parse(localStorage.getItem("userPermissions") || "{}");
          } catch (err) {
            return {};
          }
        })() : {};
        const normalizedStoredRole = normalizeRole(storedRole);

        if (!token && !cookieSessionExists) {
          if (typeof window !== "undefined") {
            localStorage.removeItem("userRole");
            localStorage.removeItem("userPermissions");
          }
          setUserRole("");
          if (setUserPermissions) setUserPermissions({});
          return;
        }

        if (normalizedStoredRole) {
          setUserRole(normalizedStoredRole);
        }
        if (setUserPermissions) {
          setUserPermissions(storedPermissions);
        }

        const res = await axios.get(
          `${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"}/profile`,
          token
            ? {
                headers: {
                  Authorization: `Bearer ${token}`,
                },
              }
            : { withCredentials: true }
        );

        const nextRole = normalizeRole(res?.data?.role || normalizedStoredRole || "");
        const nextPermissions = res?.data?.custom_permissions || {};

        if (nextRole) {
          localStorage.setItem("userRole", nextRole);
        }
        if (typeof window !== "undefined") {
          localStorage.setItem("userPermissions", JSON.stringify(nextPermissions));
        }

        setUserRole(nextRole);
        if (setUserPermissions) setUserPermissions(nextPermissions);
      } catch (err) {
        console.error(err);
        if (typeof window !== "undefined") {
          const fallbackRole = localStorage.getItem("userRole") || "";
          const fallbackPermissions = (() => {
            try {
              return JSON.parse(localStorage.getItem("userPermissions") || "{}");
            } catch (error) {
              return {};
            }
          })();
          setUserRole(fallbackRole);
          if (setUserPermissions) setUserPermissions(fallbackPermissions);
        }
      }
    };

    fetchProfile();

    const handleAuthChanged = () => {
      fetchProfile();
    };

    window.addEventListener("auth-changed", handleAuthChanged);
    return () => window.removeEventListener("auth-changed", handleAuthChanged);
  }, []);
}
