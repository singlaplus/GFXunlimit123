import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { getEffectiveAuthToken } from "../utils/authSession";
import Pagination from "../components/Pagination";

const getIsDarkMode = () => typeof document !== "undefined" && document.body.classList.contains("dark-mode");

const LIGHT_THEME = {
  pageBg: "#f8fafc",
  surface: "#ffffff",
  border: "#e2e8f0",
  text: "#0f172a",
  muted: "#64748b",
  accent: "#ed2224",
  rowBg: "#f8fafc"
};

const DARK_THEME = {
  pageBg: "#0f172a",
  surface: "#111827",
  border: "#374151",
  text: "#f8fafc",
  muted: "#94a3b8",
  accent: "#ed2224",
  rowBg: "#1f2937"
};

export default function AdminCustomerCreditsPage() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [isDarkMode, setIsDarkMode] = useState(getIsDarkMode);
  const [currentPage, setCurrentPage] = useState(1);
  const [deleteUser, setDeleteUser] = useState(null);
  const [deleteAmount, setDeleteAmount] = useState("");
  const [isDeletingCredits, setIsDeletingCredits] = useState(false);
  const [filters, setFilters] = useState({ name: "", username: "", email: "", role: "" });

  useEffect(() => {
    if (typeof document === "undefined") return undefined;

    const syncTheme = () => setIsDarkMode(getIsDarkMode());
    const observer = new MutationObserver(syncTheme);
    observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    syncTheme();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const loadUsers = async () => {
      try {
        setLoading(true);
        setError("");
        const token = typeof window !== "undefined" ? getEffectiveAuthToken() : null;
        const response = await axios.get(`${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"}/admin/users`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {}
        });
        setUsers(Array.isArray(response.data) ? response.data : []);
      } catch (err) {
        console.error("Failed to load customer credits", err);
        setError("Unable to load customer credits right now.");
        setUsers([]);
      } finally {
        setLoading(false);
      }
    };

    loadUsers();
  }, []);

  const theme = isDarkMode ? DARK_THEME : LIGHT_THEME;
  const pageSize = 50;
  const filteredUsers = useMemo(() => {
    const name = filters.name.trim().toLowerCase();
    const username = filters.username.trim().toLowerCase();
    const email = filters.email.trim().toLowerCase();

    return users.filter((user) => (
      (!name || String(user.full_name || "").toLowerCase().includes(name)) &&
      (!username || String(user.username || "").toLowerCase().includes(username)) &&
      (!email || String(user.email || "").toLowerCase().includes(email)) &&
      (!filters.role || String(user.role || "") === filters.role)
    ));
  }, [filters, users]);
  const roles = useMemo(() => [...new Set(users.map((user) => user.role).filter(Boolean))].sort(), [users]);
  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / pageSize));
  const pageUsers = filteredUsers.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const exportCsv = () => {
    const headers = ["name", "username", "email", "role", "available_credits"];
    const rows = filteredUsers.map((user) => [
      user.full_name || "",
      user.username || "",
      user.email || "",
      user.role || "",
      Number(user.credits || 0)
    ]);
    const csv = [headers, ...rows]
      .map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const url = window.URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "customer-credits.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  };

  const openDeleteCredits = (user) => {
    setDeleteUser(user);
    setDeleteAmount("");
  };

  const closeDeleteCredits = () => {
    if (!isDeletingCredits) {
      setDeleteUser(null);
      setDeleteAmount("");
    }
  };

  const deleteCredits = async () => {
    const amount = Number(deleteAmount);
    if (!deleteUser || !Number.isFinite(amount) || amount <= 0) return;

    try {
      setIsDeletingCredits(true);
      const token = typeof window !== "undefined" ? getEffectiveAuthToken() : null;
      const response = await axios.delete(`${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"}/admin/users/${deleteUser.id}/credits`, {
        data: { credits: amount },
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      setUsers((previousUsers) => previousUsers.map((user) => user.id === deleteUser.id ? response.data : user));
      closeDeleteCredits();
    } catch (err) {
      console.error("Failed to delete credits", err);
      setError("Unable to delete credits right now.");
    } finally {
      setIsDeletingCredits(false);
    }
  };

  return (
    <main style={{ minHeight: "100vh", padding: "28px 20px", background: theme.pageBg, color: theme.text }}>
      <div style={{ width: "100%" }}>
        <div style={{ marginBottom: "22px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "16px", flexWrap: "wrap" }}>
            <div>
              <h1 style={{ margin: 0, fontSize: "1.7rem" }}>Customer Credits</h1>
              <p style={{ margin: "8px 0 0", color: theme.muted }}>Available credits for all users.</p>
            </div>
            <button type="button" onClick={exportCsv} style={{ background: theme.accent, color: "#fff", border: "none", padding: "10px 16px", borderRadius: "8px", cursor: "pointer", fontWeight: 600 }}>
              Export CSV
            </button>
          </div>
        </div>

        <section style={{ background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: "12px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px", padding: "16px", borderBottom: `1px solid ${theme.border}` }}>
            <input type="search" value={filters.name} onChange={(event) => { setFilters((previous) => ({ ...previous, name: event.target.value })); setCurrentPage(1); }} placeholder="Search name" aria-label="Search name" style={{ minWidth: 0, padding: "10px", borderRadius: "8px", border: `1px solid ${theme.border}`, background: theme.surface, color: theme.text }} />
            <input type="search" value={filters.username} onChange={(event) => { setFilters((previous) => ({ ...previous, username: event.target.value })); setCurrentPage(1); }} placeholder="Search username" aria-label="Search username" style={{ minWidth: 0, padding: "10px", borderRadius: "8px", border: `1px solid ${theme.border}`, background: theme.surface, color: theme.text }} />
            <input type="search" value={filters.email} onChange={(event) => { setFilters((previous) => ({ ...previous, email: event.target.value })); setCurrentPage(1); }} placeholder="Search email" aria-label="Search email" style={{ minWidth: 0, padding: "10px", borderRadius: "8px", border: `1px solid ${theme.border}`, background: theme.surface, color: theme.text }} />
            <select value={filters.role} onChange={(event) => { setFilters((previous) => ({ ...previous, role: event.target.value })); setCurrentPage(1); }} aria-label="Filter by role" style={{ minWidth: 0, padding: "10px", borderRadius: "8px", border: `1px solid ${theme.border}`, background: theme.surface, color: theme.text }}>
              <option value="">All roles</option>
              {roles.map((role) => <option key={role} value={role}>{role}</option>)}
            </select>
          </div>
          {loading ? (
            <p style={{ padding: "22px", margin: 0 }}>Loading users...</p>
          ) : error ? (
            <p style={{ padding: "22px", margin: 0, color: theme.accent }}>{error}</p>
          ) : filteredUsers.length === 0 ? (
            <p style={{ padding: "22px", margin: 0 }}>No users found.</p>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "620px" }}>
              <thead>
                <tr style={{ background: theme.rowBg, textAlign: "left" }}>
                  <th style={{ padding: "14px 16px", borderBottom: `1px solid ${theme.border}` }}>Name</th>
                  <th style={{ padding: "14px 16px", borderBottom: `1px solid ${theme.border}` }}>Username</th>
                  <th style={{ padding: "14px 16px", borderBottom: `1px solid ${theme.border}` }}>Email</th>
                  <th style={{ padding: "14px 16px", borderBottom: `1px solid ${theme.border}` }}>Role</th>
                  <th style={{ padding: "14px 16px", borderBottom: `1px solid ${theme.border}`, textAlign: "right" }}>Available Credits</th>
                  <th style={{ padding: "14px 16px", borderBottom: `1px solid ${theme.border}`, textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pageUsers.map((user) => (
                  <tr key={user.id}>
                    <td style={{ padding: "14px 16px", borderBottom: `1px solid ${theme.border}` }}>{user.full_name || "-"}</td>
                    <td style={{ padding: "14px 16px", borderBottom: `1px solid ${theme.border}` }}>{user.username || "-"}</td>
                    <td style={{ padding: "14px 16px", borderBottom: `1px solid ${theme.border}` }}>{user.email || "-"}</td>
                    <td style={{ padding: "14px 16px", borderBottom: `1px solid ${theme.border}` }}>{user.role || "-"}</td>
                    <td style={{ padding: "14px 16px", borderBottom: `1px solid ${theme.border}`, textAlign: "right", fontWeight: 700 }}>
                      {Number(user.credits || 0).toLocaleString()}
                    </td>
                    <td style={{ padding: "14px 16px", borderBottom: `1px solid ${theme.border}`, textAlign: "right" }}>
                      <button type="button" onClick={() => openDeleteCredits(user)} style={{ background: "transparent", color: theme.accent, border: `1px solid ${theme.accent}`, padding: "7px 11px", borderRadius: "7px", cursor: "pointer" }}>
                        Delete Credits
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {!loading && !error && filteredUsers.length > 0 && (
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            totalImages={filteredUsers.length}
            setCurrentPage={setCurrentPage}
            darkMode={isDarkMode}
          />
        )}
      </div>

      {deleteUser && (
        <div onClick={closeDeleteCredits} style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "20px", background: "rgba(15, 23, 42, 0.6)" }}>
          <div onClick={(event) => event.stopPropagation()} style={{ width: "100%", maxWidth: "420px", padding: "24px", borderRadius: "12px", background: theme.surface, color: theme.text, border: `1px solid ${theme.border}` }}>
            <h2 style={{ margin: "0 0 8px", fontSize: "1.25rem" }}>Delete Credits</h2>
            <p style={{ margin: "0 0 18px", color: theme.muted }}>Enter the credits to delete from {deleteUser.username || deleteUser.email || "this user"}.</p>
            <input type="number" min="0.01" step="0.01" value={deleteAmount} onChange={(event) => setDeleteAmount(event.target.value)} placeholder="Enter amount" autoFocus style={{ width: "100%", boxSizing: "border-box", padding: "10px", borderRadius: "8px", border: `1px solid ${theme.border}`, background: theme.surface, color: theme.text }} />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "18px" }}>
              <button type="button" onClick={closeDeleteCredits} disabled={isDeletingCredits} style={{ padding: "9px 14px", borderRadius: "7px", border: `1px solid ${theme.border}`, background: "transparent", color: theme.text, cursor: "pointer" }}>Cancel</button>
              <button type="button" onClick={deleteCredits} disabled={isDeletingCredits || Number(deleteAmount) <= 0} style={{ padding: "9px 14px", borderRadius: "7px", border: "none", background: theme.accent, color: "#fff", cursor: "pointer" }}>{isDeletingCredits ? "Deleting..." : "Delete Credits"}</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
