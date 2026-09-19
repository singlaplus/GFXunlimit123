import { useEffect, useState } from "react";
import axios from "axios";
import { buildAuthHeaders } from "../utils/authSession";
import Pagination from "../components/Pagination";
import "./AdminContributorsPage.css";

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || "http://localhost:5000";
const PAGE_SIZE = 10;

const columns = [
  ["id", "ID"],
  ["full_name", "Full name"],
  ["username", "Username"],
  ["email", "Email"],
  ["role", "Role"],
  ["identity_number", "Identity number"],
  ["credits", "Credits"],
  ["status", "Status"],
  ["otp_enabled", "OTP enabled"],
  ["bulk_upload", "Bulk upload"],
  ["upload_limit", "Upload limit"],
  ["created_at", "Joining date"],
  ["total_uploads", "Uploads"],
  ["total_downloads", "Downloads"],
  ["total_likes", "Likes"],
  ["total_views", "Views"],
  ["total_earnings", "Earnings"],
  ["unpaid_earnings", "Unpaid earnings"],
  ["tax_form_submitted", "Tax submitted"],
  ["tax_form_status", "Tax status"],
  ["tax_form_type", "Tax type"],
  ["tax_form_submitted_at", "Tax submitted at"],
  ["reputation_score", "Reputation"],
  ["approved", "Approved"],
  ["pending", "Pending"],
  ["rejected", "Rejected"],
  ["orders", "Order count"],
  ["loyalty_points", "Loyalty points"]
];

const formatValue = (value) => {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

const formatJoiningDate = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return formatValue(value);
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}-${month}-${date.getFullYear()}`;
};

const formatPermissionValue = (contributor, key) => {
  const permissions = contributor.custom_permissions && typeof contributor.custom_permissions === "object"
    ? contributor.custom_permissions
    : {};
  if (key === "bulk_upload") return permissions.bulk_upload ? "Yes" : "No";
  const hasConfiguredLimit = permissions.upload_limit_value != null || permissions.upload_limit_unit;
  return hasConfiguredLimit
    ? `${permissions.upload_limit_value ?? 20} ${String(permissions.upload_limit_unit || "MB").toUpperCase()}`
    : "20 GB";
};

const getSortableValue = (contributor, key) => {
  if (key === "bulk_upload") return contributor.custom_permissions?.bulk_upload ? 1 : 0;
  if (key === "upload_limit") return formatPermissionValue(contributor, key);
  return contributor[key];
};

const sortContributors = (contributors, key, direction) => [...contributors].sort((first, second) => {
  const firstValue = getSortableValue(first, key);
  const secondValue = getSortableValue(second, key);
  const firstEmpty = firstValue === null || firstValue === undefined || firstValue === "";
  const secondEmpty = secondValue === null || secondValue === undefined || secondValue === "";
  if (firstEmpty || secondEmpty) {
    if (firstEmpty && secondEmpty) return 0;
    return firstEmpty ? 1 : -1;
  }

  const firstNumber = Number(firstValue);
  const secondNumber = Number(secondValue);
  const bothNumeric = !Number.isNaN(firstNumber) && !Number.isNaN(secondNumber) && typeof firstValue !== "boolean" && typeof secondValue !== "boolean";
  const comparison = bothNumeric
    ? firstNumber - secondNumber
    : String(firstValue).localeCompare(String(secondValue), undefined, { numeric: true, sensitivity: "base" });
  return direction === "asc" ? comparison : -comparison;
});

export default function AdminContributorsPage({ darkMode = false }) {
  const [contributors, setContributors] = useState([]);
  const [state, setState] = useState("loading");
  const [sortConfig, setSortConfig] = useState({ key: null, direction: "asc" });
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    let mounted = true;
    axios.get(`${API_BASE_URL}/admin/users`, { headers: buildAuthHeaders() })
      .then((response) => {
        if (!mounted) return;
        const users = Array.isArray(response.data) ? response.data : [];
        setContributors(users.filter((user) => String(user.role || "").toLowerCase() === "contributor"));
        setState("ready");
      })
      .catch(() => {
        if (mounted) setState("error");
      });
    return () => { mounted = false; };
  }, []);

  const sortedContributors = sortConfig.key
    ? sortContributors(contributors, sortConfig.key, sortConfig.direction)
    : contributors;
  const totalPages = Math.max(1, Math.ceil(sortedContributors.length / PAGE_SIZE));
  const visibleContributors = sortedContributors.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const handleSort = (key) => {
    setCurrentPage(1);
    setSortConfig((current) => ({
      key,
      direction: current.key === key && current.direction === "asc" ? "desc" : "asc"
    }));
  };

  return (
    <main className="admin-contributors-page" aria-label="Contributors">
      <div className="admin-contributors-table-scroll">
        <table className="admin-contributors-table">
        <caption>Contributors</caption>
        <thead>
          <tr>{columns.map(([key, label]) => {
            const isActive = sortConfig.key === key;
            return (
              <th key={label} scope="col" aria-sort={isActive ? (sortConfig.direction === "asc" ? "ascending" : "descending") : "none"}>
                <button type="button" className="admin-contributors-sort-button" onClick={() => handleSort(key)}>
                  <span>{label}</span>
                  <span className={`admin-contributors-sort-arrow${isActive ? " is-active" : ""}`} aria-hidden="true">{isActive ? (sortConfig.direction === "asc" ? "↑" : "↓") : "↕"}</span>
                </button>
              </th>
            );
          })}</tr>
        </thead>
        <tbody>
          {state === "loading" && <tr><td colSpan={columns.length}>Loading contributors...</td></tr>}
          {state === "error" && <tr><td colSpan={columns.length}>Unable to load contributors.</td></tr>}
          {state === "ready" && contributors.length === 0 && <tr><td colSpan={columns.length}>No contributors found.</td></tr>}
          {visibleContributors.map((contributor) => (
            <tr key={contributor.id}>
              {columns.map(([key]) => (
                <td key={key}>{key === "created_at" || key === "tax_form_submitted_at" ? formatJoiningDate(contributor[key]) : key === "bulk_upload" || key === "upload_limit" ? formatPermissionValue(contributor, key) : formatValue(contributor[key])}</td>
              ))}
            </tr>
          ))}
        </tbody>
        </table>
      </div>
      {state === "ready" && contributors.length > 0 && (
        <Pagination currentPage={currentPage} totalPages={totalPages} totalImages={sortedContributors.length} setCurrentPage={setCurrentPage} darkMode={darkMode} />
      )}
    </main>
  );
}