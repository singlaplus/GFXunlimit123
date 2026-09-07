import { useEffect, useState, useRef } from "react";
import axios from "axios";
import AdminPanel from "./AdminPanel";
import { toast } from "react-toastify";
import { buildAuthHeaders, getEffectiveAuthToken } from "../utils/authSession";

function Profile({ darkMode = false }) {

  const isDarkMode = Boolean(darkMode);

  const [profile, setProfile] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [stats, setStats] = useState(null);

  useEffect(() => {

    const fetchProfile = async () => {
      try {

        const token = typeof window !== "undefined" ? getEffectiveAuthToken() : null;
        const res =
          await axios.get(
            `${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"}/profile`,
            {
              headers: buildAuthHeaders(token)
            }
          );

        setProfile(res.data);
        if (res.data.role === "admin") {
          setIsAdmin(true);
        }

      } catch (err) {

        console.error(err);

      }

    };

    const fetchStats = async () => {
      try {

        const token = typeof window !== "undefined" ? getEffectiveAuthToken() : null;

        const res =
          await axios.get(
            `${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"}/profile/stats`,
            {
              headers: buildAuthHeaders(token)
            }
          );


        setStats(res.data);

      } catch (err) {

        console.error(err);

      }

    };
    

    fetchProfile();
    fetchStats();
      // Listen for global creditsUpdated event and refetch profile
      const onCreditsUpdated = async () => {
        const updated = await fetchProfile();
        if (updated) {
          const creditsStr = `₹ ${Number(updated.credits || 0).toFixed(2)}`;
          toast.success(`Credits updated: ${creditsStr}`);
          // scroll to credits element if present
          if (creditsRef.current) {
            creditsRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }
      };

      window.addEventListener('creditsUpdated', onCreditsUpdated);
      return () => window.removeEventListener('creditsUpdated', onCreditsUpdated);

  }, []);
  const addCredits = async (credits) => {

  try {

    const token = typeof window !== "undefined" ? getEffectiveAuthToken() : null;

    await axios.put(
      `${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"}/credits/add`,
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
  const [checkoutMode, setCheckoutMode] = useState(null);
  const [checkoutAmount, setCheckoutAmount] = useState(0);
  const [googlePayId, setGooglePayId] = useState("");
  const [paymentError, setPaymentError] = useState("");

  const openGooglePayCheckout = async (credits) => {
    try {
      const token = typeof window !== "undefined" ? getEffectiveAuthToken() : null;
      const res = await axios.get(`${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"}/admin/payment-settings`, {
        headers: buildAuthHeaders(token)
      });
      const googlePaySetting = res?.data?.["google pay"] || res?.data?.["google_pay"] || res?.data?.["Google Pay"];
      if (googlePaySetting?.identifier) {
        setGooglePayId(googlePaySetting.identifier);
        setCheckoutAmount(credits);
        setCheckoutMode("googlepay");
        setPaymentError("");
      } else {
        setPaymentError("Google Pay is not configured yet.");
      }
    } catch (err) {
      console.error(err);
      setPaymentError("Unable to load Google Pay settings.");
    }
  };

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
        `${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"}/profile/change-password`,
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

  const pageStyle = {
    border: isDarkMode ? "1px solid rgba(255,255,255,0.12)" : "1px solid #dbe2ea",
    padding: "28px",
    borderRadius: "24px",
    marginBottom: "24px",
    background: isDarkMode ? "linear-gradient(135deg, #0f172a 0%, #111827 50%, #1f2937 100%)" : "#f8fafc",
    color: isDarkMode ? "#f8fafc" : "#111827",
    colorScheme: isDarkMode ? "dark" : "light",
    boxShadow: isDarkMode ? "0 20px 45px rgba(15, 23, 42, 0.45)" : "0 12px 30px rgba(15, 23, 42, 0.08)",
    position: "relative",
    overflow: "hidden"
  };

  const heroStyle = {
    background: isDarkMode ? "linear-gradient(135deg, rgba(59,130,246,0.2), rgba(168,85,247,0.16))" : "linear-gradient(135deg, #eaf2ff, #f4efff)",
    border: isDarkMode ? "1px solid rgba(255,255,255,0.12)" : "1px solid #cbd5e1",
    borderRadius: "18px",
    padding: "20px 22px",
    marginBottom: "18px"
  };

  const cardStyle = {
    background: isDarkMode ? "rgba(255,255,255,0.04)" : "#ffffff",
    border: isDarkMode ? "1px solid rgba(255,255,255,0.09)" : "1px solid #dbe2ea",
    borderRadius: "16px",
    padding: "16px",
    boxShadow: isDarkMode ? "inset 0 1px 0 rgba(255,255,255,0.04)" : "0 6px 18px rgba(15, 23, 42, 0.06)"
  };

  const statCardStyle = {
    background: isDarkMode ? "linear-gradient(145deg, rgba(255,255,255,0.07), rgba(255,255,255,0.03))" : "#ffffff",
    padding: "16px",
    borderRadius: "14px",
    textAlign: "center",
    border: isDarkMode ? "1px solid rgba(255,255,255,0.08)" : "1px solid #dbe2ea",
    boxShadow: isDarkMode ? "0 10px 25px rgba(2, 6, 23, 0.22)" : "0 8px 20px rgba(15, 23, 42, 0.06)",
    color: isDarkMode ? "#f8fafc" : "#111827"
  };

  const buttonStyle = {
    background: "linear-gradient(135deg, #3b82f6, #8b5cf6)",
    color: "white",
    border: "none",
    padding: "10px 14px",
    borderRadius: "999px",
    cursor: "pointer",
    fontWeight: 600,
    boxShadow: "0 10px 20px rgba(59,130,246,0.25)"
  };

  const secondaryButtonStyle = {
    background: isDarkMode ? "rgba(255,255,255,0.08)" : "#ffffff",
    color: isDarkMode ? "#f8fafc" : "#111827",
    border: isDarkMode ? "1px solid rgba(255,255,255,0.12)" : "1px solid #cbd5e1",
    padding: "10px 14px",
    borderRadius: "999px",
    cursor: "pointer",
    fontWeight: 600
  };

  if (!profile) {
    return <p>Loading...</p>;
  }

  return (
    <div style={pageStyle}>
      <div style={heroStyle}>
        <h2 style={{ margin: 0, fontSize: "1.6rem" }}>User Profile</h2>
        <p style={{ margin: "6px 0 0", color: isDarkMode ? "#cbd5e1" : "#475569" }}>
          Your account overview, contributor performance, and credit balance in one place.
        </p>
      </div>

      <div style={{ ...cardStyle, marginBottom: "16px" }}>
        <p style={{ margin: "0 0 8px", color: isDarkMode ? "#cbd5e1" : "#475569" }}>
          <strong style={{ color: isDarkMode ? "#f8fafc" : "#111827" }}>ID:</strong>{" "}
          {profile.id}
        </p>

        <p style={{ margin: "0 0 8px", color: isDarkMode ? "#cbd5e1" : "#475569" }}>
          <strong style={{ color: isDarkMode ? "#f8fafc" : "#111827" }}>Username:</strong>{" "}
          {profile.username}
        </p>

        <p style={{ margin: "0 0 8px", color: isDarkMode ? "#cbd5e1" : "#475569" }}>
          <strong style={{ color: isDarkMode ? "#f8fafc" : "#111827" }}>Email:</strong>{" "}
          {profile.email}
        </p>

        <p style={{ margin: "0 0 8px", color: isDarkMode ? "#cbd5e1" : "#475569" }}>
          <strong style={{ color: isDarkMode ? "#f8fafc" : "#111827" }}>Role:</strong>{" "}
          {profile.role}
        </p>

        <p ref={creditsRef} style={{ margin: 0, color: isDarkMode ? "#cbd5e1" : "#475569" }}>
          <strong style={{ color: isDarkMode ? "#f8fafc" : "#111827" }}>Credits:</strong>{" "}
          ₹ {Number(profile.credits || 0).toFixed(2)}
        </p>
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: "10px", flexWrap: "wrap" }}>
        <button onClick={() => setShowChangeModal(true)} style={buttonStyle}>
          Change Password
        </button>

        {isAdmin && (
          <button
            onClick={() => window.location.href = "/asdfghjkl_a_qwertyuiop_d_zxcvbnm_m_qwertyuiop_i_asdfghjkl_n_zxcvbnm?tab=controls"}
            style={{ ...buttonStyle, background: "linear-gradient(135deg, #f59e0b, #fb923c)" }}
          >
            👑 Admin Panel
          </button>
        )}
      </div>

      {showChangeModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(2,6,23,0.72)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000, padding: "16px" }}>
          <div style={{ background: "linear-gradient(145deg, #111827, #1f2937)", padding: 22, borderRadius: 16, width: 420, color: "white", border: "1px solid rgba(255,255,255,0.12)", boxShadow: "0 20px 45px rgba(0,0,0,0.3)" }}>
            <h3 style={{ marginTop: 0 }}>Change Password</h3>
            <div style={{ display: "grid", gap: 10, marginTop: 8 }}>
              <input type="password" placeholder="Current password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.06)", color: "white" }} />
              <input type="password" placeholder="New password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.06)", color: "white" }} />
              <input type="password" placeholder="Confirm new password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.06)", color: "white" }} />
            </div>
            <div style={{ marginTop: 14, display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setShowChangeModal(false)} style={{ ...secondaryButtonStyle, padding: "8px 12px" }}>Cancel</button>
              <button onClick={submitChangePassword} style={{ ...buttonStyle, padding: "8px 12px" }}>Save</button>
            </div>
          </div>
        </div>
      )}

      {profile.role === "admin" && (
        <AdminPanel />
      )}

      {stats && profile.role === "contributor" && (
        <>
          <h3 style={{ marginTop: "24px", marginBottom: "10px" }}>
            {profile.role === "admin"
              ? "👑 Admin Dashboard"
              : "📊 Contributor Dashboard"}
          </h3>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: "12px",
              marginTop: "12px",
              marginBottom: "18px"
            }}
          >
            <div style={statCardStyle}>📊 Approved<h3 style={{ margin: "6px 0 0" }}>{stats.approved_images}</h3></div>
            <div style={statCardStyle}>⏳ Pending<h3 style={{ margin: "6px 0 0" }}>{stats.pending_images}</h3></div>
            <div style={statCardStyle}>❌ Rejected<h3 style={{ margin: "6px 0 0" }}>{stats.rejected_images}</h3></div>
            <div style={statCardStyle}>🔥 Best Downloads<h3 style={{ margin: "6px 0 0" }}>{stats.top_downloads || 0}</h3></div>
            <div style={statCardStyle}>👁 Best Views<h3 style={{ margin: "6px 0 0" }}>{stats.top_views || 0}</h3></div>
            <div style={statCardStyle}>❤️ Best Likes<h3 style={{ margin: "6px 0 0" }}>{stats.top_likes || 0}</h3></div>
          </div>

          <h3 style={{ marginBottom: "10px" }}>📈 Statistics</h3>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
              gap: "12px",
              marginTop: "8px"
            }}
          >
            <div style={statCardStyle}>📸 Uploads<h3 style={{ margin: "6px 0 0" }}>{stats.total_uploads}</h3></div>
            <div style={statCardStyle}>❤️ Likes<h3 style={{ margin: "6px 0 0" }}>{stats.total_likes}</h3></div>
            <div style={statCardStyle}>👁 Views<h3 style={{ margin: "6px 0 0" }}>{stats.total_views}</h3></div>
            <div style={statCardStyle}>⬇ Downloads<h3 style={{ margin: "6px 0 0" }}>{stats.total_downloads}</h3></div>
            <div style={statCardStyle}>💰 Earnings<h3 style={{ margin: "6px 0 0" }}>₹ {Number(stats.total_earnings || 0).toFixed(2)}</h3></div>
          </div>

          <div style={{ marginTop: "22px" }}>
            <div style={{ ...cardStyle, borderColor: "rgba(74, 222, 128, 0.35)" }}>
              <h3 style={{ marginTop: 0, marginBottom: "8px" }}>💰 Earnings Dashboard</h3>
              <p style={{ margin: "0 0 8px", color: isDarkMode ? "#cbd5e1" : "#475569" }}>
                Total Earnings: <strong style={{ color: isDarkMode ? "#f8fafc" : "#111827" }}>₹ {Number(stats.total_earnings || 0).toFixed(2)}</strong>
              </p>
              <p style={{ margin: "0 0 8px", color: isDarkMode ? "#cbd5e1" : "#475569" }}>
                Total Downloads: {stats.total_downloads}
              </p>
              <p style={{ margin: 0, color: isDarkMode ? "#cbd5e1" : "#475569" }}>
                Rate Per Download: ₹ 0.25
              </p>
            </div>

            <h3 style={{ marginBottom: "10px" }}>Buy Credits</h3>
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              <button onClick={() => openGooglePayCheckout(10)} style={buttonStyle}>₹99 → 10 Credits</button>
              <button onClick={() => openGooglePayCheckout(50)} style={buttonStyle}>₹399 → 50 Credits</button>
              <button onClick={() => openGooglePayCheckout(100)} style={buttonStyle}>₹699 → 100 Credits</button>
            </div>

            {checkoutMode === "googlepay" ? (
              <div style={{ marginTop: "16px", padding: "16px", borderRadius: "14px", background: isDarkMode ? "rgba(255,255,255,0.05)" : "#ffffff", border: "1px solid rgba(74, 222, 128, 0.35)" }}>
                <h4 style={{ marginTop: 0 }}>Google Pay Checkout</h4>
                <p style={{ marginBottom: "8px", color: isDarkMode ? "#cbd5e1" : "#475569" }}>Pay ₹{checkoutAmount === 10 ? 99 : checkoutAmount === 50 ? 399 : 699} for {checkoutAmount} credits.</p>
                <p style={{ marginBottom: "8px", color: isDarkMode ? "#cbd5e1" : "#475569" }}>Scan the QR code or use this ID: <strong>{googlePayId}</strong></p>
                <div style={{ width: 180, height: 180, borderRadius: 10, background: "white", display: "flex", alignItems: "center", justifyContent: "center", color: "#111", fontWeight: 700 }}>
                  QR for {googlePayId || "Google Pay"}
                </div>
                <button onClick={() => { setCheckoutMode(null); setPaymentError(""); }} style={{ ...secondaryButtonStyle, marginTop: "12px" }}>Close</button>
              </div>
            ) : null}

            {paymentError ? <p style={{ color: "#ff8a80", marginTop: "12px" }}>{paymentError}</p> : null}
          </div>
        </>
      )}
    </div>
  );
}

export default Profile;