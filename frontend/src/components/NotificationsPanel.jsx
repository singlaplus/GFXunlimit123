import { formatNotificationId } from "../utils/notificationUtils";

export default function NotificationsPanel({
  showNotifications,
  notifications,
  clearAllNotifications,
  darkMode,
  userRole,
}) {
  if (!showNotifications) return null;

  return (
    <div className={`header-notification-dropdown ${darkMode ? "is-dark" : ""}`} role="dialog" aria-label="Recent notifications">
      <div className="header-notification-heading"><strong>Notifications</strong><div className="header-notification-heading-actions"><span>{notifications.length} recent</span>{notifications.length > 0 && <button type="button" className="header-notification-clear" onClick={clearAllNotifications} aria-label="Clear notifications" title="Clear notifications">×</button>}</div></div>

      {notifications.length === 0 ? (
        <p className="header-notification-empty">No notifications</p>
      ) : (
        notifications.map((n) => (
          <div className="header-notification-item" key={n.id}><p>{n.message || n.body || n.subject || "New notification"}</p><small>Notification {formatNotificationId(n.id, userRole)}</small></div>
        ))
      )}
      <a className="header-notification-link" href="/messages">View all messages</a>
    </div>
  );
}