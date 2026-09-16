import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { getEffectiveAuthToken } from "../utils/authSession";
import "./AdminPromotionsPanel.css";

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || "http://localhost:5000";
const SECTION_ITEMS = [
  { key: "dashboard", label: "Dashboard" },
  { key: "coupons", label: "Coupons" },
  { key: "campaigns", label: "Campaigns" },
  { key: "flash-sales", label: "Flash Sales" },
  { key: "referrals", label: "Referral Program" },
  { key: "loyalty", label: "Loyalty Rewards" },
  { key: "gift-cards", label: "Gift Cards" },
  { key: "bundles", label: "Bundle Discounts" },
  { key: "newsletters", label: "Newsletter Campaigns" },
  { key: "banners", label: "Promotional Banners" },
  { key: "popups", label: "Popups" },
  { key: "announcements", label: "Announcement Bar" },
  { key: "push", label: "Push Notifications" },
  { key: "automation", label: "Automation Rules" },
  { key: "analytics", label: "Analytics" },
  { key: "reports", label: "Reports" },
  { key: "settings", label: "Settings" },
  { key: "activity", label: "Activity Log" }
];

const initialCouponForm = {
  name: "",
  code: "",
  coupon_type: "manual",
  discount_type: "percentage",
  discount_value: "",
  status: "active",
  start_at: "",
  end_at: "",
  usage_limit: "",
  notes: ""
};

const initialCampaignForm = {
  name: "",
  campaign_type: "launch",
  objective: "",
  status: "planned",
  budget: "",
  start_date: "",
  end_date: "",
  audience: "",
  priority: "medium",
  notes: ""
};

const initialFlashForm = {
  name: "",
  discount_rule: "",
  status: "scheduled",
  start_date: "",
  end_date: "",
  featured_placement: "homepage"
};

const initialReferralForm = {
  name: "",
  reward_type: "credit",
  signup_reward: "",
  purchase_reward: "",
  status: "active"
};

const initialLoyaltyForm = {
  name: "",
  points_system: "",
  reward_level: "",
  bonus_points: "",
  expiry_days: "",
  status: "active"
};

const initialGiftCardForm = {
  name: "",
  code: "",
  value: "",
  expiry_date: "",
  status: "active"
};

const initialBundleForm = {
  name: "",
  bundle_assets: "",
  bundle_discount: "",
  bundle_price: "",
  status: "active"
};

const initialNewsletterForm = {
  name: "",
  subject: "",
  schedule: "",
  audience: "all",
  status: "draft"
};

const initialBannerForm = {
  name: "",
  placement: "homepage",
  priority: "medium",
  schedule: "",
  status: "draft"
};

const initialPopupForm = {
  name: "",
  trigger: "homepage",
  schedule: "",
  status: "draft"
};

const initialAnnouncementForm = {
  name: "",
  text: "",
  schedule: "",
  status: "active"
};

const initialPushForm = {
  name: "",
  channel: "browser",
  audience: "all",
  schedule: "",
  status: "draft"
};

const initialAutomationForm = {
  name: "",
  trigger: "new_registration",
  channel: "email",
  status: "active"
};

const buildAuthHeaders = () => {
  const token = typeof window !== "undefined" ? getEffectiveAuthToken() : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
};

function AdminPromotionsPanel() {
  const [activeSection, setActiveSection] = useState("dashboard");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [dashboard, setDashboard] = useState({
    active_campaigns: 0,
    scheduled_campaigns: 0,
    expired_campaigns: 0,
    coupons_created: 0,
    coupons_redeemed: 0,
    revenue_generated: 0,
    revenue_discounted: 0,
    average_discount: 0,
    gift_cards_sold: 0,
    referral_revenue: 0,
    loyalty_members: 0,
    flash_sales: 0,
    active_banners: 0,
    newsletter_campaigns: 0,
    conversion_rate: 0,
    email_open_rate: 0,
    email_click_rate: 0,
    coupon_redemption_rate: 0
  });
  const [coupons, setCoupons] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [flashSales, setFlashSales] = useState([]);
  const [referrals, setReferrals] = useState([]);
  const [loyalty, setLoyalty] = useState([]);
  const [giftCards, setGiftCards] = useState([]);
  const [bundles, setBundles] = useState([]);
  const [newsletters, setNewsletters] = useState([]);
  const [banners, setBanners] = useState([]);
  const [popups, setPopups] = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [pushItems, setPushItems] = useState([]);
  const [automations, setAutomations] = useState([]);
  const [activityLog, setActivityLog] = useState([]);
  const [couponDraft, setCouponDraft] = useState(initialCouponForm);
  const [campaignDraft, setCampaignDraft] = useState(initialCampaignForm);
  const [flashDraft, setFlashDraft] = useState(initialFlashForm);
  const [referralDraft, setReferralDraft] = useState(initialReferralForm);
  const [loyaltyDraft, setLoyaltyDraft] = useState(initialLoyaltyForm);
  const [giftCardDraft, setGiftCardDraft] = useState(initialGiftCardForm);
  const [bundleDraft, setBundleDraft] = useState(initialBundleForm);
  const [newsletterDraft, setNewsletterDraft] = useState(initialNewsletterForm);
  const [bannerDraft, setBannerDraft] = useState(initialBannerForm);
  const [popupDraft, setPopupDraft] = useState(initialPopupForm);
  const [announcementDraft, setAnnouncementDraft] = useState(initialAnnouncementForm);
  const [pushDraft, setPushDraft] = useState(initialPushForm);
  const [automationDraft, setAutomationDraft] = useState(initialAutomationForm);
  const [couponSearch, setCouponSearch] = useState("");
  const [couponFilter, setCouponFilter] = useState("all");
  const [editingCouponId, setEditingCouponId] = useState(null);
  const [editingCampaignId, setEditingCampaignId] = useState(null);
  const [editingFlashId, setEditingFlashId] = useState(null);

  const loadPromotions = async () => {
    try {
      setLoading(true);
      const res = await axios.get(`${API_BASE_URL}/admin/promotions`, { headers: buildAuthHeaders() });
      const payload = res.data || {};
      setDashboard(payload.dashboard || dashboard);
      setCoupons(Array.isArray(payload.coupons) ? payload.coupons : []);
      setCampaigns(Array.isArray(payload.campaigns) ? payload.campaigns : []);
      setFlashSales(Array.isArray(payload.flash_sales) ? payload.flash_sales : []);
      setReferrals(Array.isArray(payload.referrals) ? payload.referrals : []);
      setLoyalty(Array.isArray(payload.loyalty) ? payload.loyalty : []);
      setGiftCards(Array.isArray(payload.gift_cards) ? payload.gift_cards : []);
      setBundles(Array.isArray(payload.bundles) ? payload.bundles : []);
      setNewsletters(Array.isArray(payload.newsletters) ? payload.newsletters : []);
      setBanners(Array.isArray(payload.banners) ? payload.banners : []);
      setPopups(Array.isArray(payload.popups) ? payload.popups : []);
      setAnnouncements(Array.isArray(payload.announcements) ? payload.announcements : []);
      setPushItems(Array.isArray(payload.push_notifications) ? payload.push_notifications : []);
      setAutomations(Array.isArray(payload.automation_rules) ? payload.automation_rules : []);
      setActivityLog(Array.isArray(payload.activity_logs) ? payload.activity_logs : []);
      setMessage(payload.message || "");
    } catch (err) {
      console.error(err);
      setMessage(err.response?.data?.error || "Unable to load promotions data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPromotions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredCoupons = useMemo(() => {
    return coupons.filter((coupon) => {
      const matchesSearch = !couponSearch || String(coupon.name || coupon.code || "").toLowerCase().includes(couponSearch.toLowerCase());
      const matchesFilter = couponFilter === "all" || String(coupon.status || "draft") === couponFilter;
      return matchesSearch && matchesFilter;
    });
  }, [coupons, couponSearch, couponFilter]);

  const persistResource = async (resource, action, data, successMessage) => {
    try {
      const res = await axios.post(`${API_BASE_URL}/admin/promotions`, { resource, action, data }, { headers: buildAuthHeaders() });
      setMessage(successMessage || res.data?.message || "Saved successfully.");
      await loadPromotions();
      return res.data;
    } catch (err) {
      console.error(err);
      setMessage(err.response?.data?.error || "Request failed.");
      throw err;
    }
  };

  const handleCouponSubmit = async (event) => {
    event.preventDefault();
    const payload = {
      ...couponDraft,
      discount_value: Number(couponDraft.discount_value || 0),
      usage_limit: Number(couponDraft.usage_limit || 0)
    };
    if (editingCouponId) {
      await persistResource("coupon", "update", { ...payload, id: editingCouponId }, "Coupon updated.");
      setEditingCouponId(null);
      setCouponDraft(initialCouponForm);
      return;
    }
    await persistResource("coupon", "create", payload, "Coupon created.");
    setCouponDraft(initialCouponForm);
  };

  const startEditingCoupon = (coupon) => {
    setEditingCouponId(coupon.id);
    setCouponDraft({
      name: coupon.name || "",
      code: coupon.code || "",
      coupon_type: coupon.coupon_type || "manual",
      discount_type: coupon.discount_type || "percentage",
      discount_value: coupon.discount_value ?? "",
      status: coupon.status || "active",
      start_at: coupon.start_at ? String(coupon.start_at).slice(0, 10) : "",
      end_at: coupon.end_at ? String(coupon.end_at).slice(0, 10) : "",
      usage_limit: coupon.usage_limit ?? "",
      notes: coupon.notes || ""
    });
    setActiveSection("coupons");
  };

  const toggleCouponStatus = async (coupon, nextStatus) => {
    await persistResource("coupon", "update", { id: coupon.id, status: nextStatus }, "Coupon status updated.");
  };

  const duplicateCoupon = async (coupon) => {
    await persistResource("coupon", "duplicate", { id: coupon.id }, "Coupon duplicated.");
  };

  const deleteCoupon = async (id) => {
    await persistResource("coupon", "delete", { id }, "Coupon removed.");
  };

  const handleCampaignSubmit = async (event) => {
    event.preventDefault();
    const payload = {
      ...campaignDraft,
      budget: Number(campaignDraft.budget || 0)
    };
    if (editingCampaignId) {
      await persistResource("campaign", "update", { ...payload, id: editingCampaignId }, "Campaign updated.");
      setEditingCampaignId(null);
      setCampaignDraft(initialCampaignForm);
      return;
    }
    await persistResource("campaign", "create", payload, "Campaign created.");
    setCampaignDraft(initialCampaignForm);
  };

  const startEditingCampaign = (campaign) => {
    setEditingCampaignId(campaign.id);
    setCampaignDraft({
      name: campaign.name || "",
      campaign_type: campaign.campaign_type || "launch",
      objective: campaign.objective || "",
      status: campaign.status || "planned",
      budget: campaign.budget ?? "",
      start_date: campaign.start_date ? String(campaign.start_date).slice(0, 10) : "",
      end_date: campaign.end_date ? String(campaign.end_date).slice(0, 10) : "",
      audience: campaign.audience || "",
      priority: campaign.priority || "medium",
      notes: campaign.notes || ""
    });
    setActiveSection("campaigns");
  };

  const handleFlashSubmit = async (event) => {
    event.preventDefault();
    if (editingFlashId) {
      await persistResource("flash_sale", "update", { ...flashDraft, id: editingFlashId }, "Flash sale updated.");
      setEditingFlashId(null);
      setFlashDraft(initialFlashForm);
      return;
    }
    await persistResource("flash_sale", "create", flashDraft, "Flash sale created.");
    setFlashDraft(initialFlashForm);
  };

  const startEditingFlash = (sale) => {
    setEditingFlashId(sale.id);
    setFlashDraft({
      name: sale.name || "",
      discount_rule: sale.discount_rule || "",
      status: sale.status || "scheduled",
      start_date: sale.start_date ? String(sale.start_date).slice(0, 10) : "",
      end_date: sale.end_date ? String(sale.end_date).slice(0, 10) : "",
      featured_placement: sale.featured_placement || "homepage"
    });
    setActiveSection("flash-sales");
  };

  const saveSectionItem = async (resource, draft, setter, resetForm, successMessage) => {
    await persistResource(resource, "create", draft, successMessage);
    setter(resetForm);
  };

  const renderKpiCards = () => {
    const cards = [
      { label: "Active Campaigns", value: dashboard.active_campaigns || 0 },
      { label: "Scheduled Campaigns", value: dashboard.scheduled_campaigns || 0 },
      { label: "Expired Campaigns", value: dashboard.expired_campaigns || 0 },
      { label: "Coupons Created", value: dashboard.coupons_created || 0 },
      { label: "Coupons Redeemed", value: dashboard.coupons_redeemed || 0 },
      { label: "Revenue Generated", value: `₹${Number(dashboard.revenue_generated || 0).toLocaleString()}` },
      { label: "Revenue Discounted", value: `₹${Number(dashboard.revenue_discounted || 0).toLocaleString()}` },
      { label: "Average Discount", value: `${Number(dashboard.average_discount || 0).toFixed(1)}%` },
      { label: "Gift Cards Sold", value: dashboard.gift_cards_sold || 0 },
      { label: "Referral Revenue", value: `₹${Number(dashboard.referral_revenue || 0).toLocaleString()}` },
      { label: "Loyalty Members", value: dashboard.loyalty_members || 0 },
      { label: "Flash Sales", value: dashboard.flash_sales || 0 },
      { label: "Active Banners", value: dashboard.active_banners || 0 },
      { label: "Newsletter Campaigns", value: dashboard.newsletter_campaigns || 0 },
      { label: "Conversion Rate", value: `${Number(dashboard.conversion_rate || 0).toFixed(1)}%` },
      { label: "Email Open Rate", value: `${Number(dashboard.email_open_rate || 0).toFixed(1)}%` },
      { label: "Email Click Rate", value: `${Number(dashboard.email_click_rate || 0).toFixed(1)}%` },
      { label: "Coupon Redemption Rate", value: `${Number(dashboard.coupon_redemption_rate || 0).toFixed(1)}%` }
    ];

    return (
      <div className="promotions-kpi-grid">
        {cards.map((card) => (
          <div key={card.label} className="promotions-card">
            <div className="promotions-card-label">{card.label}</div>
            <div className="promotions-card-value">{card.value}</div>
          </div>
        ))}
      </div>
    );
  };

  const renderSectionContent = () => {
    switch (activeSection) {
      case "dashboard":
        return (
          <div className="promotions-stack">
            <div className="promotions-card promotions-hero">
              <div>
                <div className="promotions-eyebrow">Enterprise Marketing Hub</div>
                <h3>Promotions Hub</h3>
                <p>Create, schedule, and analyze promotions from one place with PostgreSQL-backed workflows.</p>
              </div>
              <div className="promotions-chip">Super Admin + Authorized Admin</div>
            </div>
            {renderKpiCards()}
          </div>
        );
      case "coupons":
        return (
          <div className="promotions-stack">
            <div className="promotions-card">
              <div className="promotions-card-header">
                <h3>Coupon Management</h3>
                <span>Create, edit, duplicate, enable, disable, archive, and search coupons.</span>
              </div>
              <form className="promotions-form-grid" onSubmit={handleCouponSubmit}>
                <input value={couponDraft.name} onChange={(e) => setCouponDraft((prev) => ({ ...prev, name: e.target.value }))} placeholder="Coupon name" />
                <input value={couponDraft.code} onChange={(e) => setCouponDraft((prev) => ({ ...prev, code: e.target.value }))} placeholder="Coupon code" />
                <select value={couponDraft.coupon_type} onChange={(e) => setCouponDraft((prev) => ({ ...prev, coupon_type: e.target.value }))}>
                  <option value="manual">Manual</option>
                  <option value="auto">Auto Generated</option>
                  <option value="referral">Referral</option>
                  <option value="first_order">First Order</option>
                </select>
                <select value={couponDraft.discount_type} onChange={(e) => setCouponDraft((prev) => ({ ...prev, discount_type: e.target.value }))}>
                  <option value="percentage">Percentage</option>
                  <option value="fixed">Fixed Amount</option>
                  <option value="free_asset">Free Asset</option>
                  <option value="gift_credit">Gift Credits</option>
                </select>
                <input type="number" value={couponDraft.discount_value} onChange={(e) => setCouponDraft((prev) => ({ ...prev, discount_value: e.target.value }))} placeholder="Discount value" />
                <input type="date" value={couponDraft.start_at} onChange={(e) => setCouponDraft((prev) => ({ ...prev, start_at: e.target.value }))} />
                <input type="date" value={couponDraft.end_at} onChange={(e) => setCouponDraft((prev) => ({ ...prev, end_at: e.target.value }))} />
                <input type="number" value={couponDraft.usage_limit} onChange={(e) => setCouponDraft((prev) => ({ ...prev, usage_limit: e.target.value }))} placeholder="Usage limit" />
                <select value={couponDraft.status} onChange={(e) => setCouponDraft((prev) => ({ ...prev, status: e.target.value }))}>
                  <option value="active">Active</option>
                  <option value="disabled">Disabled</option>
                  <option value="archived">Archived</option>
                  <option value="draft">Draft</option>
                </select>
                <textarea value={couponDraft.notes} onChange={(e) => setCouponDraft((prev) => ({ ...prev, notes: e.target.value }))} placeholder="Notes" />
                <button type="submit">{editingCouponId ? "Update Coupon" : "Create Coupon"}</button>
              </form>
            </div>
            <div className="promotions-card">
              <div className="promotions-card-header">
                <h3>Coupon Library</h3>
                <div className="promotions-inline-controls">
                  <input value={couponSearch} onChange={(e) => setCouponSearch(e.target.value)} placeholder="Search" />
                  <select value={couponFilter} onChange={(e) => setCouponFilter(e.target.value)}>
                    <option value="all">All</option>
                    <option value="active">Active</option>
                    <option value="disabled">Disabled</option>
                    <option value="archived">Archived</option>
                  </select>
                </div>
              </div>
              <div className="promotions-list">
                {filteredCoupons.length === 0 ? <p>No coupons yet.</p> : filteredCoupons.map((coupon) => {
                  const usageLimit = Number(coupon.usage_limit || 0);
                  const usedCount = Number(coupon.used_count || 0);
                  const remainingUses = usageLimit > 0 ? Math.max(0, usageLimit - usedCount) : "Unlimited";
                  const expiryText = coupon.expires_label || (
                    coupon.end_at ? `Expires in ${Math.ceil((new Date(coupon.end_at) - new Date()) / (1000 * 60 * 60 * 24))} days` : "No expiry date"
                  );

                  return (
                    <div key={coupon.id} className="promotions-list-item">
                      <div>
                        <strong>{coupon.name || coupon.code}</strong>
                        <div className="promotions-muted">
                          {coupon.code} • {String(coupon.discount_type || '').replace(/^(flat|fixed)$/i, 'Fixed Amount').replace(/^percentage$/i, 'Percentage')} • {coupon.status}
                        </div>
                        <div className="promotions-muted">
                          {usageLimit > 0 ? `Remaining: ${remainingUses}/${usageLimit}` : 'Remaining: Unlimited'} • {expiryText}
                        </div>
                      </div>
                      <div className="promotions-inline-actions">
                        <button type="button" onClick={() => startEditingCoupon(coupon)}>Edit</button>
                        <button type="button" onClick={() => duplicateCoupon(coupon)}>Duplicate</button>
                        <button type="button" onClick={() => toggleCouponStatus(coupon, coupon.status === "active" ? "disabled" : "active")}>{coupon.status === "active" ? "Disable" : "Enable"}</button>
                        <button type="button" onClick={() => deleteCoupon(coupon.id)}>Delete</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      case "campaigns":
        return (
          <div className="promotions-stack">
            <div className="promotions-card">
              <div className="promotions-card-header">
                <h3>Campaigns</h3>
                <span>Plan launches, budgets, audiences, and notes in one place.</span>
              </div>
              <form className="promotions-form-grid" onSubmit={handleCampaignSubmit}>
                <input value={campaignDraft.name} onChange={(e) => setCampaignDraft((prev) => ({ ...prev, name: e.target.value }))} placeholder="Campaign name" />
                <input value={campaignDraft.objective} onChange={(e) => setCampaignDraft((prev) => ({ ...prev, objective: e.target.value }))} placeholder="Objective" />
                <select value={campaignDraft.campaign_type} onChange={(e) => setCampaignDraft((prev) => ({ ...prev, campaign_type: e.target.value }))}>
                  <option value="launch">Launch</option>
                  <option value="festival">Festival</option>
                  <option value="seasonal">Seasonal</option>
                  <option value="vip">VIP</option>
                </select>
                <input type="number" value={campaignDraft.budget} onChange={(e) => setCampaignDraft((prev) => ({ ...prev, budget: e.target.value }))} placeholder="Budget" />
                <input type="date" value={campaignDraft.start_date} onChange={(e) => setCampaignDraft((prev) => ({ ...prev, start_date: e.target.value }))} />
                <input type="date" value={campaignDraft.end_date} onChange={(e) => setCampaignDraft((prev) => ({ ...prev, end_date: e.target.value }))} />
                <input value={campaignDraft.audience} onChange={(e) => setCampaignDraft((prev) => ({ ...prev, audience: e.target.value }))} placeholder="Target audience" />
                <select value={campaignDraft.priority} onChange={(e) => setCampaignDraft((prev) => ({ ...prev, priority: e.target.value }))}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
                <select value={campaignDraft.status} onChange={(e) => setCampaignDraft((prev) => ({ ...prev, status: e.target.value }))}>
                  <option value="planned">Planned</option>
                  <option value="running">Running</option>
                  <option value="completed">Completed</option>
                </select>
                <textarea value={campaignDraft.notes} onChange={(e) => setCampaignDraft((prev) => ({ ...prev, notes: e.target.value }))} placeholder="Notes" />
                <button type="submit">{editingCampaignId ? "Update Campaign" : "Create Campaign"}</button>
              </form>
            </div>
            <div className="promotions-card">
              <div className="promotions-card-header">
                <h3>Campaign Library</h3>
              </div>
              <div className="promotions-list">
                {campaigns.length === 0 ? <p>No campaigns yet.</p> : campaigns.map((campaign) => (
                  <div key={campaign.id} className="promotions-list-item">
                    <div>
                      <strong>{campaign.name}</strong>
                      <div className="promotions-muted">{campaign.objective} • {campaign.status}</div>
                    </div>
                    <div className="promotions-inline-actions">
                      <button type="button" onClick={() => startEditingCampaign(campaign)}>Edit</button>
                      <button type="button" onClick={() => persistResource("campaign", "delete", { id: campaign.id }, "Campaign removed.")}>Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      case "flash-sales":
        return (
          <div className="promotions-stack">
            <div className="promotions-card">
              <div className="promotions-card-header">
                <h3>Flash Sales</h3>
                <span>Build urgency, countdown rules, and featured placement.</span>
              </div>
              <form className="promotions-form-grid" onSubmit={handleFlashSubmit}>
                <input value={flashDraft.name} onChange={(e) => setFlashDraft((prev) => ({ ...prev, name: e.target.value }))} placeholder="Flash sale name" />
                <input value={flashDraft.discount_rule} onChange={(e) => setFlashDraft((prev) => ({ ...prev, discount_rule: e.target.value }))} placeholder="Discount rule" />
                <input type="date" value={flashDraft.start_date} onChange={(e) => setFlashDraft((prev) => ({ ...prev, start_date: e.target.value }))} />
                <input type="date" value={flashDraft.end_date} onChange={(e) => setFlashDraft((prev) => ({ ...prev, end_date: e.target.value }))} />
                <select value={flashDraft.featured_placement} onChange={(e) => setFlashDraft((prev) => ({ ...prev, featured_placement: e.target.value }))}>
                  <option value="homepage">Homepage</option>
                  <option value="category">Category</option>
                  <option value="collection">Collection</option>
                </select>
                <select value={flashDraft.status} onChange={(e) => setFlashDraft((prev) => ({ ...prev, status: e.target.value }))}>
                  <option value="scheduled">Scheduled</option>
                  <option value="running">Running</option>
                  <option value="expired">Expired</option>
                </select>
                <button type="submit">{editingFlashId ? "Update Flash Sale" : "Create Flash Sale"}</button>
              </form>
            </div>
            <div className="promotions-card">
              <div className="promotions-card-header">
                <h3>Flash Events</h3>
              </div>
              <div className="promotions-list">
                {flashSales.length === 0 ? <p>No flash sales yet.</p> : flashSales.map((sale) => (
                  <div key={sale.id} className="promotions-list-item">
                    <div>
                      <strong>{sale.name}</strong>
                      <div className="promotions-muted">{sale.discount_rule} • {sale.status}</div>
                    </div>
                    <div className="promotions-inline-actions">
                      <button type="button" onClick={() => startEditingFlash(sale)}>Edit</button>
                      <button type="button" onClick={() => persistResource("flash_sale", "delete", { id: sale.id }, "Flash sale removed.")}>Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      case "referrals":
        return renderSimpleSection("Referral Program", "referral", referrals, referralDraft, setReferralDraft, initialReferralForm, "Referral program created.", [
          { key: "name", label: "Program name", type: "text" },
          { key: "signup_reward", label: "Signup reward", type: "text" },
          { key: "purchase_reward", label: "Purchase reward", type: "text" },
          { key: "reward_type", label: "Reward type", type: "select", options: [{ value: "credit", label: "Credits" }, { value: "discount", label: "Discount" }] },
          { key: "status", label: "Status", type: "select", options: [{ value: "active", label: "Active" }, { value: "paused", label: "Paused" }] }
        ]);
      case "loyalty":
        return renderSimpleSection("Loyalty Rewards", "loyalty", loyalty, loyaltyDraft, setLoyaltyDraft, initialLoyaltyForm, "Loyalty reward created.", [
          { key: "name", label: "Program name", type: "text" },
          { key: "points_system", label: "Points system", type: "text" },
          { key: "reward_level", label: "Reward level", type: "text" },
          { key: "bonus_points", label: "Bonus points", type: "text" },
          { key: "expiry_days", label: "Expiry days", type: "text" },
          { key: "status", label: "Status", type: "select", options: [{ value: "active", label: "Active" }, { value: "paused", label: "Paused" }] }
        ]);
      case "gift-cards":
        return renderSimpleSection("Gift Cards", "gift_card", giftCards, giftCardDraft, setGiftCardDraft, initialGiftCardForm, "Gift card saved.", [
          { key: "name", label: "Gift card name", type: "text" },
          { key: "code", label: "Code", type: "text" },
          { key: "value", label: "Value", type: "text" },
          { key: "expiry_date", label: "Expiry", type: "date" },
          { key: "status", label: "Status", type: "select", options: [{ value: "active", label: "Active" }, { value: "used", label: "Used" }] }
        ]);
      case "bundles":
        return renderSimpleSection("Bundle Discounts", "bundle", bundles, bundleDraft, setBundleDraft, initialBundleForm, "Bundle saved.", [
          { key: "name", label: "Bundle name", type: "text" },
          { key: "bundle_assets", label: "Assets", type: "text" },
          { key: "bundle_discount", label: "Discount", type: "text" },
          { key: "bundle_price", label: "Price", type: "text" },
          { key: "status", label: "Status", type: "select", options: [{ value: "active", label: "Active" }, { value: "draft", label: "Draft" }] }
        ]);
      case "newsletters":
        return renderSimpleSection("Newsletter Campaigns", "newsletter", newsletters, newsletterDraft, setNewsletterDraft, initialNewsletterForm, "Newsletter saved.", [
          { key: "name", label: "Campaign name", type: "text" },
          { key: "subject", label: "Subject", type: "text" },
          { key: "schedule", label: "Schedule", type: "text" },
          { key: "audience", label: "Audience", type: "text" },
          { key: "status", label: "Status", type: "select", options: [{ value: "draft", label: "Draft" }, { value: "scheduled", label: "Scheduled" }, { value: "sent", label: "Sent" }] }
        ]);
      case "banners":
        return renderSimpleSection("Promotional Banners", "banner", banners, bannerDraft, setBannerDraft, initialBannerForm, "Banner saved.", [
          { key: "name", label: "Banner name", type: "text" },
          { key: "placement", label: "Placement", type: "text" },
          { key: "priority", label: "Priority", type: "text" },
          { key: "schedule", label: "Schedule", type: "text" },
          { key: "status", label: "Status", type: "select", options: [{ value: "draft", label: "Draft" }, { value: "active", label: "Active" }] }
        ]);
      case "popups":
        return renderSimpleSection("Popups", "popup", popups, popupDraft, setPopupDraft, initialPopupForm, "Popup saved.", [
          { key: "name", label: "Popup name", type: "text" },
          { key: "trigger", label: "Trigger", type: "text" },
          { key: "schedule", label: "Schedule", type: "text" },
          { key: "status", label: "Status", type: "select", options: [{ value: "draft", label: "Draft" }, { value: "active", label: "Active" }] }
        ]);
      case "announcements":
        return renderSimpleSection("Announcement Bar", "announcement", announcements, announcementDraft, setAnnouncementDraft, initialAnnouncementForm, "Announcement saved.", [
          { key: "name", label: "Announcement name", type: "text" },
          { key: "text", label: "Text", type: "text" },
          { key: "schedule", label: "Schedule", type: "text" },
          { key: "status", label: "Status", type: "select", options: [{ value: "active", label: "Active" }, { value: "paused", label: "Paused" }] }
        ]);
      case "push":
        return renderSimpleSection("Push Notifications", "push_notification", pushItems, pushDraft, setPushDraft, initialPushForm, "Push notification saved.", [
          { key: "name", label: "Notification name", type: "text" },
          { key: "channel", label: "Channel", type: "text" },
          { key: "audience", label: "Audience", type: "text" },
          { key: "schedule", label: "Schedule", type: "text" },
          { key: "status", label: "Status", type: "select", options: [{ value: "draft", label: "Draft" }, { value: "scheduled", label: "Scheduled" }] }
        ]);
      case "automation":
        return renderSimpleSection("Automation Rules", "automation", automations, automationDraft, setAutomationDraft, initialAutomationForm, "Automation saved.", [
          { key: "name", label: "Rule name", type: "text" },
          { key: "trigger", label: "Trigger", type: "text" },
          { key: "channel", label: "Channel", type: "text" },
          { key: "status", label: "Status", type: "select", options: [{ value: "active", label: "Active" }, { value: "paused", label: "Paused" }] }
        ]);
      case "analytics":
        return (
          <div className="promotions-stack">
            <div className="promotions-card">
              <div className="promotions-card-header">
                <h3>Analytics</h3>
                <span>Interactive charts and performance snapshots for campaigns, referrals, loyalty, and gift cards.</span>
              </div>
              <div className="promotions-list">
                <div className="promotions-list-item">
                  <div><strong>Coupon Usage</strong><div className="promotions-muted">Track top coupons and redemption velocity.</div></div>
                </div>
                <div className="promotions-list-item">
                  <div><strong>Revenue Generated</strong><div className="promotions-muted">Compare promotion revenue with discount impact.</div></div>
                </div>
                <div className="promotions-list-item">
                  <div><strong>Campaign Performance</strong><div className="promotions-muted">Review conversion, email engagement, and participation rates.</div></div>
                </div>
              </div>
            </div>
          </div>
        );
      case "reports":
        return (
          <div className="promotions-stack">
            <div className="promotions-card">
              <div className="promotions-card-header">
                <h3>Reports</h3>
                <span>Consolidated reports for coupons, campaigns, gift cards, loyalty, newsletter, flash sales, and bundles.</span>
              </div>
              <div className="promotions-list">
                {['Coupons','Campaigns','Gift Cards','Loyalty','Referral','Newsletter','Flash Sales','Bundles','Promotion Revenue','Promotion ROI'].map((item) => (
                  <div className="promotions-list-item" key={item}><div><strong>{item}</strong></div></div>
                ))}
              </div>
            </div>
          </div>
        );
      case "settings":
        return (
          <div className="promotions-stack">
            <div className="promotions-card">
              <div className="promotions-card-header">
                <h3>Settings</h3>
                <span>Manage defaults for expiry, stacking rules, eligibility, and automated promotion policy.</span>
              </div>
              <div className="promotions-list">
                <div className="promotions-list-item"><div><strong>Role-based permissions</strong><div className="promotions-muted">Super admin and authorized admins can manage the hub.</div></div></div>
                <div className="promotions-list-item"><div><strong>Duplicate coupon prevention</strong><div className="promotions-muted">Enabled by default.</div></div></div>
                <div className="promotions-list-item"><div><strong>Automatic expiry</strong><div className="promotions-muted">Policies are applied automatically when promotions end.</div></div></div>
              </div>
            </div>
          </div>
        );
      case "activity":
        return (
          <div className="promotions-stack">
            <div className="promotions-card">
              <div className="promotions-card-header">
                <h3>Activity Log</h3>
                <span>Track every create, edit, activation, expiry, redemption, send, and schedule action.</span>
              </div>
              <div className="promotions-list">
                {activityLog.length === 0 ? <p>No recent activity yet.</p> : activityLog.map((entry) => (
                  <div key={entry.id || `${entry.action}-${entry.created_at}`} className="promotions-list-item">
                    <div><strong>{entry.action || entry.type || "Activity"}</strong><div className="promotions-muted">{entry.details || entry.description || ""}</div></div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  const renderSimpleSection = (title, resource, items, draft, setter, resetDraft, successMessage, fields) => {
    const handleSimpleSubmit = async (event) => {
      event.preventDefault();
      await persistResource(resource, "create", draft, successMessage);
      setter(resetDraft);
    };

    return (
      <div className="promotions-stack">
        <div className="promotions-card">
          <div className="promotions-card-header">
            <h3>{title}</h3>
            <span>Persist and review entries in PostgreSQL immediately.</span>
          </div>
          <form className="promotions-form-grid" onSubmit={handleSimpleSubmit}>
            {fields.map((field) => (
              <div key={field.key} className="promotions-field-group">
                {field.type === "select" ? (
                  <>
                    <label>{field.label}</label>
                    <select value={draft[field.key] || ""} onChange={(e) => setter((prev) => ({ ...prev, [field.key]: e.target.value }))}>
                      {field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </>
                ) : field.type === "date" ? (
                  <>
                    <label>{field.label}</label>
                    <input type="date" value={draft[field.key] || ""} onChange={(e) => setter((prev) => ({ ...prev, [field.key]: e.target.value }))} />
                  </>
                ) : (
                  <>
                    <label>{field.label}</label>
                    <input value={draft[field.key] || ""} onChange={(e) => setter((prev) => ({ ...prev, [field.key]: e.target.value }))} />
                  </>
                )}
              </div>
            ))}
            <button type="submit">Save {title}</button>
          </form>
        </div>
        <div className="promotions-card">
          <div className="promotions-card-header">
            <h3>Existing Entries</h3>
          </div>
          <div className="promotions-list">
            {items.length === 0 ? <p>No entries yet.</p> : items.map((entry) => (
              <div key={entry.id} className="promotions-list-item">
                <div>
                  <strong>{entry.name}</strong>
                  <div className="promotions-muted">{entry.status || entry.trigger || "Active"}</div>
                </div>
                <div className="promotions-inline-actions">
                  <button type="button" onClick={() => persistResource(resource, "delete", { id: entry.id }, "Entry removed.")}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="promotions-panel">
      <div className="promotions-sidebar">
        <div className="promotions-sidebar-title">PROMOTIONS</div>
        {SECTION_ITEMS.map((item) => (
          <button key={item.key} type="button" className={`promotions-nav-item ${activeSection === item.key ? "is-active" : ""}`} onClick={() => setActiveSection(item.key)}>
            {item.label}
          </button>
        ))}
      </div>
      <div className="promotions-content">
        <div className="promotions-toolbar">
          <div>
            <div className="promotions-eyebrow">Marketing & Promotions Management</div>
            <h2>Admin Promotions Center</h2>
          </div>
          <div className="promotions-chip">{loading ? "Loading" : "Live"}</div>
        </div>
        {message ? <div className="promotions-message">{message}</div> : null}
        {renderSectionContent()}
      </div>
    </div>
  );
}

export default AdminPromotionsPanel;
