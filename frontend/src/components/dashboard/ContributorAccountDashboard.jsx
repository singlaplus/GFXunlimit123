import { useState } from "react";
import axios from "axios";
import { buildAuthHeaders, getEffectiveAuthToken } from "../../utils/authSession";

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || "http://localhost:5000";
const number = (value) => Number(value || 0).toLocaleString();
const unavailable = "Not available";

export default function ContributorAccountDashboard({ darkMode, profile = {}, stats = {}, reputationScore, reputationTier, onNavigate }) {
  const [showPassword, setShowPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const isDark = Boolean(darkMode);
  const token = typeof window !== "undefined" ? getEffectiveAuthToken() : null;
  const displayName = profile.full_name || profile.username || "Contributor";
  const loyalty = profile.loyalty_points != null ? Number(profile.loyalty_points) : Math.max(0, Number(stats.total_uploads || 0) - 2);
  const updatePassword = async () => {
    if (!currentPassword || !newPassword || newPassword !== confirmPassword) { setMessage("Enter all password fields and make sure the new passwords match."); return; }
    try {
      await axios.post(`${API_BASE_URL}/profile/change-password`, { currentPassword, newPassword }, { headers: buildAuthHeaders(token) });
      setMessage("Password changed successfully."); setShowPassword(false); setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
    } catch (error) { setMessage(error?.response?.data || "Unable to change password."); }
  };
  const logout = () => { if (window.confirm("Log out of your contributor account?")) { localStorage.removeItem("token"); window.location.href = "/"; } };
  const status = profile.status || "active";
  const statusText = String(status).replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

  return <section className={`account-dashboard ${isDark ? "is-dark" : ""}`}>
    <header className="account-header"><div><span className="contributor-kicker">Account management</span><h2>My Account</h2><p>Manage your contributor profile, account, security, payments and preferences.</p></div><button type="button" onClick={() => onNavigate("analytics")} className="account-outline-button">View Analytics</button></header>
    <div className="account-grid">
      <article className="account-card account-profile-card"><div className="account-profile-top"><div className="account-avatar">{displayName.charAt(0).toUpperCase()}</div><div><span className="contributor-kicker">Contributor profile</span><h3>{displayName}</h3><p>@{profile.username || "-"} · {profile.email || "-"}</p></div><span className="account-status is-positive">{statusText}</span></div><div className="account-info-grid"><span>Contributor ID <b>{profile.id || unavailable}</b></span><span>Country <b>{profile.country || unavailable}</b></span><span>Account created <b>{profile.created_at ? new Date(profile.created_at).toLocaleDateString() : unavailable}</b></span><span>Verification <b>{profile.email_verified ? "Verified" : unavailable}</b></span><span>Bio <b>{profile.bio || unavailable}</b></span></div><button type="button" className="account-primary-button" onClick={() => setMessage("Profile editing is not enabled by the current backend.")}>Edit Profile</button><span className="account-helper">Profile photo and editable personal fields are unavailable until the authenticated profile update API is enabled.</span></article>
      <article className="account-card"><div className="account-card-heading"><div><span className="contributor-kicker">Contributor status</span><h3>{reputationTier || "Contributor"}</h3></div><span className="account-status">Summary</span></div><div className="account-status-list"><span>Reputation <b>{Number(reputationScore || stats.reputation_score || 0)}</b></span><span>Level <b>{Math.max(1, Math.floor(Number(reputationScore || stats.reputation_score || 0) / 100) + 1)}</b></span><span>XP <b>{unavailable}</b></span><span>Loyalty <b>{number(loyalty)} pts</b></span><span>Achievements <b>{unavailable}</b></span></div><button type="button" className="account-link-button" onClick={() => onNavigate("analytics")}>View Analytics →</button></article>
      <article className="account-card"><div className="account-card-heading"><div><span className="contributor-kicker">Security</span><h3>Protect your account</h3></div></div><div className="account-status-list"><span>Account security <b className="account-positive">Active</b></span><span>Last login <b>{unavailable}</b></span><span>Two-factor authentication <b>{profile.otp_enabled ? "Enabled" : unavailable}</b></span><span>Active sessions <b>{unavailable}</b></span></div><button type="button" className="account-primary-button" onClick={() => { setMessage(""); setShowPassword(true); }}>Change Password</button></article>
      <article className="account-card"><div className="account-card-heading"><div><span className="contributor-kicker">Payments & tax</span><h3>Payment settings</h3></div></div><div className="account-status-list"><span>Payout method <b>{unavailable}</b></span><span>Payout status <b>{unavailable}</b></span><span>Tax status <b>{unavailable}</b></span><span>Payment account <b>{unavailable}</b></span></div><span className="account-helper">No contributor payout or tax-management API is connected to this account yet.</span></article>
      <article className="account-card"><div className="account-card-heading"><div><span className="contributor-kicker">Preferences</span><h3>Personal preferences</h3></div></div><div className="account-status-list"><span>Preferred language <b>{unavailable}</b></span><span>Preferred currency <b>{unavailable}</b></span><span>Theme <b>{darkMode ? "Dark" : "Light"}</b></span><span>Email preferences <b>{unavailable}</b></span></div></article>
      <article className="account-card"><div className="account-card-heading"><div><span className="contributor-kicker">Quick links</span><h3>Contributor workspace</h3></div></div><div className="account-quick-links"><button type="button" onClick={() => onNavigate("assets")}>My Assets</button><button type="button" onClick={() => onNavigate("upload")}>Upload Asset</button><button type="button" onClick={() => onNavigate("analytics")}>Analytics</button><button type="button" onClick={() => onNavigate("achievements")}>Achievements</button><button type="button" onClick={() => onNavigate("support")}>Support</button></div></article>
    </div>
    <article className="account-card account-actions"><div><span className="contributor-kicker">Account actions</span><h3>Sign out of this account</h3><p>Deactivation and deletion are unavailable because no authenticated self-service API exists.</p></div><button type="button" className="account-danger-button" onClick={logout}>Log Out</button></article>
    {message && <div className="account-message" role="status">{message}</div>}
    {showPassword && <div className="account-modal-backdrop" role="presentation"><div className="account-modal" role="dialog" aria-modal="true" aria-labelledby="change-password-title"><h3 id="change-password-title">Change Password</h3><input type="password" placeholder="Current password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /><input type="password" placeholder="New password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /><input type="password" placeholder="Confirm new password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /><div><button type="button" className="account-outline-button" onClick={() => setShowPassword(false)}>Cancel</button><button type="button" className="account-primary-button" onClick={updatePassword}>Save Password</button></div></div></div>}
  </section>;
}