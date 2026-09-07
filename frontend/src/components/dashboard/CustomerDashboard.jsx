import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { getAssetPreviewUrl } from "../../utils/assetPreview";
import { buildAuthHeaders, getEffectiveAuthToken } from "../../utils/authSession";
import { loadCartItems } from "../../utils/cartPersistence";
import "./CustomerDashboard.css";

const API_BASE_URL =
  process.env.REACT_APP_API_BASE_URL || "http://localhost:5000";
const sections = [
  ["overview", "Overview"],
  ["downloads", "My downloads"],
  ["favorites", "Favorites"],
  ["orders", "Orders"],
  ["cart", "Cart"],
  ["notifications", "Notifications"],
];
const accountSections = [
  ["profile", "Profile"],
  ["billing", "Billing"],
  ["security", "Security"],
  ["support", "Support"],
];

function dateLabel(value) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
function assetUrl(asset) {
  const slug = String(asset?.title || "asset")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `/asset/${slug}-${asset.id || asset.image_id}`;
}

function AssetTile({ asset, onOpen }) {
  return (
    <button
      className="account-asset"
      type="button"
      onClick={() => onOpen(asset)}
    >
      <img
        src={getAssetPreviewUrl(asset, { quality: 55, watermark: false })}
        alt={asset.title || "Asset preview"}
        loading="lazy"
      />
      <span className="account-asset-copy">
        <strong>{asset.title || asset.filename || "Untitled asset"}</strong>
        <small>{asset.category || asset.collection || "Creative asset"}</small>
      </span>
    </button>
  );
}

function EmptyState({ title, copy, action, onAction }) {
  return (
    <div className="account-empty">
      <span className="account-empty-mark">+</span>
      <h3>{title}</h3>
      <p>{copy}</p>
      {action && (
        <button
          className="account-button account-button-primary"
          type="button"
          onClick={onAction}
        >
          {action}
        </button>
      )}
    </div>
  );
}

export default function CustomerDashboard({ darkMode, username }) {
  const navigate = useNavigate();
  const [activeSection, setActiveSection] = useState("overview");
  const [profile, setProfile] = useState(null);
  const [downloads, setDownloads] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [orders, setOrders] = useState([]);
  const [cart, setCart] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [subscription, setSubscription] = useState(null);
  const [showSubscriptionHistory, setShowSubscriptionHistory] = useState(false);
  const [, setCustomerBanner] = useState(null);
  const [loading, setLoading] = useState(true);
  const token =
    typeof window !== "undefined" ? getEffectiveAuthToken() : null;

  useEffect(() => {
    let mounted = true;
    if (!token) {
      setLoading(false);
      return undefined;
    }
    const headers = buildAuthHeaders(token);
    Promise.allSettled([
      axios.get(`${API_BASE_URL}/profile`, { headers }),
      axios.get(`${API_BASE_URL}/my-customer-downloads`, { headers }),
      axios.get(`${API_BASE_URL}/favorites`, { headers }),
      axios.get(`${API_BASE_URL}/orders?page=1&limit=6`, { headers }),
      axios.get(
        `${API_BASE_URL}/notifications/${encodeURIComponent(username || "")}`,
        { headers },
      ),
      loadCartItems(),
    ]).then(
      ([
        profileResult,
        downloadsResult,
        favoritesResult,
        ordersResult,
        notificationsResult,
        cartResult,
      ]) => {
        if (!mounted) return;
        if (profileResult.status === "fulfilled")
          setProfile(
            profileResult.value.data?.user || profileResult.value.data,
          );
        axios
          .get(`${API_BASE_URL}/subscription-status`, { headers })
          .then((response) => {
            if (mounted) setSubscription(response.data || null);
          })
          .catch(() => {});
        axios
          .get(`${API_BASE_URL}/branding`)
          .then((response) => {
            if (mounted) {
              const banner = response.data?.customerBanner || null;
              setCustomerBanner(banner);
              document.documentElement.style.setProperty(
                "--customer-banner-image",
                banner ? `url(${API_BASE_URL}${banner})` : "none",
              );
            }
          })
          .catch(() => {});
        if (downloadsResult.status === "fulfilled")
          setDownloads(downloadsResult.value.data || []);
        if (favoritesResult.status === "fulfilled")
          setFavorites(favoritesResult.value.data || []);
        if (ordersResult.status === "fulfilled")
          setOrders(ordersResult.value.data?.orders || []);
        if (notificationsResult.status === "fulfilled")
          setNotifications(notificationsResult.value.data || []);
        if (cartResult.status === "fulfilled") setCart(cartResult.value || []);
        setLoading(false);
      },
    );
    return () => {
      mounted = false;
    };
  }, [token, username]);

  useEffect(() => {
    let mounted = true;
    const refreshFavorites = async () => {
      const currentToken = getEffectiveAuthToken();
      if (!currentToken) return;
      try {
        const response = await axios.get(`${API_BASE_URL}/favorites`, {
          headers: buildAuthHeaders(currentToken),
        });
        if (mounted) setFavorites(response.data || []);
      } catch (error) {
        console.error("Failed to refresh favorites", error);
      }
    };

    window.addEventListener("favoritesUpdated", refreshFavorites);
    return () => {
      mounted = false;
      window.removeEventListener("favoritesUpdated", refreshFavorites);
    };
  }, []);

  const displayName =
    profile?.full_name || profile?.username || username || "Customer";
  const openAsset = (asset) => navigate(assetUrl(asset));
  const goTo = (section) => {
    if (["favorites", "downloads", "orders", "cart"].includes(section)) {
      navigate(`/${section}`);
      return;
    }
    setActiveSection(section);
  };
  const recentDownloads = downloads.slice(0, 4);
  const recentFavorites = favorites.slice(0, 4);
  const unreadCount = notifications.filter((item) => !item.is_read).length;
  const renderOverview = () => (
    <>
      <section className="account-spotlight">
        <div>
          <span className="account-eyebrow">GFXunlimit select</span>
          <h2>Fresh assets for your next idea.</h2>
          <p>Discover standout visuals from the creative marketplace.</p>
        </div>
        <button
          className="account-button account-button-primary"
          type="button"
          onClick={() => navigate("/explore")}
        >
          Browse collection <span>↗</span>
        </button>
      </section>
      <section className="account-welcome">
        <div>
          <span className="account-eyebrow">Your creative library</span>
          <h2>Make something remarkable.</h2>
          <p>Pick up where you left off and keep your best assets close.</p>
        </div>
        <button
          className="account-button account-button-dark"
          type="button"
          onClick={() => navigate("/explore")}
        >
          Explore assets <span>↗</span>
        </button>
      </section>
      <section className="account-section">
        <div className="account-section-heading">
          <div>
            <span className="account-eyebrow">Your plan</span>
            <h2>Subscription</h2>
          </div>
          <button
            className="account-link"
            type="button"
            onClick={() => setShowSubscriptionHistory(true)}
          >
            Previous subscriptions
          </button>
          <button
            className="account-link"
            type="button"
            onClick={() => navigate("/pricing")}
          >
            View plans ↗
          </button>
        </div>
        <div className="subscription-panel">
          <div>
            <span className="status-dot status-dot-muted" />
            {subscription?.active ? (
              <>
                <strong>{subscription.plan}</strong>
                <p>
                  Expires in{" "}
                  {subscription.endDate
                    ? Math.max(
                        0,
                        Math.ceil(
                          (new Date(subscription.endDate) - new Date()) /
                            86400000,
                        ),
                      )
                    : "—"}{" "}
                  days · {subscription.remaining ?? "Unlimited"} downloads
                  available
                </p>
              </>
            ) : subscription?.status === "pending" ? (
              <>
                <strong>Pending approval</strong>
                <p>{subscription.plan} is awaiting admin approval.</p>
              </>
            ) : (
              <>
                <strong>No active subscriptions</strong>
                <p>Unlock more assets with a GFXunlimit plan.</p>
              </>
            )}{" "}
          </div>
          {!subscription?.active && (
            <button
              className="account-button account-button-primary"
              type="button"
              onClick={() => navigate("/pricing")}
            >
              Choose a plan
            </button>
          )}
        </div>
      </section>
      <AssetSection
        title="Recent downloads"
        eyebrow="Your library"
        items={recentDownloads}
        emptyTitle="No downloads yet"
        emptyCopy="Your downloaded assets will appear here."
        onAction={() => navigate("/explore")}
        action="Explore assets"
        onOpen={openAsset}
      />
      <AssetSection
        title="Recently favorited"
        eyebrow="Saved for later"
        items={recentFavorites}
        emptyTitle="No favorites yet"
        emptyCopy="Save assets you love and find them here later."
        onAction={() => navigate("/explore")}
        action="Browse assets"
        onOpen={openAsset}
      />
    </>
  );
  const renderSection = () => {
    if (activeSection === "overview") return renderOverview();
    if (activeSection === "notifications")
      return (
        <section className="account-section">
          <SectionHeader eyebrow="Stay in the loop" title="Notifications" />
          <div className="notification-list">
            {notifications.length ? (
              notifications.map((item) => (
                <article
                  className={`notification-item ${item.is_read ? "" : "is-unread"}`}
                  key={item.id}
                >
                  <span className="notification-pip" />
                  <div>
                    <strong>
                      {item.message || "A new update is waiting for you."}
                    </strong>
                    <small>{dateLabel(item.created_at)}</small>
                  </div>
                </article>
              ))
            ) : (
              <EmptyState
                title="You're all caught up"
                copy="New order, download, and account updates will appear here."
              />
            )}
          </div>
        </section>
      );
    if (activeSection === "profile") return <ProfilePanel profile={profile} />;
    if (activeSection === "billing")
      return (
        <SimplePanel
          eyebrow="Account finance"
          title="Billing"
          copy="Your invoices and payment history are available through your order history."
          action="View orders"
          onAction={() => navigate("/orders")}
        />
      );
    if (activeSection === "security")
      return (
        <SimplePanel
          eyebrow="Keep it protected"
          title="Security"
          copy="Manage your password and active sessions from the secure account settings."
          action="Open profile settings"
          onAction={() => navigate("/profile")}
        />
      );
    if (activeSection === "support")
      return (
        <SimplePanel
          eyebrow="We are here"
          title="Support"
          copy="Need a hand with an asset, order, or license? Start a conversation with the GFXunlimit team."
          action="Contact support"
          onAction={() => navigate("/contact")}
        />
      );
    return (
      <SimplePanel
        eyebrow="Your account"
        title={
          sections.find(([key]) => key === activeSection)?.[1] || "Account"
        }
        copy="This workspace is connected to your GFXunlimit account."
        action="Return to overview"
        onAction={() => setActiveSection("overview")}
      />
    );
  };

  return (
    <div
      className={`customer-account ${darkMode ? "customer-account-dark" : ""}`}
    >
      <aside className="account-sidebar">
        <div className="account-brand">
          <span>G</span>
          <strong>
            GFX<span>unlimit</span>
          </strong>
        </div>
        <nav>
          <p className="account-nav-label">Workspace</p>
          {sections.map(([key, label]) => (
            <button
              className={activeSection === key ? "is-active" : ""}
              type="button"
              key={key}
              onClick={() => goTo(key)}
            >
              {label}
              {key === "notifications" && unreadCount > 0 && (
                <em>{unreadCount}</em>
              )}
            </button>
          ))}
          <p className="account-nav-label account-nav-label-spaced">Account</p>
          {accountSections.map(([key, label]) => (
            <button
              className={activeSection === key ? "is-active" : ""}
              type="button"
              key={key}
              onClick={() => goTo(key)}
            >
              {label}
            </button>
          ))}
        </nav>
        <button
          className="account-logout"
          type="button"
          onClick={() => {
            localStorage.removeItem("token");
            window.location.href = "/";
          }}
        >
          Log out
        </button>
      </aside>
      <main className="account-main">
        <header className="account-profile">
          <div className="account-avatar">
            {displayName.charAt(0).toUpperCase()}
          </div>
          <div className="account-profile-copy">
            <span className="account-eyebrow">My account</span>
            <h1>Welcome back, {displayName.split(" ")[0]}</h1>
            <p>{profile?.email || username || "Your GFXunlimit account"}</p>
            <div className="account-meta">
              <span className="account-badge">Member</span>
              <span>Since {dateLabel(profile?.created_at)}</span>
            </div>
          </div>
          <div className="account-profile-actions">
            <button
              className="account-button account-button-light"
              type="button"
              onClick={() => setActiveSection("profile")}
            >
              Edit profile
            </button>
            <button
              className="account-icon-button"
              aria-label="Open settings"
              type="button"
              onClick={() => setActiveSection("security")}
            >
              ⚙
            </button>
          </div>
        </header>
        <div className="account-stats">
          <Stat
            label="Downloads"
            value={downloads.length}
            note="In your library"
          />
          <Stat
            label="Favorites"
            value={favorites.length}
            note="Saved assets"
          />
          <Stat label="Orders" value={orders.length} note="Recent history" />
          <Stat label="Cart" value={cart.length} note="Ready to review" />
        </div>
        <div className="account-mobile-nav">
          {sections.map(([key, label]) => (
            <button
              className={activeSection === key ? "is-active" : ""}
              key={key}
              type="button"
              onClick={() => goTo(key)}
            >
              {label}
            </button>
          ))}
        </div>
        {loading ? (
          <div className="account-loading">
            <span />
            <span />
            <span />
          </div>
        ) : (
          renderSection()
        )}
        <SubscriptionHistoryModal
          open={showSubscriptionHistory}
          onClose={() => setShowSubscriptionHistory(false)}
        />
      </main>
    </div>
  );
}

function Stat({ label, value, note }) {
  return (
    <div className="account-stat">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}
function SectionHeader({ eyebrow, title }) {
  const [historyOpen, setHistoryOpen] = useState(false);
  return (
    <>
      <div className="account-section-heading">
        <div>
          <span className="account-eyebrow">{eyebrow}</span>
          <h2>{title}</h2>
        </div>
        {title === "Subscription" && (
          <button
            className="account-link"
            type="button"
            onClick={() => setHistoryOpen(true)}
          >
            Previous subscriptions
          </button>
        )}
      </div>
      {title === "Subscription" && (
        <SubscriptionHistoryModal
          open={historyOpen}
          onClose={() => setHistoryOpen(false)}
        />
      )}
    </>
  );
}
function AssetSection({
  eyebrow,
  title,
  items,
  emptyTitle,
  emptyCopy,
  action,
  onAction,
  onOpen,
}) {
  return (
    <section className="account-section">
      <div className="account-section-heading">
        <div>
          <span className="account-eyebrow">{eyebrow}</span>
          <h2>{title}</h2>
        </div>
        <span className="account-count">{items.length} items</span>
      </div>
      {items.length ? (
        <div className="account-asset-grid">
          {items.map((asset, index) => (
            <AssetTile
              asset={asset}
              onOpen={onOpen}
              key={`${asset.id || asset.image_id}-${index}`}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          title={emptyTitle}
          copy={emptyCopy}
          action={action}
          onAction={onAction}
        />
      )}
    </section>
  );
}
function ProfilePanel({ profile }) {
  return (
    <section className="account-section">
      <SectionHeader eyebrow="Your details" title="Profile" />
      <div className="profile-panel">
        <div className="profile-panel-avatar">
          {(profile?.full_name || profile?.username || "C")
            .charAt(0)
            .toUpperCase()}
        </div>
        <div className="profile-fields">
          <div>
            <span>Name</span>
            <strong>
              {profile?.full_name || profile?.username || "Not set"}
            </strong>
          </div>
          <div>
            <span>Email</span>
            <strong>{profile?.email || "Not set"}</strong>
          </div>
          <div>
            <span>Credits</span>
            <strong>{profile?.credits ?? "—"}</strong>
          </div>
          <p>
            Profile editing is managed through your secure profile settings.
          </p>
          <button
            className="account-button account-button-primary"
            type="button"
            onClick={() => (window.location.href = "/profile")}
          >
            Open profile settings
          </button>
        </div>
      </div>
    </section>
  );
}
function SimplePanel({ eyebrow, title, copy, action, onAction }) {
  return (
    <section className="account-section">
      <SectionHeader eyebrow={eyebrow} title={title} />
      <div className="account-simple-panel">
        <span className="account-empty-mark">+</span>
        <p>{copy}</p>
        <button
          className="account-button account-button-primary"
          type="button"
          onClick={onAction}
        >
          {action}
        </button>
      </div>
    </section>
  );
}
function SubscriptionHistoryModal({ open, onClose }) {
  const [subscriptions, setSubscriptions] = useState([]);
  useEffect(() => {
    if (!open) return undefined;
    const token = localStorage.getItem("token");
    axios
      .get(`${API_BASE_URL}/subscription-history`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      .then((response) =>
        setSubscriptions(Array.isArray(response.data) ? response.data : []),
      )
      .catch(() => setSubscriptions([]));
    return undefined;
  }, [open]);
  if (!open) return null;
  const statusLabel = (status) =>
    status === "active"
      ? "Active"
      : status === "pending"
        ? "Pending approval"
        : status
          ? status.charAt(0).toUpperCase() + status.slice(1)
          : "Unknown";
  return (
    <div
      className="subscription-history-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <section
        className="subscription-history-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="subscription-history-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="subscription-history-header">
          <div>
            <span className="account-eyebrow">Account history</span>
            <h2 id="subscription-history-title">Previous subscriptions</h2>
            <p>Every plan associated with your account.</p>
          </div>
          <button
            className="account-icon-button"
            type="button"
            aria-label="Close previous subscriptions"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        {subscriptions.length ? (
          <div className="subscription-history-list">
            {subscriptions.map((item) => (
              <article className="subscription-history-item" key={item.id}>
                <div>
                  <strong>{item.base_plan || "Subscription plan"}</strong>
                  <span>
                    {item.custom_duration || "Plan"} ·{" "}
                    {dateLabel(item.custom_start_date)} to{" "}
                    {dateLabel(item.custom_end_date)}
                  </span>
                  {(item.admin_notes?.remarks || item.activity_log?.[0]?.remarks) && (
                    <small>
                      Admin remark: {item.admin_notes?.remarks || item.activity_log[0].remarks}
                    </small>
                  )}
                </div>
                <span
                  className={`subscription-history-status is-${item.status || "unknown"}`}
                >
                  {statusLabel(item.status)}
                </span>
              </article>
            ))}
          </div>
        ) : (
          <div className="subscription-history-empty">
            No previous subscriptions found.
          </div>
        )}
      </section>
    </div>
  );
}
