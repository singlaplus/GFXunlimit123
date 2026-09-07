import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { getEffectiveAuthToken } from "../utils/authSession";

export default function AdminSubscribersPage({
  darkMode = false,
  pageTitle = "View Subscribers",
  pageSubtitle = "Customers with subscription records.",
  pageMode = "subscribers",
}) {
  const isCustomRequestsPage = pageMode === "custom-requests";
  const [subscribers, setSubscribers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedSubscriber, setSelectedSubscriber] = useState(null);
  const [details, setDetails] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [actionNotice, setActionNotice] = useState(null);
  const actionNoticeTimer = useRef(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [planFilter, setPlanFilter] = useState("all");
  const [showAddSubscription, setShowAddSubscription] = useState(false);
  const [customers, setCustomers] = useState([]);
  const [availablePlans, setAvailablePlans] = useState([]);
  const [customerQuery, setCustomerQuery] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [selectedDuration, setSelectedDuration] = useState("");
  const [assignmentRemarks, setAssignmentRemarks] = useState("");
  const [savingSubscription, setSavingSubscription] = useState(false);
  const [addSubscriptionError, setAddSubscriptionError] = useState("");
  const [showExportRange, setShowExportRange] = useState(false);
  const [exportStartDate, setExportStartDate] = useState("");
  const [exportEndDate, setExportEndDate] = useState("");
  const [exportRangeError, setExportRangeError] = useState("");

  useEffect(() => {
    const fetchSubscribers = async () => {
      try {
        const token = getEffectiveAuthToken();
        const response = await axios.get(
          `${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"}/admin/custom-subscriptions`,
          { headers: token ? { Authorization: `Bearer ${token}` } : {} },
        );
        setSubscribers(Array.isArray(response.data) ? response.data : []);
      } catch (err) {
        console.error(err);
        setError(err.response?.data?.error || "Unable to load subscribers.");
      } finally {
        setLoading(false);
      }
    };

    fetchSubscribers();
  }, []);

  useEffect(() => {
    const loadAssignmentOptions = async () => {
      try {
        const token = getEffectiveAuthToken();
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        const [usersResponse, plansResponse] = await Promise.all([
          axios.get(
            `${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"}/admin/users`,
            { headers },
          ),
          axios.get(
            `${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"}/admin/subscription-plans`,
            { headers },
          ),
        ]);
        setCustomers(
          (usersResponse.data || []).filter(
            (user) => user.role === "customer" && user.status !== "blocked",
          ),
        );
        setAvailablePlans(
          (plansResponse.data || []).filter((plan) => plan.active),
        );
      } catch (err) {
        setAddSubscriptionError(
          err.response?.data?.error || "Unable to load customers and plans.",
        );
      }
    };
    loadAssignmentOptions();
  }, []);

  const openAddSubscription = () => {
    const firstPlan = availablePlans[0];
    const firstDuration =
      Object.keys(firstPlan?.pricing?.prices || {})[0] || "monthly";
    setSelectedCustomer(null);
    setCustomerQuery("");
    setSelectedPlanId(firstPlan ? String(firstPlan.id) : "");
    setSelectedDuration(firstDuration);
    setAssignmentRemarks("");
    setAddSubscriptionError("");
    setShowAddSubscription(true);
  };

  const selectedPlan = availablePlans.find(
    (plan) => String(plan.id) === String(selectedPlanId),
  );
  const matchingCustomers = customers
    .filter((customer) =>
      `${customer.username || ""} ${customer.email || ""} ${customer.full_name || ""}`
        .toLowerCase()
        .includes(customerQuery.trim().toLowerCase()),
    )
    .slice(0, 8);
  const saveAssignedSubscription = async () => {
    if (!selectedCustomer || !selectedPlanId) {
      setAddSubscriptionError("Select a customer and subscription plan.");
      return;
    }
    setSavingSubscription(true);
    setAddSubscriptionError("");
    try {
      const token = getEffectiveAuthToken();
      const response = await axios.post(
        `${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"}/admin/custom-subscriptions/assign`,
        {
          customerId: selectedCustomer.id,
          planId: selectedPlanId,
          duration: selectedDuration,
          remarks: assignmentRemarks.trim(),
        },
        { headers: token ? { Authorization: `Bearer ${token}` } : {} },
      );
      setShowAddSubscription(false);
      window.location.reload();
    } catch (err) {
      setAddSubscriptionError(
        err.response?.data?.error || "Unable to add subscription.",
      );
    } finally {
      setSavingSubscription(false);
    }
  };

  const openDetails = async (subscriber) => {
    setSelectedSubscriber(subscriber);
    setDetailsLoading(true);
    try {
      const token = getEffectiveAuthToken();
      const response = await axios.get(
        `${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"}/admin/custom-subscriptions/${subscriber.id}/details`,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} },
      );
      setDetails(response.data);
    } catch (err) {
      setError(
        err.response?.data?.error || "Unable to load subscriber details.",
      );
    } finally {
      setDetailsLoading(false);
    }
  };

  const revokeSubscription = async () => {
    if (!selectedSubscriber || !window.confirm("Revoke this subscription?"))
      return;
    setRevoking(true);
    try {
      const token = getEffectiveAuthToken();
      await axios.post(
        `${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"}/admin/custom-subscriptions/${selectedSubscriber.id}/revoke`,
        {},
        { headers: token ? { Authorization: `Bearer ${token}` } : {} },
      );
      setSubscribers((current) =>
        current.map((item) =>
          item.id === selectedSubscriber.id
            ? { ...item, status: "revoked" }
            : item,
        ),
      );
      setDetails((current) =>
        current
          ? {
              ...current,
              subscription: { ...current.subscription, status: "revoked" },
            }
          : current,
      );
    } catch (err) {
      setError(err.response?.data?.error || "Unable to revoke subscription.");
    } finally {
      setRevoking(false);
    }
  };

  const updateSubscriptionStatus = async (
    status,
    subscriber = selectedSubscriber,
  ) => {
    if (!subscriber) return;
    const action =
      status === "approved"
        ? "approve"
        : status === "rejected"
          ? "reject"
          : status;
    const nextStatus =
      action === "approve"
        ? "active"
        : action === "reject"
          ? "rejected"
          : action === "complete"
            ? "completed"
            : action;
    setUpdatingStatus(true);
    try {
      const token = getEffectiveAuthToken();
      const response = await axios.post(
        `${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"}/admin/custom-subscriptions/${subscriber.id}/${action}`,
        {},
        { headers: token ? { Authorization: `Bearer ${token}` } : {} },
      );
      setSubscribers((current) =>
        current.map((item) =>
          item.id === subscriber.id
            ? { ...item, status: nextStatus, completed_at: response.data?.completed_at || item.completed_at }
            : item,
        ),
      );
      setDetails((current) =>
        current
          ? {
              ...current,
              subscription: { ...current.subscription, status: nextStatus, completed_at: response.data?.completed_at || current.subscription.completed_at },
            }
          : current,
      );
      if (actionNoticeTimer.current)
        window.clearTimeout(actionNoticeTimer.current);
      setActionNotice({
        type: action,
        name: subscriber.customer_name || "Subscriber",
      });
      actionNoticeTimer.current = window.setTimeout(
        () => setActionNotice(null),
        5000,
      );
    } catch (err) {
      setError(
        err.response?.data?.error || `Unable to ${action} subscription.`,
      );
    } finally {
      setUpdatingStatus(false);
    }
  };

  const textColor = darkMode ? "#f8fafc" : "#111827";
  const mutedColor = darkMode ? "#cbd5e1" : "#475569";
  const surfaceColor = darkMode ? "#1f2937" : "#ffffff";
  const isSubmittedCustomRequest = (subscriber) =>
    subscriber.custom_pricing?.source === "pricing_page" ||
    (subscriber.base_plan === "Custom Subscription" && subscriber.status === "pending");
  const visibleSubscribers = isCustomRequestsPage
    ? subscribers.filter(isSubmittedCustomRequest)
    : subscribers.filter((subscriber) => !isSubmittedCustomRequest(subscriber));
  const plans = [
    ...new Set(
      visibleSubscribers.map((subscriber) => subscriber.base_plan).filter(Boolean),
    ),
  ];
  const filteredSubscribers = visibleSubscribers.filter((subscriber) => {
    const haystack = isCustomRequestsPage
      ? `${subscriber.customer_name || ""} ${subscriber.customer_email || ""} ${subscriber.custom_pricing?.mobile_number || ""} ${subscriber.custom_pricing?.requested_assets_per_month || ""} ${subscriber.custom_pricing?.requested_asset_price || ""} ${subscriber.custom_pricing?.team_size || ""} ${subscriber.custom_duration || ""}`.toLowerCase()
      : `${subscriber.customer_name || ""} ${subscriber.customer_email || ""} ${subscriber.base_plan || ""}`.toLowerCase();
    return (
      (!search.trim() || haystack.includes(search.trim().toLowerCase())) &&
      (statusFilter === "all" || subscriber.status === statusFilter) &&
      (planFilter === "all" || (isCustomRequestsPage ? subscriber.custom_duration === planFilter : subscriber.base_plan === planFilter))
    );
  });

  const exportCsv = () => {
    if (!exportStartDate || !exportEndDate) {
      setExportRangeError("Select both start and end dates.");
      return;
    }
    if (exportStartDate > exportEndDate) {
      setExportRangeError("Start date cannot be after the end date.");
      return;
    }
    const rangeStart = new Date(`${exportStartDate}T00:00:00`);
    const rangeEnd = new Date(`${exportEndDate}T23:59:59.999`);
    const exportSubscribers = filteredSubscribers.filter((subscriber) => {
      const submittedDate = isCustomRequestsPage
        ? subscriber.custom_pricing?.submitted_at || subscriber.created_at
        : subscriber.created_at;
      if (!submittedDate) return false;
      const recordDate = new Date(submittedDate);
      return recordDate >= rangeStart && recordDate <= rangeEnd;
    });
    const headers = isCustomRequestsPage
      ? ["Name", "Mobile Number", "Email ID", "Assets / Month", "Price / Asset", "Team Size", "Plan Duration", "Submitted Date", "Days Old", "Status"]
      : ["Customer", "Email", "Plan", "Status", "Purchase Date", "Start Date", "Expiry Date", "Expires In Days", "Remaining Downloads", "Admin Remark"];
    const rows = exportSubscribers.map((subscriber) => isCustomRequestsPage
      ? [
          subscriber.customer_name,
          subscriber.custom_pricing?.mobile_number,
          subscriber.customer_email,
          subscriber.custom_pricing?.requested_assets_per_month,
          subscriber.custom_pricing?.requested_asset_price,
          subscriber.custom_pricing?.team_size,
          subscriber.custom_duration,
          subscriber.custom_pricing?.submitted_at || subscriber.created_at,
          getDaysOld(subscriber),
          subscriber.status,
        ]
      : [
          subscriber.customer_name,
          subscriber.customer_email,
          subscriber.base_plan,
          subscriber.status,
          formatDate(subscriber.created_at),
          formatDate(subscriber.custom_start_date),
          formatDate(subscriber.custom_end_date),
          getExpiryDays(subscriber),
          getRemainingDownloads(subscriber),
          subscriber.admin_notes?.remarks || subscriber.activity_log?.[0]?.remarks || "",
        ]);
    const csv = [headers, ...rows]
      .map((row) =>
        row
          .map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`)
          .join(","),
      )
      .join("\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8;" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = isCustomRequestsPage ? "custom-subscriptions.csv" : "subscribers.csv";
    link.click();
    URL.revokeObjectURL(url);
    setShowExportRange(false);
    setExportRangeError("");
  };

  const getExpiryDays = (subscriber) =>
    subscriber.custom_end_date
      ? Math.max(
          0,
          Math.ceil(
            (new Date(subscriber.custom_end_date) - new Date()) / 86400000,
          ),
        )
      : "—";
  const getDaysOld = (subscriber) => {
    const submittedDate = subscriber.custom_pricing?.submitted_at || subscriber.created_at;
    if (!submittedDate) return "—";
    const submitted = new Date(submittedDate);
    if (Number.isNaN(submitted.getTime())) return "—";
    const endDate = subscriber.completed_at ? new Date(subscriber.completed_at) : new Date();
    if (Number.isNaN(endDate.getTime())) return "—";
    const currentDate = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
    const submittedDay = new Date(submitted.getFullYear(), submitted.getMonth(), submitted.getDate());
    return Math.max(0, Math.floor((currentDate - submittedDay) / 86400000));
  };
  const getRemainingDownloads = (subscriber) =>
    subscriber.remaining_downloads ??
    (subscriber.custom_permissions?.download_limit != null
      ? Math.max(
          0,
          Number(subscriber.custom_permissions.download_limit) -
            Number(subscriber.used_downloads || 0),
        )
      : "Unlimited");
  const formatDate = (value) => {
    if (!value) return "—";
    const date = new Date(value);
    return `${String(date.getDate()).padStart(2, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getFullYear()).slice(-2)}`;
  };
  const getStatusStyle = (status) => {
    const styles = {
      active: {
        background: darkMode ? "#123c35" : "#dcfce7",
        color: darkMode ? "#86efac" : "#166534",
      },
      pending: {
        background: darkMode ? "#45320b" : "#fef3c7",
        color: darkMode ? "#fcd34d" : "#92400e",
      },
      rejected: {
        background: darkMode ? "#481b24" : "#fee2e2",
        color: darkMode ? "#fda4af" : "#991b1b",
      },
      revoked: {
        background: darkMode ? "#252b36" : "#e2e8f0",
        color: mutedColor,
      },
    };
    return styles[status] || styles.revoked;
  };

  const hasDetailValue = (value) =>
    value !== null && value !== undefined && value !== "";

  const formatDetailValue = (value) => {
    if (!hasDetailValue(value)) return "";
    return typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);
  };

  useEffect(
    () => () => {
      if (actionNoticeTimer.current)
        window.clearTimeout(actionNoticeTimer.current);
    },
    [],
  );

  return (
    <main
      style={{
        width: "100%",
        maxWidth: "none",
        margin: 0,
        padding: "32px 24px",
        boxSizing: "border-box",
        color: textColor,
      }}
    >
      <style>{`@keyframes subscriberNoticeIn { from { opacity: 0; transform: translate(-50%, -16px) scale(.94); } to { opacity: 1; transform: translate(-50%, 0) scale(1); } } @keyframes subscriberNoticeMark { from { transform: scale(0) rotate(-18deg); } 70% { transform: scale(1.12) rotate(4deg); } to { transform: scale(1) rotate(0); } } @keyframes subscriberNoticeProgress { from { width: 100%; } to { width: 0%; } }`}</style>
      {actionNotice && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: "fixed",
            top: 28,
            left: "50%",
            zIndex: 1500,
            width: "min(420px, calc(100vw - 32px))",
            overflow: "hidden",
            transform: "translateX(-50%)",
            border: `1px solid ${actionNotice.type === "approve" ? (darkMode ? "#166534" : "#bbf7d0") : darkMode ? "#991b1b" : "#fecaca"}`,
            borderRadius: 16,
            background: darkMode ? "#111827" : "#ffffff",
            color: textColor,
            boxShadow: "0 18px 55px rgba(15,23,42,0.28)",
            animation: "subscriberNoticeIn .42s cubic-bezier(.2,.8,.2,1)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 13,
              padding: "16px 18px",
            }}
          >
            <div
              style={{
                width: 38,
                height: 38,
                flex: "0 0 auto",
                display: "grid",
                placeItems: "center",
                borderRadius: "50%",
                background:
                  actionNotice.type === "approve" ? "#dcfce7" : "#fee2e2",
                color: actionNotice.type === "approve" ? "#15803d" : "#dc2626",
                fontSize: 23,
                fontWeight: 900,
                animation: "subscriberNoticeMark .55s .12s both",
              }}
            >
              {actionNotice.type === "approve" ? "✓" : "×"}
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <strong style={{ display: "block", fontSize: 15 }}>
                {actionNotice.type === "approve"
                  ? "Subscription approved"
                  : "Subscription rejected"}
              </strong>
              <span
                style={{
                  display: "block",
                  marginTop: 3,
                  overflow: "hidden",
                  color: mutedColor,
                  fontSize: 13,
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {actionNotice.name} has been{" "}
                {actionNotice.type === "approve" ? "approved" : "rejected"}.
              </span>
            </div>
            <button
              type="button"
              aria-label="Dismiss notification"
              title="Dismiss notification"
              onClick={() => setActionNotice(null)}
              style={{
                border: 0,
                background: "transparent",
                color: mutedColor,
                fontSize: 20,
                cursor: "pointer",
                lineHeight: 1,
              }}
            >
              ×
            </button>
          </div>
          <div
            style={{
              height: 3,
              background:
                actionNotice.type === "approve" ? "#16a34a" : "#dc2626",
              animation: "subscriberNoticeProgress 5s linear forwards",
            }}
          />
        </div>
      )}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
          marginBottom: 24,
        }}
      >
        <div>
          <h1 style={{ margin: 0 }}>{pageTitle}</h1>
          <p style={{ margin: "8px 0 0", color: mutedColor }}>
            {pageSubtitle}
          </p>
        </div>
        {!isCustomRequestsPage && <button
          type="button"
          onClick={openAddSubscription}
          style={{
            padding: "11px 16px",
            border: 0,
            borderRadius: 9,
            background: "#1d4ed8",
            color: "#fff",
            fontWeight: 800,
            cursor: "pointer",
          }}
        >
          Add subscription
        </button>
        }
      </div>
      {loading && <p style={{ color: mutedColor }}>Loading subscribers...</p>}
      {!loading && !error && visibleSubscribers.length === 0 && (
        <p style={{ color: mutedColor }}>{isCustomRequestsPage ? "No custom subscription requests found." : "No subscribed customers found."}</p>
      )}
      {!loading && !error && visibleSubscribers.length > 0 && (
        <>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
              marginBottom: 14,
            }}
          >
            <input
              aria-label="Search subscribers"
              placeholder={isCustomRequestsPage ? "Search name, email, mobile, assets, price, or team size" : "Search customer, email, or plan"}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              style={{
                flex: "1 1 260px",
                padding: "11px 12px",
                border: "1px solid #cbd5e1",
                borderRadius: 9,
              }}
            />
            <select
              aria-label="Filter by status"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              style={{
                padding: "11px 12px",
                border: "1px solid #cbd5e1",
                borderRadius: 9,
              }}
            >
              <option value="all">All statuses</option>
              <option value="pending">Pending</option>
              <option value="active">Active</option>
              <option value="completed">Completed</option>
              <option value="rejected">Rejected</option>
              <option value="revoked">Revoked</option>
            </select>
            <select
              aria-label="Filter by plan"
              value={planFilter}
              onChange={(event) => setPlanFilter(event.target.value)}
              style={{
                padding: "11px 12px",
                border: "1px solid #cbd5e1",
                borderRadius: 9,
              }}
            >
              <option value="all">{isCustomRequestsPage ? "All durations" : "All plans"}</option>
              {isCustomRequestsPage
                ? [...new Set(visibleSubscribers.map((subscriber) => subscriber.custom_duration).filter(Boolean))].map((duration) => (
                  <option key={duration} value={duration}>{duration.replaceAll("_", " ")}</option>
                ))
                : plans.map((plan) => (
                <option key={plan} value={plan}>
                  {plan}
                </option>
                ))}
            </select>
            <button
              type="button"
              onClick={() => {
                setExportRangeError("");
                setShowExportRange(true);
              }}
              style={{
                marginLeft: "auto",
                padding: "11px 14px",
                border: 0,
                borderRadius: 9,
                background: "#0f766e",
                color: "#fff",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Export CSV
            </button>
          </div>
          <div
            style={{
              overflowX: "auto",
              border: "1px solid #dbe3ed",
              borderRadius: 12,
              background: surfaceColor,
            }}
          >
            <table
              style={{
                width: "100%",
                minWidth: isCustomRequestsPage ? 1120 : 900,
                borderCollapse: "collapse",
              }}
            >
              <thead>
                <tr
                  style={{
                    background: darkMode ? "#111827" : "#f8fafc",
                    textAlign: "left",
                  }}
                >
                  {(isCustomRequestsPage
                    ? ["Name", "Mobile Number", "Email ID", "Assets / Month", "Price / Asset", "Team Size", "Plan Duration", "Submitted", "Days Old", "Status", "Actions"]
                    : ["Customer", "Plan", "Status", "Purchase Date", "Expiry Date", "Expires In", "Remaining Downloads", "Actions"]
                  ).map((heading) => (
                    <th
                      key={heading}
                      style={{
                        padding: "13px 14px",
                        color: mutedColor,
                        fontSize: 12,
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                      }}
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredSubscribers.map((subscriber) => (
                  <tr
                    key={subscriber.id}
                    style={{ borderTop: "1px solid #e2e8f0" }}
                  >
                    {isCustomRequestsPage ? (
                      <>
                        <td style={{ padding: "14px" }}><strong>{subscriber.customer_name || "Not provided"}</strong></td>
                        <td style={{ padding: "14px", color: mutedColor }}>{subscriber.custom_pricing?.mobile_number || "Not provided"}</td>
                        <td style={{ padding: "14px", color: mutedColor }}>{subscriber.customer_email || "Not provided"}</td>
                        <td style={{ padding: "14px" }}>{subscriber.custom_pricing?.requested_assets_per_month ?? "Not provided"}</td>
                        <td style={{ padding: "14px" }}>{subscriber.custom_pricing?.requested_asset_price ?? "Not provided"}</td>
                        <td style={{ padding: "14px" }}>{subscriber.custom_pricing?.team_size ?? "Not provided"}</td>
                        <td style={{ padding: "14px" }}>{subscriber.custom_duration || "Not provided"}</td>
                        <td style={{ padding: "14px", color: mutedColor }}>{formatDate(subscriber.custom_pricing?.submitted_at || subscriber.created_at)}</td>
                        <td style={{ padding: "14px", fontWeight: 700 }}>{getDaysOld(subscriber)}</td>
                        <td style={{ padding: "14px" }}>{subscriber.status || "Pending"}</td>
                      </>
                    ) : (
                      <>
                        <td style={{ padding: "14px" }}>
                          <strong>{subscriber.customer_name || "Unnamed customer"}</strong>
                          <div style={{ color: mutedColor, fontSize: 13 }}>{subscriber.customer_email || "No email"}</div>
                        </td>
                        <td style={{ padding: "14px" }}>{subscriber.base_plan || "Not specified"}</td>
                        <td style={{ padding: "14px" }}>{subscriber.status || "Unknown"}</td>
                        <td style={{ padding: "14px", color: mutedColor }}>{formatDate(subscriber.created_at)}</td>
                        <td style={{ padding: "14px", color: mutedColor }}>{formatDate(subscriber.custom_end_date)}</td>
                        <td style={{ padding: "14px", color: mutedColor }}>{getExpiryDays(subscriber)}{getExpiryDays(subscriber) !== "—" ? " days" : ""}</td>
                        <td style={{ padding: "14px", color: mutedColor }}>{getRemainingDownloads(subscriber)}</td>
                      </>
                    )}
                    <td style={{ padding: "14px" }}>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button
                          type="button"
                          onClick={() => openDetails(subscriber)}
                          style={{
                            padding: "7px 10px",
                            border: 0,
                            borderRadius: 7,
                            background: "#1d4ed8",
                            color: "#fff",
                            cursor: "pointer",
                          }}
                        >
                          Details
                        </button>
                        {!isCustomRequestsPage && subscriber.status === "pending" && (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedSubscriber(subscriber);
                                updateSubscriptionStatus(
                                  "approved",
                                  subscriber,
                                );
                              }}
                              style={{
                                padding: "7px 10px",
                                border: 0,
                                borderRadius: 7,
                                background: "#16a34a",
                                color: "#fff",
                                cursor: "pointer",
                              }}
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedSubscriber(subscriber);
                                updateSubscriptionStatus(
                                  "rejected",
                                  subscriber,
                                );
                              }}
                              style={{
                                padding: "7px 10px",
                                border: 0,
                                borderRadius: 7,
                                background: "#dc2626",
                                color: "#fff",
                                cursor: "pointer",
                              }}
                            >
                              Reject
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {selectedSubscriber && (
        <div
          onClick={() => setSelectedSubscriber(null)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1200,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
            background: "rgba(2,6,23,0.78)",
            backdropFilter: "blur(8px)",
          }}
        >
          <section
            onClick={(event) => event.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: 820,
              maxHeight: "90vh",
              overflowY: "auto",
              border: darkMode ? "1px solid #334155" : "1px solid #dbe3ed",
              borderRadius: 22,
              background: surfaceColor,
              color: textColor,
              boxShadow: "0 30px 100px rgba(0,0,0,0.38)",
            }}
          >
            <div
              style={{
                height: 5,
                background: "#ed2224",
                borderRadius: "22px 22px 0 0",
              }}
            />
            <div style={{ padding: "24px 28px 28px" }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 18,
                  alignItems: "flex-start",
                }}
              >
                <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                  <div
                    style={{
                      width: 48,
                      height: 48,
                      display: "grid",
                      placeItems: "center",
                      borderRadius: 14,
                      background: darkMode ? "#334155" : "#e8eef8",
                      color: darkMode ? "#bfdbfe" : "#1d4ed8",
                      fontSize: 20,
                      fontWeight: 800,
                    }}
                  >
                    {(selectedSubscriber.customer_name || "U")
                      .charAt(0)
                      .toUpperCase()}
                  </div>
                  <div>
                    <p
                      style={{
                        margin: 0,
                        color: "#ed2224",
                        fontSize: 11,
                        fontWeight: 800,
                        letterSpacing: "0.16em",
                        textTransform: "uppercase",
                      }}
                    >
                      Subscription review
                    </p>
                    <h2 style={{ margin: "4px 0 2px", fontSize: 24 }}>
                      {selectedSubscriber.customer_name || "Unnamed customer"}
                    </h2>
                    <p style={{ margin: 0, color: mutedColor }}>
                      {selectedSubscriber.customer_email ||
                        "No email available"}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  title="Close details"
                  aria-label="Close details"
                  onClick={() => setSelectedSubscriber(null)}
                  style={{
                    width: 36,
                    height: 36,
                    border: `1px solid ${darkMode ? "#475569" : "#cbd5e1"}`,
                    borderRadius: 10,
                    background: "transparent",
                    color: mutedColor,
                    fontSize: 21,
                    lineHeight: 1,
                    cursor: "pointer",
                  }}
                >
                  ×
                </button>
              </div>
              {detailsLoading && (
                <p style={{ margin: "30px 0 8px", color: mutedColor }}>
                  Loading complete order details...
                </p>
              )}
              {!detailsLoading && details && (
                <div style={{ display: "grid", gap: 20, marginTop: 26 }}>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                      gap: 10,
                    }}
                  >
                    {[
                      {
                        label: "Plan",
                        value:
                          details.subscription.base_plan || "Not specified",
                      },
                      {
                        label: "Status",
                        value: details.subscription.status || "Unknown",
                        status: true,
                      },
                      {
                        label: "Expires",
                        value: details.subscription.custom_end_date
                          ? `${getExpiryDays(details.subscription)} days`
                          : "No expiry",
                      },
                    ].map((item) => (
                      <div
                        key={item.label}
                        style={{
                          padding: "14px 15px",
                          border: `1px solid ${darkMode ? "#334155" : "#e2e8f0"}`,
                          borderRadius: 13,
                          background: darkMode ? "#172033" : "#f8fafc",
                        }}
                      >
                        <p
                          style={{
                            margin: 0,
                            color: mutedColor,
                            fontSize: 11,
                            fontWeight: 800,
                            letterSpacing: "0.08em",
                            textTransform: "uppercase",
                          }}
                        >
                          {item.label}
                        </p>
                        {item.status ? (
                          <span
                            style={{
                              display: "inline-block",
                              marginTop: 8,
                              padding: "4px 9px",
                              borderRadius: 999,
                              fontSize: 12,
                              fontWeight: 800,
                              ...getStatusStyle(item.value),
                            }}
                          >
                            {item.value}
                          </span>
                        ) : (
                          <strong
                            style={{
                              display: "block",
                              marginTop: 7,
                              fontSize: 16,
                            }}
                          >
                            {item.value}
                          </strong>
                        )}
                      </div>
                    ))}
                  </div>
                  <div
                    style={{
                      padding: 18,
                      border: `1px solid ${darkMode ? "#334155" : "#dbe3ed"}`,
                      borderRadius: 14,
                      background: darkMode ? "#172033" : "#f8fafc",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
                      <div>
                        <p style={{ margin: 0, color: "#0f766e", fontSize: 11, fontWeight: 900, letterSpacing: "0.14em", textTransform: "uppercase" }}>Customer request</p>
                        <h3 style={{ margin: "5px 0 0", fontSize: 17 }}>Submitted requirements</h3>
                      </div>
                      <span style={{ color: mutedColor, fontSize: 12 }}>Only supplied values are shown</span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10, marginTop: 16 }}>
                      {[
                        ["Request ID", details.subscription.id],
                        ["Customer ID", details.subscription.customer_id],
                        ["Name", details.subscription.customer_name],
                        ["Email", details.subscription.customer_email],
                        ["Mobile number", details.subscription.custom_pricing?.mobile_number],
                        ["Assets per month", details.subscription.custom_pricing?.requested_assets_per_month],
                        ["Price per asset", details.subscription.custom_pricing?.requested_asset_price],
                        ["Team size", details.subscription.custom_pricing?.team_size],
                        ["Requested duration", details.subscription.custom_duration],
                        ["Submitted at", details.subscription.custom_pricing?.submitted_at || details.subscription.created_at],
                        ["Request source", details.subscription.custom_pricing?.source || details.subscription.admin_notes?.source],
                      ].filter(([, value]) => hasDetailValue(value)).map(([label, value]) => (
                        <div key={label} style={{ padding: "11px 12px", border: `1px solid ${darkMode ? "#334155" : "#e2e8f0"}`, borderRadius: 10, background: darkMode ? "#111827" : "#ffffff" }}>
                          <div style={{ color: mutedColor, fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
                          <div style={{ marginTop: 5, fontSize: 14, fontWeight: 700, overflowWrap: "anywhere" }}>{formatDetailValue(value)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
                      gap: 18,
                    }}
                  >
                    <div
                      style={{
                        padding: 18,
                        border: `1px solid ${darkMode ? "#334155" : "#e2e8f0"}`,
                        borderRadius: 14,
                      }}
                    >
                      <h3 style={{ margin: "0 0 14px", fontSize: 15 }}>
                        Subscription details
                      </h3>
                      {[
                        [
                          "Purchase date",
                          formatDate(details.subscription.created_at),
                        ],
                        [
                          "Duration",
                          details.subscription.custom_duration ||
                            "Not specified",
                        ],
                        [
                          "Start date",
                          formatDate(details.subscription.custom_start_date),
                        ],
                        [
                          "Expiry date",
                          formatDate(details.subscription.custom_end_date),
                        ],
                        [
                          "Completed date",
                          formatDate(details.subscription.completed_at),
                        ],
                      ].filter(([, value]) => hasDetailValue(value) && value !== "—").map(([label, value]) => (
                        <div
                          key={label}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            gap: 12,
                            padding: "9px 0",
                            borderTop: `1px solid ${darkMode ? "#334155" : "#eef2f7"}`,
                            fontSize: 13,
                          }}
                        >
                          <span style={{ color: mutedColor }}>{label}</span>
                          <strong>{value}</strong>
                        </div>
                      ))}
                    </div>
                    <div
                      style={{
                        padding: 18,
                        border: `1px solid ${darkMode ? "#334155" : "#e2e8f0"}`,
                        borderRadius: 14,
                      }}
                    >
                      <h3 style={{ margin: "0 0 14px", fontSize: 15 }}>
                        Order & payment
                      </h3>
                      {details.order ? (
                        Object.entries(details.order)
                          .filter(([key]) =>
                            [
                              "order_number",
                              "invoice_number",
                              "payment_method",
                              "payment_status",
                              "total_amount",
                            ].includes(key),
                          )
                          .filter(([, value]) => hasDetailValue(value))
                          .map(([key, value]) => (
                            <div
                              key={key}
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                gap: 12,
                                padding: "9px 0",
                                borderTop: `1px solid ${darkMode ? "#334155" : "#eef2f7"}`,
                                fontSize: 13,
                              }}
                            >
                              <span
                                style={{
                                  color: mutedColor,
                                  textTransform: "capitalize",
                                }}
                              >
                                {key.replaceAll("_", " ")}
                              </span>
                              <strong>
                                {typeof value === "object" && value !== null
                                  ? JSON.stringify(value)
                                  : String(value ?? "")}
                              </strong>
                            </div>
                          ))
                      ) : (
                        <p style={{ color: mutedColor }}>
                          No linked order found.
                        </p>
                      )}
                        {details.order?.admin_remarks && (
                          <div
                            style={{
                              marginTop: 14,
                              padding: "11px 12px",
                              borderRadius: 10,
                              background: darkMode ? "#332b16" : "#fffbeb",
                              color: darkMode ? "#fde68a" : "#92400e",
                              fontSize: 12,
                            }}
                          >
                            <strong>Admin remark</strong>
                            <div style={{ marginTop: 4 }}>
                              {details.order.admin_remarks}
                            </div>
                          </div>
                        )}
                      {details.payments.length > 0 && (
                        <p
                          style={{
                            margin: "14px 0 0",
                            color: mutedColor,
                            fontSize: 12,
                          }}
                        >
                          {details.payments.length} payment record
                          {details.payments.length === 1 ? "" : "s"} on file
                        </p>
                      )}
                    </div>
                  </div>
                  {!isCustomRequestsPage && details.subscription.status === "pending" && (
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "flex-end",
                        gap: 10,
                        paddingTop: 2,
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => updateSubscriptionStatus("rejected")}
                        disabled={updatingStatus}
                        style={{
                          padding: "11px 16px",
                          border: `1px solid ${darkMode ? "#7f1d1d" : "#fecaca"}`,
                          borderRadius: 10,
                          background: "transparent",
                          color: darkMode ? "#fda4af" : "#b91c1c",
                          fontWeight: 800,
                          cursor: "pointer",
                        }}
                      >
                        Reject
                      </button>
                      <button
                        type="button"
                        onClick={() => updateSubscriptionStatus("approved")}
                        disabled={updatingStatus}
                        style={{
                          padding: "11px 18px",
                          border: 0,
                          borderRadius: 10,
                          background: "#15803d",
                          color: "#fff",
                          fontWeight: 800,
                          cursor: "pointer",
                          boxShadow: "0 6px 16px rgba(21,128,61,0.22)",
                        }}
                      >
                        {updatingStatus
                          ? "Updating..."
                          : "Approve subscription"}
                      </button>
                    </div>
                  )}
                  {isCustomRequestsPage && details.subscription.status !== "completed" && (
                    <button
                      type="button"
                      onClick={() => updateSubscriptionStatus("complete")}
                      disabled={updatingStatus}
                      style={{
                        justifySelf: "end",
                        padding: "11px 18px",
                        border: 0,
                        borderRadius: 10,
                        background: "#2563eb",
                        color: "#fff",
                        fontWeight: 800,
                        cursor: "pointer",
                        boxShadow: "0 6px 16px rgba(37,99,235,0.22)",
                      }}
                    >
                      {updatingStatus ? "Updating..." : "Completed"}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={revokeSubscription}
                    disabled={
                      revoking || details.subscription.status === "revoked"
                    }
                    style={{
                      justifySelf: "start",
                      padding: 0,
                      border: 0,
                      background: "transparent",
                      color:
                        details.subscription.status === "revoked"
                          ? mutedColor
                          : "#dc2626",
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    {revoking
                      ? "Revoking..."
                      : details.subscription.status === "revoked"
                        ? "Subscription revoked"
                        : "Revoke subscription"}
                  </button>
                </div>
              )}
            </div>
          </section>
        </div>
      )}
      {showExportRange && (
        <div onClick={() => setShowExportRange(false)} style={{ position: "fixed", inset: 0, zIndex: 1300, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, background: "rgba(2,6,23,0.78)", backdropFilter: "blur(8px)" }}>
          <section onClick={(event) => event.stopPropagation()} style={{ width: "100%", maxWidth: 430, padding: 26, border: darkMode ? "1px solid #334155" : "1px solid #dbe3ed", borderRadius: 18, background: surfaceColor, color: textColor, boxShadow: "0 30px 100px rgba(0,0,0,0.38)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 14, marginBottom: 22 }}><div><p style={{ margin: 0, color: "#0f766e", fontSize: 11, fontWeight: 800, letterSpacing: "0.15em", textTransform: "uppercase" }}>Report export</p><h2 style={{ margin: "5px 0 4px", fontSize: 23 }}>Choose date range</h2><p style={{ margin: 0, color: mutedColor, fontSize: 13 }}>Export subscriptions purchased during this period.</p></div><button type="button" aria-label="Close date range" onClick={() => setShowExportRange(false)} style={{ border: 0, background: "transparent", color: mutedColor, fontSize: 23, cursor: "pointer" }}>×</button></div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}><label style={{ display: "grid", gap: 7, fontSize: 12, fontWeight: 800 }}>Start date<input type="date" value={exportStartDate} onChange={(event) => setExportStartDate(event.target.value)} style={{ padding: "11px 10px", border: "1px solid #cbd5e1", borderRadius: 9, color: textColor, background: darkMode ? "#111827" : "#fff" }} /></label><label style={{ display: "grid", gap: 7, fontSize: 12, fontWeight: 800 }}>End date<input type="date" value={exportEndDate} onChange={(event) => setExportEndDate(event.target.value)} style={{ padding: "11px 10px", border: "1px solid #cbd5e1", borderRadius: 9, color: textColor, background: darkMode ? "#111827" : "#fff" }} /></label></div>
            {exportRangeError && <p style={{ margin: "14px 0 0", color: "#dc2626", fontSize: 12 }}>{exportRangeError}</p>}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 24 }}><button type="button" onClick={() => setShowExportRange(false)} style={{ padding: "10px 15px", border: "1px solid #cbd5e1", borderRadius: 9, background: "transparent", color: textColor, fontWeight: 700, cursor: "pointer" }}>Cancel</button><button type="button" onClick={exportCsv} style={{ padding: "10px 16px", border: 0, borderRadius: 9, background: "#0f766e", color: "#fff", fontWeight: 800, cursor: "pointer" }}>Export CSV</button></div>
          </section>
        </div>
      )}
      {showAddSubscription && (
        <div
          onClick={() => setShowAddSubscription(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1300,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
            background: "rgba(2,6,23,0.78)",
            backdropFilter: "blur(8px)",
          }}
        >
          <section
            onClick={(event) => event.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: 520,
              padding: 26,
              border: darkMode ? "1px solid #334155" : "1px solid #dbe3ed",
              borderRadius: 20,
              background: surfaceColor,
              color: textColor,
              boxShadow: "0 30px 100px rgba(0,0,0,0.38)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: 14,
                marginBottom: 24,
              }}
            >
              <div>
                <p
                  style={{
                    margin: 0,
                    color: "#ed2224",
                    fontSize: 11,
                    fontWeight: 800,
                    letterSpacing: "0.15em",
                    textTransform: "uppercase",
                  }}
                >
                  Admin assignment
                </p>
                <h2 style={{ margin: "5px 0 4px", fontSize: 24 }}>
                  Add subscription
                </h2>
                <p style={{ margin: 0, color: mutedColor, fontSize: 13 }}>
                  Activate a plan directly for a customer.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close add subscription"
                onClick={() => setShowAddSubscription(false)}
                style={{
                  border: 0,
                  background: "transparent",
                  color: mutedColor,
                  fontSize: 24,
                  cursor: "pointer",
                }}
              >
                ×
              </button>
            </div>
            <label style={{ display: "grid", gap: 7, marginBottom: 18 }}>
              <span style={{ fontSize: 12, fontWeight: 800 }}>Customer</span>
              <input
                value={
                  selectedCustomer
                    ? `${selectedCustomer.username} · ${selectedCustomer.email}`
                    : customerQuery
                }
                onChange={(event) => {
                  setSelectedCustomer(null);
                  setCustomerQuery(event.target.value);
                }}
                placeholder="Search username or email"
                style={{
                  padding: "12px 13px",
                  border: "1px solid #cbd5e1",
                  borderRadius: 10,
                  background: darkMode ? "#111827" : "#fff",
                  color: textColor,
                }}
              />
              {!selectedCustomer && customerQuery && (
                <div
                  style={{
                    display: "grid",
                    gap: 4,
                    maxHeight: 170,
                    overflowY: "auto",
                    padding: 5,
                    border: "1px solid #cbd5e1",
                    borderRadius: 10,
                  }}
                >
                  {matchingCustomers.map((customer) => (
                    <button
                      key={customer.id}
                      type="button"
                      onClick={() => {
                        setSelectedCustomer(customer);
                        setCustomerQuery("");
                      }}
                      style={{
                        padding: "9px 10px",
                        border: 0,
                        borderRadius: 7,
                        background: "transparent",
                        color: textColor,
                        textAlign: "left",
                        cursor: "pointer",
                      }}
                    >
                      <strong>{customer.username}</strong>
                      <span
                        style={{
                          display: "block",
                          color: mutedColor,
                          fontSize: 11,
                        }}
                      >
                        {customer.email}
                      </span>
                    </button>
                  ))}
                  {matchingCustomers.length === 0 && (
                    <span
                      style={{ padding: 8, color: mutedColor, fontSize: 12 }}
                    >
                      No customer accounts found.
                    </span>
                  )}
                </div>
              )}
            </label>
            <label style={{ display: "grid", gap: 7, marginBottom: 18 }}>
              <span style={{ fontSize: 12, fontWeight: 800 }}>
                Subscription plan
              </span>
              <select
                value={selectedPlanId}
                onChange={(event) => {
                  setSelectedPlanId(event.target.value);
                  const plan = availablePlans.find(
                    (item) => String(item.id) === event.target.value,
                  );
                  setSelectedDuration(
                    Object.keys(plan?.pricing?.prices || {})[0] || "monthly",
                  );
                }}
                style={{
                  padding: "12px 13px",
                  border: "1px solid #cbd5e1",
                  borderRadius: 10,
                  background: darkMode ? "#111827" : "#fff",
                  color: textColor,
                }}
              >
                <option value="">Select a plan</option>
                {availablePlans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.name}
                  </option>
                ))}
              </select>
            </label>
            {selectedPlan &&
              Object.keys(selectedPlan.pricing?.prices || {}).length > 0 && (
                <label style={{ display: "grid", gap: 7, marginBottom: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 800 }}>
                    Duration
                  </span>
                  <select
                    value={selectedDuration}
                    onChange={(event) =>
                      setSelectedDuration(event.target.value)
                    }
                    style={{
                      padding: "12px 13px",
                      border: "1px solid #cbd5e1",
                      borderRadius: 10,
                      background: darkMode ? "#111827" : "#fff",
                      color: textColor,
                    }}
                  >
                    {Object.keys(selectedPlan.pricing.prices).map((option) => (
                      <option key={option} value={option}>
                        {option.replace("_", " ")} ·{" "}
                        {selectedPlan.pricing.prices[option]}{" "}
                        {selectedPlan.pricing.currency || "USD"}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            <label style={{ display: "grid", gap: 7, marginTop: 18 }}>
              <span style={{ fontSize: 12, fontWeight: 800 }}>Remarks from admin</span>
              <textarea
                value={assignmentRemarks}
                onChange={(event) => setAssignmentRemarks(event.target.value)}
                placeholder="Add a note about this assignment"
                rows={3}
                style={{ resize: "vertical", padding: "12px 13px", border: "1px solid #cbd5e1", borderRadius: 10, background: darkMode ? "#111827" : "#fff", color: textColor, font: "inherit" }}
              />
            </label>
            {addSubscriptionError && (
              <p style={{ margin: "14px 0 0", color: "#dc2626", fontSize: 12 }}>
                {addSubscriptionError}
              </p>
            )}
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 10,
                marginTop: 24,
              }}
            >
              <button
                type="button"
                onClick={() => setShowAddSubscription(false)}
                style={{
                  padding: "11px 16px",
                  border: "1px solid #cbd5e1",
                  borderRadius: 9,
                  background: "transparent",
                  color: textColor,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveAssignedSubscription}
                disabled={savingSubscription}
                style={{
                  padding: "11px 18px",
                  border: 0,
                  borderRadius: 9,
                  background: "#1d4ed8",
                  color: "#fff",
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                {savingSubscription ? "Saving..." : "Save subscription"}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
