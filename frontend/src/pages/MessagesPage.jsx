import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { getEffectiveAuthToken } from "../utils/authSession";
import Pagination from "../components/Pagination";
import "./MessagesPage.css";
import { formatNotificationId } from "../utils/notificationUtils";

const API = process.env.REACT_APP_API_BASE_URL || "http://localhost:5000";

const ACTIVITY_LABELS = {
  USER_LOGIN: "Login",
  USER_LOGOUT: "Logout",
  USER_REGISTERED: "Registration",
  ASSET_UPLOADED: "Asset uploaded",
  ASSET_DOWNLOADED: "Asset downloaded",
  ASSET_APPROVED: "Asset approved",
  ASSET_REJECTED: "Asset rejected",
  ASSET_PROCESSING: "Asset processing",
  THUMBNAIL_GENERATION_COMPLETED: "Thumbnail generated",
  ASSET_LIKED: "Like",
  ASSET_UNLIKED: "Unlike",
  ASSET_FAVORITED: "Favorite",
  ASSET_UNFAVORITED: "Unfavorite",
  PAYMENT_SUCCESS: "Payment completed",
  PAYMENT_FAILED: "Payment failed",
  PAYMENT_STARTED: "Payment started",
  ORDER_CREATED: "Order created",
  ORDER_COMPLETED: "Order completed",
  ORDER_FAILED: "Order failed",
  PAYOUT_REQUESTED: "Payout requested",
  EARNING_CREATED: "Earning created",
  PAYOUT_PROCESSED: "Payout processed",
  SUBSCRIPTION_STARTED: "Subscription started",
  SUBSCRIPTION_RENEWED: "Subscription renewed",
  SUBSCRIPTION_CHANGED: "Subscription changed",
  SUBSCRIPTION_CANCELLED: "Subscription cancelled",
  SUBSCRIPTION_EXPIRED: "Subscription expired",
  COUPON_APPLIED: "Coupon applied",
  COUPON_USED: "Coupon used",
};

const formatActivityType = (eventType) => ACTIVITY_LABELS[eventType] || String(eventType || "Activity").replaceAll("_", " ").toLowerCase();

const formatActivityMetadata = (metadata) => {
  if (!metadata || typeof metadata !== "object") return "{}";
  const sensitive = /pass(word)?|secret|token|authorization|cookie|api[_-]?key/i;
  const safeMetadata = Object.fromEntries(Object.entries(metadata).map(([key, value]) => [key, sensitive.test(key) ? "[redacted]" : value]));
  return JSON.stringify(safeMetadata, null, 2);
};

function BroadcastPanel({ broadcast, setBroadcast, notice, onSave, onPreview = () => {}, onTest }) {
  const [scheduled, setScheduled] = useState([]);
  const setField = (field, value) => setBroadcast((current) => ({ ...current, [field]: value }));
  const loadScheduled = async () => {
    try { const response = await axios.get(`${API}/api/messages/admin/broadcasts`, { headers: { Authorization: `Bearer ${getEffectiveAuthToken()}` } }); setScheduled(response.data || []); } catch { setScheduled([]); }
  };
  useEffect(() => { loadScheduled(); }, []);
  const cancel = async (id) => { await axios.post(`${API}/api/messages/admin/broadcasts/${id}/cancel`, {}, { headers: { Authorization: `Bearer ${getEffectiveAuthToken()}` } }); loadScheduled(); };
  return <div className="broadcast-panel"><div className="messages-section-heading"><div><p className="messages-kicker">ADMIN BROADCASTS</p><h2>Announcement broadcast</h2></div></div><div className="broadcast-form"><label>Subject<input value={broadcast.subject} onChange={(event) => setField("subject", event.target.value)} /></label><label>Message<textarea rows="6" value={broadcast.body} onChange={(event) => setField("body", event.target.value)} /></label><label>Audience<select value={broadcast.audience} onChange={(event) => setField("audience", event.target.value)}><option value="everyone">Everyone</option><option value="customers">Customers</option><option value="contributors">Contributors</option><option value="selected_users">Selected users</option><option value="selected_contributors">Selected contributors</option><option value="subscription">Users on selected subscription</option><option value="criteria">Users matching criteria</option></select></label>{["selected_users", "selected_contributors"].includes(broadcast.audience) && <label>User IDs<input placeholder="Comma-separated IDs" value={broadcast.userIds} onChange={(event) => setField("userIds", event.target.value)} /></label>}{broadcast.audience === "subscription" && <label>Subscription ID<input inputMode="numeric" value={broadcast.subscriptionId} onChange={(event) => setField("subscriptionId", event.target.value)} /></label>}{broadcast.audience === "criteria" && <label>Matching role<select value={broadcast.criteriaRole} onChange={(event) => setField("criteriaRole", event.target.value)}><option value="">Any role</option><option value="customer">Customer</option><option value="contributor">Contributor</option><option value="admin">Admin</option></select></label>}<label>Delivery<select value={broadcast.channel} onChange={(event) => setField("channel", event.target.value)}><option value="internal">Internal notification</option><option value="email">Email</option><option value="both">Both</option></select></label><label>Priority<select value={broadcast.priority} onChange={(event) => setField("priority", event.target.value)}><option value="LOW">Low</option><option value="NORMAL">Normal</option><option value="HIGH">High</option><option value="URGENT">Urgent</option></select></label><label>Schedule date/time<input type="datetime-local" value={broadcast.scheduledAt} onChange={(event) => setField("scheduledAt", event.target.value)} /></label><label>Expiry date/time<input type="datetime-local" value={broadcast.expiresAt} onChange={(event) => setField("expiresAt", event.target.value)} /></label><div className="broadcast-actions"><button type="button" onClick={onPreview}>Preview</button><button type="button" onClick={onSave}>Save / schedule</button><button type="button" onClick={() => onSave("send")}>Send</button></div><label>Test recipient<input type="email" placeholder="you@example.com" value={broadcast.testTo} onChange={(event) => setField("testTo", event.target.value)} /></label><button type="button" onClick={onTest}>Send test</button>{notice && <div className="messages-alert" role="status">{notice}</div>}</div>{scheduled.filter((item) => item.status === "SCHEDULED").map((item) => <div className="broadcast-scheduled" key={item.id}><span>{item.subject}</span><time>{new Date(item.scheduled_at).toLocaleString()}</time><button type="button" onClick={() => cancel(item.id)}>Cancel scheduled message</button></div>)}</div>;
}

export default function MessagesPage({ darkMode, userRole }) {
  const [tab, setTab] = useState("inbox");
  const [messages, setMessages] = useState([]);
  const [notifications, setNotifications] = useState([]);
    const [adminInbox, setAdminInbox] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [inboxPage, setInboxPage] = useState(1);
  const [conversationPage, setConversationPage] = useState(1);
  const [activity, setActivity] = useState([]);
  const [activityTotal, setActivityTotal] = useState(0);
  const [activityCounts, setActivityCounts] = useState([]);
  const [activityHasMore, setActivityHasMore] = useState(false);
  const [activityPage, setActivityPage] = useState(1);
  const [activityLoading, setActivityLoading] = useState(false);
  const pollingRef = useRef(false);
  const [activityFilters, setActivityFilters] = useState({ user: "", role: "", category: "", eventType: "", from: "", to: "", asset: "", order: "", payment: "", subscription: "", coupon: "" });
  const [selectedActivity, setSelectedActivity] = useState(null);
  const [rules, setRules] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [messageTypes, setMessageTypes] = useState([]);
  const [messageType, setMessageType] = useState("DIRECT_MESSAGE");
  const [search, setSearch] = useState("");
  const [recipientId, setRecipientId] = useState("");
  const [recipientUsername, setRecipientUsername] = useState("");
  const [recipients, setRecipients] = useState([]);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [broadcast, setBroadcast] = useState({ subject: "", body: "", audience: "everyone", userIds: "", subscriptionId: "", criteriaRole: "", priority: "NORMAL", channel: "internal", scheduledAt: "", expiresAt: "", testTo: "" });
  const [broadcastNotice, setBroadcastNotice] = useState("");
  const [replyConversation, setReplyConversation] = useState(null);
  const [replyBody, setReplyBody] = useState("");
  const [replyLoading, setReplyLoading] = useState(false);
  const [replySending, setReplySending] = useState(false);
  const [error, setError] = useState("");
  const resolvedUserRole = userRole || (typeof window !== "undefined" ? localStorage.getItem("userRole") : "");
  const isAdmin = String(resolvedUserRole).toLowerCase() === "admin";
  const isContributor = String(resolvedUserRole).toLowerCase() === "contributor";
  const messagePageSize = 5;
  const inboxTotalPages = Math.max(1, Math.ceil(messages.length / messagePageSize));
  const conversationTotalPages = Math.max(1, Math.ceil(conversations.length / messagePageSize));
  const visibleInboxMessages = messages.slice((inboxPage - 1) * messagePageSize, inboxPage * messagePageSize);
  const visibleConversations = conversations.slice((conversationPage - 1) * messagePageSize, conversationPage * messagePageSize);

  const load = useCallback(async () => {
    if (pollingRef.current) return;
    pollingRef.current = true;
    const headers = { Authorization: `Bearer ${getEffectiveAuthToken()}` };
    const messageView = tab === "announcements" ? "announcements" : "inbox";
    setActivityLoading(isAdmin);
    try {
      const [messageResponse, activityResponse, conversationResponse, typeResponse, notificationResponse, recipientResponse, activityCountResponse] = await Promise.all([
        axios.get(`${API}/api/messages?view=${messageView}&search=${encodeURIComponent(search)}`, { headers }),
        axios.get(`${API}/api/messages/${isAdmin ? "admin/" : ""}activity`, { headers, params: isAdmin ? { ...activityFilters, search, limit: 50, offset: 0 } : undefined }),
        axios.get(`${API}/api/messages/conversations`, { headers }),
        axios.get(`${API}/api/messages/types`, { headers }),
        axios.get(`${API}/notifications/${encodeURIComponent(localStorage.getItem("username") || "")}`, { headers }),
        ...(isAdmin ? [axios.get(`${API}/api/messages/recipients`, { headers })] : []),
        ...(isAdmin ? [axios.get(`${API}/api/messages/admin/activity/counts`, { headers })] : []),
      ]);
      setMessages(messageResponse.data || []);
      setNotifications(notificationResponse.data || []);
      const activityPayload = activityResponse.data || {};
      setActivity(activityPayload.rows || []);
      setActivityTotal(Number(activityPayload.total || 0));
      if (isAdmin) setActivityCounts(activityCountResponse?.data || []);
      setActivityHasMore(Boolean(activityPayload.hasMore));
      setActivityPage(1);
      setConversations(conversationResponse.data || []);
      setInboxPage((page) => Math.min(page, Math.max(1, Math.ceil((messageResponse.data || []).length / messagePageSize))));
      setConversationPage((page) => Math.min(page, Math.max(1, Math.ceil((conversationResponse.data || []).length / messagePageSize))));
      setMessageTypes(typeResponse.data || []);
      if (isAdmin) setRecipients(recipientResponse?.data || []);
      if (isAdmin) {
        try {
          const adminInboxResponse = await axios.get(`${API}/api/messages/admin/inbox`, { headers });
          setAdminInbox(adminInboxResponse.data || []);
        } catch (adminInboxError) {
          setError(adminInboxError.response?.data?.error || "Unable to load the admin inbox.");
        }
      }
      if (isAdmin) setRules((await axios.get(`${API}/api/messages/admin/rules`, { headers })).data || []);
      if (isAdmin) {
        try {
          setTemplates((await axios.get(`${API}/admin/email/templates`, { headers })).data || []);
        } catch (templateError) {
          setTemplates([]);
        }
      }
      setError("");
    } catch (err) {
      setError(err.response?.data?.error || "Unable to load messages.");
    } finally { setActivityLoading(false); pollingRef.current = false; }
  }, [activityFilters, isAdmin, search, tab]);

  useEffect(() => {
    setInboxPage(1);
    setConversationPage(1);
  }, [search]);

  useEffect(() => {
    load();
    const refresh = () => { if (document.visibilityState === "visible") load(); };
    const timer = setInterval(refresh, 15000);
    window.addEventListener("messages-updated", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("messages-updated", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load]);

  const sendMessage = async (event) => {
    event.preventDefault();
    try {
      const endpoint = isAdmin ? `${API}/api/messages` : `${API}/api/messages/support`;
      if (isAdmin && (Boolean(recipientUsername.trim()) === Boolean(messageType))) {
        setError("Choose either a recipient username or a message type.");
        return;
      }
      const payload = isAdmin ? { recipientId: recipientId ? Number(recipientId) : undefined, recipientUsername, subject, body, messageType } : { subject, body };
      const response = await axios.post(endpoint, payload, { headers: { Authorization: `Bearer ${getEffectiveAuthToken()}` } });
      setRecipientId(""); setRecipientUsername(""); setSubject(""); setBody(""); setMessageType("DIRECT_MESSAGE");
      window.dispatchEvent(new Event("messages-updated"));
      if (isAdmin && response.data?.conversation_id) await openConversation(response.data.conversation_id);
      await load();
    } catch (err) { setError(err.response?.data?.error || "Unable to send message."); }
  };

  const markRead = async (id) => {
    await axios.put(`${API}/api/messages/${id}/read`, {}, { headers: { Authorization: `Bearer ${getEffectiveAuthToken()}` } });
    window.dispatchEvent(new Event("messages-updated"));
    load();
  };

  const markUnread = async (id) => {
    await axios.put(`${API}/api/messages/${id}/unread`, {}, { headers: { Authorization: `Bearer ${getEffectiveAuthToken()}` } });
    window.dispatchEvent(new Event("messages-updated"));
    load();
  };

  const markAllRead = async () => {
    await axios.put(`${API}/api/messages/read-all`, {}, { headers: { Authorization: `Bearer ${getEffectiveAuthToken()}` } });
    window.dispatchEvent(new Event("messages-updated"));
    load();
  };

  const markNotificationsRead = async () => {
    const username = localStorage.getItem("username");
    if (!username) return;
    await axios.put(`${API}/notifications/read/${encodeURIComponent(username)}`, {}, { headers: { Authorization: `Bearer ${getEffectiveAuthToken()}` } });
    load();
  };

  const clearAll = async () => {
    if (!window.confirm(`Clear all ${tab === "system-events" ? "system events" : tab}?`)) return;
    try {
      const headers = { Authorization: `Bearer ${getEffectiveAuthToken()}` };
      if (tab === "notifications") {
        const username = localStorage.getItem("username");
        if (!username) return;
        await axios.delete(`${API}/notifications/${encodeURIComponent(username)}`, { headers });
      } else {
        await axios.delete(`${API}/api/messages/clear-all?view=${encodeURIComponent(tab)}`, { headers });
      }
      window.dispatchEvent(new Event("messages-updated"));
      await load();
    } catch (err) {
      setError(err.response?.data?.error || err.response?.data?.message || (typeof err.response?.data === "string" ? err.response.data : "Unable to clear items."));
    }
  };

  const markAdminInboxItemRead = async (item) => {
    try {
      await axios.post(`${API}/api/messages/admin/inbox/${item.source_type}/${item.id}/read`, {}, { headers: { Authorization: `Bearer ${getEffectiveAuthToken()}` } });
      setAdminInbox((items) => items.map((current) => current.source_type === item.source_type && current.id === item.id ? { ...current, is_read: true, read_at: new Date().toISOString() } : current));
    } catch (err) {
      setError(err.response?.data?.error || "Unable to mark the admin inbox item as read.");
    }
  };

  const closeAdminInboxItem = async (item) => {
    try {
      await axios.post(`${API}/api/messages/admin/inbox/${item.source_type}/${item.id}/read`, {}, { headers: { Authorization: `Bearer ${getEffectiveAuthToken()}` } });
      await axios.post(`${API}/api/messages/admin/inbox/${item.source_type}/${item.id}/close`, {}, { headers: { Authorization: `Bearer ${getEffectiveAuthToken()}` } });
      setAdminInbox((items) => items.filter((current) => !(current.source_type === item.source_type && current.id === item.id)));
    } catch (err) {
      setError(err.response?.data?.error || "Unable to close the admin inbox item.");
    }
  };

  const openConversation = async (conversationId) => {
    if (!conversationId) return;
    setReplyLoading(true);
    try {
      const response = await axios.get(`${API}/api/messages/conversations/${conversationId}`, { headers: { Authorization: `Bearer ${getEffectiveAuthToken()}` } });
      setReplyConversation(response.data);
      setReplyBody("");
      window.dispatchEvent(new Event("messages-updated"));
    } catch (err) {
      setError(err.response?.data?.error || "Unable to load conversation.");
    } finally { setReplyLoading(false); }
  };

  const replyToMessage = async (message) => {
    if (!message.conversation_id) return;
    await openConversation(message.conversation_id);
  };

  const sendReply = async (event) => {
    event.preventDefault();
    if (!replyConversation?.conversationId || !replyBody.trim()) return;
    setReplySending(true);
    try {
      const response = await axios.post(`${API}/api/messages/conversations/${replyConversation.conversationId}/messages`, { body: replyBody.trim() }, { headers: { Authorization: `Bearer ${getEffectiveAuthToken()}` } });
      setReplyConversation((current) => ({ ...current, messages: [response.data, ...(current.messages || [])] }));
      setReplyBody("");
      window.dispatchEvent(new Event("messages-updated"));
    } catch (err) {
      setError(err.response?.data?.error || "Unable to send reply.");
    } finally { setReplySending(false); }
  };

  const deleteConversation = async (conversationId, subject) => {
    if (!window.confirm(`Delete conversation "${subject || "Untitled conversation"}"?`)) return;
    try {
      await axios.delete(`${API}/api/messages/conversations/${conversationId}`, { headers: { Authorization: `Bearer ${getEffectiveAuthToken()}` } });
      setReplyConversation(null);
      window.dispatchEvent(new Event("messages-updated"));
      load();
    } catch (err) { setError(err.response?.data?.error || "Unable to delete conversation."); }
  };

  const deleteMessage = async (messageId) => {
    if (!window.confirm("Delete this message only for you? Other participants will still see it.")) return;
    try {
      await axios.delete(`${API}/api/messages/${messageId}`, { headers: { Authorization: `Bearer ${getEffectiveAuthToken()}` } });
      if (replyConversation) setReplyConversation((current) => ({ ...current, messages: (current.messages || []).filter((item) => item.id !== messageId) }));
      window.dispatchEvent(new Event("messages-updated"));
      load();
    } catch (err) { setError(err.response?.data?.error || "Unable to delete message."); }
  };

  const broadcastRequest = async (path, payload) => axios.post(`${API}/api/messages/admin/broadcasts${path}`, payload, { headers: { Authorization: `Bearer ${getEffectiveAuthToken()}` } });
  const broadcastPayload = (action = "save") => ({ subject: broadcast.subject, body: broadcast.body, priority: broadcast.priority, audience: { type: broadcast.audience, userIds: broadcast.userIds.split(",").map((id) => Number(id.trim())).filter(Boolean), subscriptionId: broadcast.subscriptionId || null, criteria: broadcast.criteriaRole ? { role: broadcast.criteriaRole } : {} }, sendInternal: broadcast.channel !== "email", sendEmail: broadcast.channel !== "internal", scheduledAt: broadcast.scheduledAt || null, expiresAt: broadcast.expiresAt || null, action });
  const saveBroadcast = async (action) => { try { const response = await broadcastRequest("", broadcastPayload(action)); setBroadcastNotice(response.data.status === "SENT" ? `Sent to ${response.data.recipientCount || 0} recipients.` : "Broadcast saved."); } catch (err) { setBroadcastNotice(err.response?.data?.error || "Unable to save broadcast."); } };
  const testBroadcast = async () => { try { await broadcastRequest("/test", { to: broadcast.testTo, subject: broadcast.subject, body: broadcast.body }); setBroadcastNotice("Test broadcast queued."); } catch (err) { setBroadcastNotice(err.response?.data?.error || "Unable to send test."); } };

  const loadMoreActivity = async () => {
    const headers = { Authorization: `Bearer ${getEffectiveAuthToken()}` };
    const response = await axios.get(`${API}/api/messages/${isAdmin ? "admin/" : ""}activity`, { headers, params: { ...activityFilters, limit: 50, offset: activity.length } });
    const payload = response.data || {};
    setActivity((current) => [...current, ...(payload.rows || [])]);
    setActivityHasMore(Boolean(payload.hasMore));
  };

  const exportAdminActivity = async () => {
    const response = await axios.get(`${API}/api/messages/admin/activity/export`, { headers: { Authorization: `Bearer ${getEffectiveAuthToken()}` }, responseType: "blob" });
    const url = URL.createObjectURL(response.data);
    const link = document.createElement("a");
    link.href = url;
    link.download = `admin-activity-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const updateRule = async (eventKey, field, value) => {
    const current = rules.find((rule) => rule.event_key === eventKey);
    const next = { enableInternal: current?.enable_internal !== false, enableEmail: current?.enable_email === true, recipients: current?.recipients || [], recipientRoles: current?.recipient_roles || [], templateId: current?.template_id || null, enabled: current?.enabled !== false };
    next[field] = value;
    try {
      const response = await axios.put(`${API}/api/messages/admin/rules/${encodeURIComponent(eventKey)}`, next, { headers: { Authorization: `Bearer ${getEffectiveAuthToken()}` } });
      setRules((items) => items.map((rule) => rule.event_key === eventKey ? response.data : rule));
    } catch (err) {
      setError(err.response?.data?.error || "Unable to update automation rule.");
    }
  };

  const updateRecipientRoles = (eventKey, role, checked) => {
    const rule = rules.find((item) => item.event_key === eventKey);
    const roles = new Set((rule?.recipient_roles || []).map((item) => String(item).toUpperCase()));
    if (checked) roles.add(role); else roles.delete(role);
    updateRule(eventKey, "recipientRoles", [...roles]);
  };

  const tabs = isAdmin
    ? [
      { key: "inbox", label: "Inbox" },
      { key: "admin-inbox", label: "Admin Inbox" },
      { key: "conversations", label: "Conversations" },
      { key: "notifications", label: "Notifications" },
      { key: "announcements", label: "Announcements" },
      { key: "activity", label: "Activity" },
      { key: "system-events", label: "System Events" },
      { key: "email-queue", label: "Email Queue" },
      { key: "email-history", label: "Email History" },
      { key: "templates", label: "Templates" },
      { key: "broadcasts", label: "Broadcasts" },
      { key: "analytics", label: "Message Analytics" },
      { key: "automation", label: "Automation" },
    ]
    : [
      { key: "inbox", label: "Inbox" },
      { key: "conversations", label: "Conversations" },
      { key: "notifications", label: "Notifications" },
      { key: "announcements", label: "Announcements" },
      { key: "activity", label: "My Activity" },
    ];
  const isMessageTab = ["inbox", "conversations", "announcements"].includes(tab);
  const isAdminActivityTab = isAdmin && ["activity", "system-events"].includes(tab);
  const visibleActivity = isAdminActivityTab ? activity.slice((activityPage - 1) * 100, activityPage * 100) : activity;
  const activityPageCount = Math.max(1, Math.ceil(activity.length / 100));

  return (
    <main className={`messages-page ${darkMode ? "is-dark" : ""}`}>
      <section className="messages-hero">
        <div>
          <p className="messages-eyebrow">GFXUNLIMIT / COMMUNICATIONS</p>
          <h1>Messages</h1>
          <p className="messages-hero-copy">{isContributor ? "Your contributor conversations, asset updates, earnings, and account activity in one place." : "Your conversations, important updates, and account activity in one place."}</p>
        </div>
        <div className="messages-hero-stat"><strong>{messages.filter((message) => !message.read_at).length}</strong><span>unread updates</span></div>
      </section>
      <div className="messages-toolbar">
        <nav className="messages-tabs" aria-label="Message sections">
          {tabs.map((item) => <button className={tab === item.key ? "is-active" : ""} key={item.key} onClick={() => setTab(item.key)}>{item.label}</button>)}
        </nav>
        <label className="messages-search"><span>Search</span><input aria-label="Search messages and events" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Message, user, order, asset, or event" /></label>
      </div>
      {error && <div className="messages-alert">{error}</div>}
      <div className={`messages-layout ${isAdminActivityTab ? "is-wide" : ""}`}>
        <section className="messages-content">
          {isAdmin && tab === "activity" && <div className="activity-card-grid-wrap"><div className="activity-count-grid" aria-label="Today activity counts">{activityCounts.map((item) => <button type="button" className="activity-count-card" key={item.event_type} onClick={() => setActivityFilters((current) => ({ ...current, eventType: item.event_type, category: "" }))}><span>{formatActivityType(item.event_type)}</span><strong>{item.count}</strong><small>Today</small></button>)}</div><Pagination currentPage={activityPage} totalPages={activityPageCount} totalImages={activity.length} setCurrentPage={setActivityPage} darkMode={darkMode} /><div className="activity-card-grid" aria-label="Admin activity events">{activity.length === 0 ? <div className="messages-empty"><strong>No activity recorded yet.</strong></div> : visibleActivity.map((event) => <button type="button" className="activity-event-card" key={event.id} onClick={() => setSelectedActivity(event)}><span className="activity-card-id">Event #{event.id}</span><strong>{formatActivityType(event.event_type)}</strong><span className="activity-card-actor">{event.description}</span><span className="activity-card-actor">{event.username || "System"} · {event.user_role || "-"}</span><span className={`activity-card-status ${event.success ? "is-success" : "is-failed"}`}>{event.success ? "Success" : "Failed"}</span><time>{new Date(event.created_at).toLocaleString()}</time></button>)}</div></div>}
          {(isMessageTab || tab === "notifications") && <div className="messages-section-heading"><div><p className="messages-kicker">{tab === "inbox" ? "INBOX" : tab.toUpperCase()}</p><h2>{tab === "inbox" ? "Recent messages" : tab}</h2></div><div className="messages-section-actions"><span>{tab === "notifications" ? notifications.length : messages.length} total</span><button type="button" onClick={clearAll}>Clear all</button>{tab === "notifications" ? notifications.some((notification) => !notification.is_read) && <button type="button" onClick={markNotificationsRead}>Mark all as read</button> : messages.some((message) => !message.read_at) && <button type="button" onClick={markAllRead}>Mark all as read</button>}</div></div>}
          {isAdminActivityTab && <div className="messages-section-heading"><div><p className="messages-kicker">{tab === "activity" ? "ACTIVITY" : "SYSTEM EVENTS"}</p><h2>{tab === "activity" ? "Activity" : "System events"}</h2></div><div className="messages-section-actions">{tab === "activity" && <button type="button" onClick={exportAdminActivity}>Export activity CSV</button>}<button type="button" onClick={clearAll}>Clear all</button></div></div>}
                    {isAdmin && tab === "admin-inbox" && <><div className="messages-section-heading"><div><p className="messages-kicker">ADMIN INBOX</p><h2>Approval and intervention queue</h2></div><div className="messages-section-actions"><span>{adminInbox.length} open</span>{adminInbox.some((item) => !item.is_read) && <button type="button" onClick={() => Promise.all(adminInbox.filter((item) => !item.is_read).map((item) => markAdminInboxItemRead(item))).catch(() => undefined)}>Mark all as read</button>}</div></div><div className="message-list">{adminInbox.length === 0 ? <div className="messages-empty"><strong>No admin intervention items.</strong></div> : adminInbox.map((item) => <article className={`message-card ${item.is_read ? "" : "is-unread"}`} key={`${item.source_type}-${item.id}`} onClick={() => markAdminInboxItemRead(item)}><div className="message-avatar">!</div><div className="message-card-main"><div className="message-card-top"><strong>{item.category || "Admin review required"}</strong><time>{new Date(item.created_at).toLocaleString()}</time></div><p>{item.description}</p><div className="message-meta"><span>{item.username || "System"}</span>{item.order_id && <span>Order #{item.order_id}</span>}{item.asset_id && <span>Asset #{item.asset_id}</span>}{item.subscription_id && <span>Subscription #{item.subscription_id}</span>}<button type="button" onClick={(event) => { event.stopPropagation(); markAdminInboxItemRead(item); }}>Mark as read</button><button type="button" onClick={(event) => { event.stopPropagation(); closeAdminInboxItem(item); }}>Close</button></div></div></article>)}</div></>}
          {tab === "notifications" && <div className="message-list">{notifications.length === 0 ? <div className="messages-empty"><strong>No notifications yet.</strong></div> : notifications.map((notification) => <article className={`message-card ${notification.is_read ? "" : "is-unread"}`} key={notification.id}><div className="message-avatar">!</div><div className="message-card-main"><div className="message-card-top"><strong>Notification</strong><time>{new Date(notification.created_at).toLocaleString()}</time></div><p>{notification.message}</p><div className="message-meta"><span>Notification</span><span>{notification.is_read ? "Read" : "Unread"}</span><span>{formatNotificationId(notification.id, userRole)}</span></div></div></article>)}</div>}
          {tab === "conversations" ? (conversations.length === 0 ? <div className="messages-empty"><strong>No conversations yet.</strong><span>Start a conversation with the GFXunlimit team from your inbox.</span></div> : <><div className="message-list">{visibleConversations.map((conversation) => <article className="message-card" key={conversation.id} onClick={() => openConversation(conversation.id)}>
            <div className="message-avatar">#</div><div className="message-card-main"><div className="message-card-top"><strong>{conversation.subject || "Untitled conversation"}</strong><time>{new Date(conversation.last_message_at || conversation.updated_at).toLocaleString()}</time></div><p><span className="conversation-ticket">{conversation.ticket_id || "GFX-000"}</span> · {conversation.message_count} message{conversation.message_count === 1 ? "" : "s"} in this conversation</p><div className="message-meta"><span>{conversation.status}</span><span>{conversation.priority}</span>{conversation.unread_count > 0 && <span className="conversation-unread">{conversation.unread_count} unread</span>}<button type="button" onClick={(event) => { event.stopPropagation(); deleteConversation(conversation.id, conversation.subject); }}>Delete conversation</button></div></div>
            </article>)}</div>{conversations.length > messagePageSize && <Pagination currentPage={conversationPage} totalPages={conversationTotalPages} totalImages={conversations.length} setCurrentPage={setConversationPage} darkMode={darkMode} />}</>) : (isMessageTab && (messages.length === 0 ? <div className="messages-empty"><strong>Your inbox is clear.</strong><span>New updates will appear here as your account activity continues.</span></div> : <><div className="message-list">{visibleInboxMessages.map((message) => <article className={`message-card ${message.read_at ? "" : "is-unread"}`} key={message.id}>
            <div className="message-avatar">{(message.sender_username || "S").charAt(0).toUpperCase()}</div>
            <div className="message-card-main"><div className="message-card-top"><strong>{message.subject || "Message"}</strong><time>{new Date(message.created_at).toLocaleString()}</time></div><p>{message.body}</p><div className="message-meta"><span>{message.sender_username ? `From ${message.sender_username}` : "System notification"}</span><span>{message.status || (message.read_at ? "Read" : "Unread")}</span><span>{message.message_type}</span>{message.priority && <span className={`message-priority priority-${String(message.priority).toLowerCase()}`}>{message.priority}</span>}{(message.related_order_id || message.conversation_order_id) && <span>Order #{message.related_order_id || message.conversation_order_id}</span>}{(message.related_asset_id || message.conversation_asset_id) && <span>Asset #{message.related_asset_id || message.conversation_asset_id}</span>}<button disabled={replyLoading} onClick={() => replyToMessage(message)}>{replyLoading ? "Opening..." : "Reply"}</button>{message.read_at ? <button onClick={() => markUnread(message.id)}>Mark unread</button> : <button onClick={() => markRead(message.id)}>Mark as read</button>}<button onClick={() => deleteMessage(message.id)}>Delete message</button></div></div>
          </article>)}</div>{messages.length > messagePageSize && <Pagination currentPage={inboxPage} totalPages={inboxTotalPages} totalImages={messages.length} setCurrentPage={setInboxPage} darkMode={darkMode} />}</>))}
            {isAdminActivityTab && <div className="activity-filters" aria-label="System event filters" aria-busy={activityLoading}><input aria-label="User" placeholder="User name, email, or ID" value={activityFilters.user} onChange={(event) => setActivityFilters((current) => ({ ...current, user: event.target.value }))} /><select aria-label="Role" value={activityFilters.role} onChange={(event) => setActivityFilters((current) => ({ ...current, role: event.target.value }))}><option value="">All roles</option><option value="customer">Customer</option><option value="contributor">Contributor</option><option value="admin">Admin</option></select><select aria-label="Event type" value={activityFilters.eventType} onChange={(event) => setActivityFilters((current) => ({ ...current, eventType: event.target.value, category: "" }))}><option value="">All event types</option><option value="USER_LOGIN">User login</option><option value="ASSET_VIEWED">Asset viewed</option><option value="CART_ITEM_ADDED">Added to cart</option><option value="PAYMENT_SUCCESS">Payment completed</option><option value="ORDER_CREATED">Order created</option><option value="ASSET_DOWNLOADED">Asset downloaded</option></select><select aria-label="Category" value={activityFilters.category} onChange={(event) => setActivityFilters((current) => ({ ...current, category: event.target.value, eventType: "" }))}><option value="">All categories</option><option value="asset">Asset</option><option value="order">Order</option><option value="payment">Payment</option><option value="subscription">Subscription</option><option value="coupon">Coupon</option><option value="admin">Admin</option><option value="security">Security</option></select><input aria-label="From date and time" type="datetime-local" value={activityFilters.from} onChange={(event) => setActivityFilters((current) => ({ ...current, from: event.target.value }))} /><input aria-label="To date and time" type="datetime-local" value={activityFilters.to} onChange={(event) => setActivityFilters((current) => ({ ...current, to: event.target.value }))} /><input aria-label="Asset" placeholder="Asset ID" inputMode="numeric" value={activityFilters.asset} onChange={(event) => setActivityFilters((current) => ({ ...current, asset: event.target.value }))} /><input aria-label="Order" placeholder="Order ID" inputMode="numeric" value={activityFilters.order} onChange={(event) => setActivityFilters((current) => ({ ...current, order: event.target.value }))} /><input aria-label="Payment" placeholder="Payment ID" inputMode="numeric" value={activityFilters.payment} onChange={(event) => setActivityFilters((current) => ({ ...current, payment: event.target.value }))} /><input aria-label="Subscription" placeholder="Subscription ID" inputMode="numeric" value={activityFilters.subscription} onChange={(event) => setActivityFilters((current) => ({ ...current, subscription: event.target.value }))} /><input aria-label="Coupon" placeholder="Coupon ID" inputMode="numeric" value={activityFilters.coupon} onChange={(event) => setActivityFilters((current) => ({ ...current, coupon: event.target.value }))} /><button type="button" onClick={() => setActivityFilters({ user: "", role: "", category: "", eventType: "", from: "", to: "", asset: "", order: "", payment: "", subscription: "", coupon: "" })}>Clear filters</button><span className="activity-filter-status" role="status">{activityLoading ? "Updating..." : "Live"}</span></div>}
            {((tab === "activity" && !isAdmin) || tab === "system-events") && <div className={isAdminActivityTab ? "activity-card-grid-wrap" : "activity-list"}>{activity.length === 0 ? <div className="messages-empty"><strong>No activity recorded yet.</strong></div> : isAdminActivityTab ? <><Pagination currentPage={activityPage} totalPages={activityPageCount} totalImages={activity.length} setCurrentPage={setActivityPage} darkMode={darkMode} /><div className="activity-card-grid" aria-label="Admin activity events">{visibleActivity.map((event) => <button type="button" className="activity-event-card" key={event.id} onClick={() => setSelectedActivity(event)}><span className="activity-card-id">Event #{event.id}</span><strong>{formatActivityType(event.event_type)}</strong><span className="activity-card-actor">{event.description}</span><span className="activity-card-actor">{event.username || "System"} · {event.user_role || "-"}</span><span className={`activity-card-status ${event.success ? "is-success" : "is-failed"}`}>{event.success ? "Success" : "Failed"}</span><time>{new Date(event.created_at).toLocaleString()}</time></button>)}</div>{activityHasMore && <button className="activity-load-more" onClick={loadMoreActivity}>Load older activity <span>{activity.length} of {activityTotal}</span></button>}</> : activity.map((event) => <article key={event.id}><span className="activity-dot" /><div><strong>{formatActivityType(event.event_type)}</strong><p>{event.description}</p><time>{new Date(event.created_at).toLocaleString()}</time></div></article>)}</div>}
          {tab === "automation" && isAdmin && <div className="automation-list">{rules.map((rule) => <article key={rule.event_key}><strong>{rule.event_key.replaceAll("_", " ")}</strong><label className="automation-toggle"><input type="checkbox" checked={rule.enabled !== false} onChange={(event) => updateRule(rule.event_key, "enabled", event.target.checked)} /> Active</label><label className="automation-toggle"><input type="checkbox" checked={rule.enable_internal !== false} onChange={(event) => updateRule(rule.event_key, "enableInternal", event.target.checked)} /> Internal</label><label className="automation-toggle"><input type="checkbox" checked={rule.enable_email === true} onChange={(event) => updateRule(rule.event_key, "enableEmail", event.target.checked)} /> Email</label><span className="automation-recipient-label">Recipients</span>{["CUSTOMER", "CONTRIBUTOR", "ADMIN"].map((role) => <label className="automation-toggle" key={role}><input type="checkbox" checked={(rule.recipient_roles || []).includes(role)} onChange={(event) => updateRecipientRoles(rule.event_key, role, event.target.checked)} /> {role}</label>)}<select className="automation-template" value={rule.template_id || ""} onChange={(event) => updateRule(rule.event_key, "templateId", event.target.value ? Number(event.target.value) : null)}><option value="">Default email template</option>{templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></article>)}</div>}
          {tab === "broadcasts" && isAdmin && <BroadcastPanel broadcast={broadcast} setBroadcast={setBroadcast} notice={broadcastNotice} onSave={saveBroadcast} onTest={testBroadcast} />}
          {isAdmin && ["email-queue", "email-history", "templates", "analytics"].includes(tab) && <div className="messages-empty"><strong>{tabs.find((item) => item.key === tab)?.label}</strong><span>This operational view is available from the existing Admin email and promotion tools.</span><a href={tab === "templates" ? "/admin/email/templates" : "/admin"}>Open admin tools →</a></div>}
        </section>
        {tab === "inbox" && <aside className="compose-panel"><p className="messages-kicker">{isAdmin ? "DIRECT MESSAGE" : "SUPPORT CHAT"}</p><h2>{isAdmin ? "Start a conversation" : "Chat with Support"}</h2><p>{isAdmin ? "Reach a customer, contributor, or teammate directly." : "Send a private message to the GFXunlimit support team. No email is required."}</p><form onSubmit={sendMessage}>{isAdmin && <label>Recipient username<input list="message-recipient-options" value={recipientUsername} onChange={(event) => { setRecipientUsername(event.target.value); setMessageType(""); const match = recipients.find((item) => item.username.toLowerCase() === event.target.value.toLowerCase() || item.email.toLowerCase() === event.target.value.toLowerCase()); setRecipientId(match?.id || ""); }} placeholder="Search by username or email" /><datalist id="message-recipient-options">{recipients.map((recipient) => <option key={recipient.id} value={recipient.username}>{recipient.full_name || recipient.email} ({recipient.role})</option>)}</datalist></label>}{isAdmin && <label>Message type<select value={messageType} onChange={(event) => { setMessageType(event.target.value); if (event.target.value) { setRecipientUsername(""); setRecipientId(""); } }}>{[<option value="" key="none">Choose a message type or recipient</option>, ...messageTypes.map((type) => <option key={type.code} value={type.code}>{type.label}</option>)]}</select></label>}<label>Subject<input required value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="What can we help with?" /></label><label>Message<textarea required rows="5" value={body} onChange={(event) => setBody(event.target.value)} placeholder="Write your message..." /></label><button type="submit">{isAdmin ? "Send message" : "Start chat"} <span>→</span></button></form></aside>}
      </div>
      {replyConversation && <div className="activity-modal-backdrop" role="presentation" onClick={() => setReplyConversation(null)}><section className="reply-modal" role="dialog" aria-modal="true" aria-label="Conversation replies" onClick={(event) => event.stopPropagation()}><div className="activity-modal-heading"><div><p className="messages-kicker">CONVERSATION</p><h2>{replyConversation.subject || "Message thread"}</h2></div><button type="button" aria-label="Close conversation" onClick={() => setReplyConversation(null)}>×</button></div><div className="reply-thread">{(replyConversation.messages || []).map((item) => <article className={`reply-message ${Number(item.sender_id) === Number(replyConversation.currentUserId) ? "is-own" : ""}`} key={item.id}><div><strong>{item.sender_username || (item.sender_id ? `User #${item.sender_id}` : "System")}</strong><time>{new Date(item.created_at).toLocaleString()}</time></div><p>{item.body}</p></article>)}</div><form className="reply-form" onSubmit={sendReply}><textarea aria-label="Reply message" rows="4" value={replyBody} onChange={(event) => setReplyBody(event.target.value)} placeholder="Write a reply..." required /><div className="reply-form-actions"><button type="button" className="reply-delete-button" onClick={() => deleteConversation(replyConversation.conversationId, replyConversation.subject)}>Delete conversation</button><button type="submit" disabled={replySending || !replyBody.trim()}>{replySending ? "Sending..." : "Send reply"}</button></div></form></section></div>}
      {selectedActivity && <div className="activity-modal-backdrop" role="presentation" onClick={() => setSelectedActivity(null)}><section className="activity-modal" role="dialog" aria-modal="true" aria-label="Activity event details" onClick={(event) => event.stopPropagation()}><div className="activity-modal-heading"><div><p className="messages-kicker">EVENT DETAILS</p><h2>{formatActivityType(selectedActivity.event_type)}</h2></div><button type="button" aria-label="Close event details" onClick={() => setSelectedActivity(null)}>×</button></div><dl><div><dt>Event ID</dt><dd>{selectedActivity.id}</dd></div><div><dt>Event type</dt><dd>{selectedActivity.event_type}</dd></div><div><dt>User ID</dt><dd>{selectedActivity.user_id || "System"}</dd></div><div><dt>User</dt><dd>{selectedActivity.username || "System"}</dd></div><div><dt>User role</dt><dd>{selectedActivity.user_role || "System"}</dd></div><div><dt>IP address</dt><dd>{selectedActivity.ip_address || "Not recorded"}</dd></div><div><dt>Timestamp</dt><dd>{new Date(selectedActivity.created_at).toLocaleString()}</dd></div><div><dt>Related records</dt><dd>{[selectedActivity.asset_id && `Asset #${selectedActivity.asset_id}`, selectedActivity.order_id && `Order #${selectedActivity.order_id}`, selectedActivity.payment_id && `Payment #${selectedActivity.payment_id}`, selectedActivity.subscription_id && `Subscription #${selectedActivity.subscription_id}`, selectedActivity.coupon_id && `Coupon #${selectedActivity.coupon_id}`].filter(Boolean).join(" · ") || "None"}</dd></div><div><dt>Description</dt><dd>{selectedActivity.description || "No description"}</dd></div><div><dt>Result</dt><dd>{selectedActivity.success ? "Success" : "Failure"}</dd></div>{selectedActivity.error_message && <div><dt>Error</dt><dd>{selectedActivity.error_message}</dd></div>}</dl><div className="activity-metadata"><dt>Metadata JSON</dt><pre>{formatActivityMetadata(selectedActivity.metadata)}</pre></div></section></div>}
    </main>
  );
}
