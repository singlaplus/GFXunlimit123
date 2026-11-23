import { API_BASE_URL } from "../utils/apiBaseUrl.js";
import { useEffect, useState, useRef } from "react";
import axios from "axios";
import AdminPanel from "./AdminPanel";
import { toast } from "react-toastify";
import { buildAuthHeaders, getEffectiveAuthToken } from "../utils/authSession";
import { useStartupReadiness } from "../startup/StartupReadinessProvider";
import "./Profile.css";

function Profile({ darkMode = false }) {

  const isDarkMode = Boolean(darkMode);

  const [profile, setProfile] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [stats, setStats] = useState(null);
  const { reportResource, retryKey, routeId } = useStartupReadiness();

  useEffect(() => {
    let active = true;

    const fetchProfile = async (throwOnError = true) => {
      try {
        const token = typeof window !== "undefined" ? getEffectiveAuthToken() : null;
        const res =
          await axios.get(
            `${API_BASE_URL}/profile`,
            {
              headers: buildAuthHeaders(token)
            }
          );

        if (active) {
          setProfile(res.data);
          setIsAdmin(res.data.role === "admin");
        }
        return res.data;
      } catch (err) {
        console.error(err);
        if (throwOnError) throw err;
        return null;
      }
    };

    const fetchStats = async () => {
      try {
        const token = typeof window !== "undefined" ? getEffectiveAuthToken() : null;
        const res =
          await axios.get(
            `${API_BASE_URL}/profile/stats`,
            {
              headers: buildAuthHeaders(token)
            }
          );

        const requiredFields = [
          "total_uploads",
          "approved_images",
          "pending_images",
          "rejected_images",
          "total_likes",
          "total_views",
          "total_downloads",
          "total_earnings",
          "top_downloads",
          "top_views",
          "top_likes",
        ];
        if (!res.data || typeof res.data !== "object" || Array.isArray(res.data) ||
            requiredFields.some((field) => !(field in res.data))) {
          throw new Error("The profile statistics response was invalid.");
        }

        if (active) setStats(res.data);
        return res.data;
      } catch (err) {
        console.error(err);
        throw err;
      }
    };

    const loadProfile = async () => {
      reportResource("profile", "loading", "", routeId);
      const [profileResult, statsResult] = await Promise.allSettled([
        fetchProfile(),
        fetchStats(),
      ]);
      if (!active) return;
      if (profileResult.status === "rejected") throw profileResult.reason;
      const loadedProfile = profileResult.value;
      const requiredProfileFields = ["id", "username", "email", "role", "credits"];
      if (!loadedProfile || typeof loadedProfile !== "object" ||
          requiredProfileFields.some((field) => !(field in loadedProfile)) ||
          typeof loadedProfile.role !== "string") {
        throw new Error("The profile response was invalid.");
      }
      if (loadedProfile.role === "contributor" && statsResult.status === "rejected") {
        throw statsResult.reason;
      }
      reportResource("profile", "ready", "", routeId);
    };

    loadProfile().catch((err) => {
      if (!active) return;
      console.error("Failed to load profile readiness data", err);
      reportResource("profile", "error", "Unable to load your profile. Please retry.", routeId);
    });

    const onCreditsUpdated = async () => {
      const updated = await fetchProfile(false);
      if (updated) {
        const creditsStr = `₹ ${Number(updated.credits || 0).toFixed(2)}`;
        toast.success(`Credits updated: ${creditsStr}`);
        if (creditsRef.current) {
          creditsRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
    };

    window.addEventListener('creditsUpdated', onCreditsUpdated);
    return () => {
      active = false;
      window.removeEventListener('creditsUpdated', onCreditsUpdated);
    };

  }, [reportResource, retryKey, routeId]);
  const addCredits = async (credits) => {

  try {

    const token = typeof window !== "undefined" ? getEffectiveAuthToken() : null;

    await axios.put(
      `${API_BASE_URL}/credits/add`,
      {
        credits
      },
      {
        headers: buildAuthHeaders(token)
      }
    );

    toast.success(
      `${credits} credits added successfully`
    );
    window.dispatchEvent(new Event("creditsUpdated"));

  } catch (err) {

    console.error(err);

    toast.error("Failed to add credits");

  }

};

  const creditsRef = useRef(null);

  const [showChangeModal, setShowChangeModal] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const submitChangePassword = async () => {
    if (!currentPassword || !newPassword) {
      toast.error("Please fill all fields");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("New password and confirmation do not match");
      return;
    }
    try {
      const token = typeof window !== "undefined" ? getEffectiveAuthToken() : null;
      await axios.post(
        `${API_BASE_URL}/profile/change-password`,
        {
          currentPassword,
          newPassword,
        },
        {
          headers: buildAuthHeaders(token),
        }
      );
      toast.success("Password changed successfully");
      setShowChangeModal(false);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      console.error(err);
      const msg = err?.response?.data || "Failed to change password";
      toast.error(msg);
    }
  };

  if (!profile) {
    return <p>Loading...</p>;
  }

  return (
    <div className={`profile-page ${isDarkMode ? "profile-page--dark" : ""}`}>
      <header className="profile-hero">
        <div>
          <span className="profile-eyebrow">Account overview</span>
          <h2>User Profile</h2>
          <p>
            Your account overview, contributor performance, and credit balance in one place.
          </p>
        </div>
        <div className="profile-hero-badge" aria-hidden="true">MY ACCOUNT</div>
      </header>

      <section className="profile-account-card" aria-label="Account details">
        <div className="profile-account-heading">
          <div className="profile-avatar" aria-hidden="true">
            {typeof profile.username === "string" && profile.username
              ? profile.username.charAt(0).toUpperCase()
              : "U"}
          </div>
          <div>
            <span className="profile-eyebrow">Personal details</span>
            <h3>{profile.username}</h3>
          </div>
          <span className="profile-role">{profile.role}</span>
        </div>
        <div className="profile-info-grid">
          <div className="profile-info-row">
            <strong>ID:</strong>
            <span>{profile.id}</span>
          </div>
          <div className="profile-info-row">
            <strong>Username:</strong>
            <span>{profile.username}</span>
          </div>
          <div className="profile-info-row">
            <strong>Email:</strong>
            <span>{profile.email}</span>
          </div>
          <div className="profile-info-row">
            <strong>Role:</strong>
            <span>{profile.role}</span>
          </div>
          <div ref={creditsRef} className="profile-info-row profile-credits-row">
            <strong>Credits:</strong>
            <span>₹ {Number(profile.credits || 0).toFixed(2)}</span>
          </div>
        </div>
      </section>

      <div className="profile-actions">
        <button className="profile-button" onClick={() => setShowChangeModal(true)}>
          Change Password
        </button>

        {isAdmin && (
          <button
            onClick={() => window.location.href = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm?tab=controls"}
            className="profile-button profile-button--admin"
          >
            👑 Admin Panel
          </button>
        )}
      </div>

      {showChangeModal && (
        <div className="profile-modal-backdrop">
          <div className="profile-modal">
            <span className="profile-eyebrow">Security</span>
            <h3>Change Password</h3>
            <div className="profile-modal-fields">
              <input type="password" placeholder="Current password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
              <input type="password" placeholder="New password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
              <input type="password" placeholder="Confirm new password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
            </div>
            <div className="profile-modal-actions">
              <button className="profile-button profile-button--secondary" onClick={() => setShowChangeModal(false)}>Cancel</button>
              <button className="profile-button" onClick={submitChangePassword}>Save</button>
            </div>
          </div>
        </div>
      )}

      {profile.role === "admin" && (
        <AdminPanel />
      )}

      {stats && profile.role === "contributor" && (
        <>
          <h3 className="profile-section-title">
            {profile.role === "admin"
              ? "👑 Admin Dashboard"
              : "📊 Contributor Dashboard"}
          </h3>
          <div className="profile-stats-grid profile-stats-grid--dashboard">
            <div className="profile-stat-card">
              <span>📊 Approved</span>
              <strong>{stats.approved_images}</strong>
            </div>
            <div className="profile-stat-card">
              <span>⏳ Pending</span>
              <strong>{stats.pending_images}</strong>
            </div>
            <div className="profile-stat-card">
              <span>❌ Rejected</span>
              <strong>{stats.rejected_images}</strong>
            </div>
            <div className="profile-stat-card">
              <span>🔥 Best Downloads</span>
              <strong>{stats.top_downloads || 0}</strong>
            </div>
            <div className="profile-stat-card">
              <span>👁 Best Views</span>
              <strong>{stats.top_views || 0}</strong>
            </div>
            <div className="profile-stat-card">
              <span>❤️ Best Likes</span>
              <strong>{stats.top_likes || 0}</strong>
            </div>
          </div>

          <h3 className="profile-section-title profile-section-title--secondary">📈 Statistics</h3>
          <div className="profile-stats-grid profile-stats-grid--summary">
            <div className="profile-stat-card">
              <span>📸 Uploads</span>
              <strong>{stats.total_uploads}</strong>
            </div>
            <div className="profile-stat-card">
              <span>❤️ Likes</span>
              <strong>{stats.total_likes}</strong>
            </div>
            <div className="profile-stat-card">
              <span>👁 Views</span>
              <strong>{stats.total_views}</strong>
            </div>
            <div className="profile-stat-card">
              <span>⬇ Downloads</span>
              <strong>{stats.total_downloads}</strong>
            </div>
            <div className="profile-stat-card">
              <span>💰 Earnings</span>
              <strong>₹ {Number(stats.total_earnings || 0).toFixed(2)}</strong>
            </div>
          </div>

          <section className="profile-earnings-card">
            <h3>💰 Earnings Dashboard</h3>
            <p>
              Total Earnings: <strong>₹ {Number(stats.total_earnings || 0).toFixed(2)}</strong>
            </p>
            <p>Total Downloads: {stats.total_downloads}</p>
            <p>Rate Per Download: ₹ 0.25</p>
          </section>
        </>
      )}
    </div>
  );
}

export default Profile;