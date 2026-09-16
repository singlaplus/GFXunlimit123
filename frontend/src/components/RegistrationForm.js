import { useState, useEffect } from "react";
import axios from "axios";

function RegistrationForm({ accountType, onSuccess }) {
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [identityNumber, setIdentityNumber] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState("form");
  const [statusMessage, setStatusMessage] = useState("");
  const [registeredIdentifier, setRegisteredIdentifier] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resendCountdown, setResendCountdown] = useState(0);

  const apiBase = process.env.REACT_APP_API_BASE_URL || "http://localhost:5000";

  // Countdown timer effect for resend OTP button
  useEffect(() => {
    if (resendCountdown > 0) {
      const timer = setTimeout(() => setResendCountdown(resendCountdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [resendCountdown]);

  const handleRegister = async (e) => {
    if (e?.preventDefault) {
      e.preventDefault();
    }

    if (password !== confirmPassword) {
      alert("Passwords do not match.");
      return;
    }

    const identifier = email.trim() || username.trim();
    if (!identifier) {
      alert("Email or username is required.");
      return;
    }

    setSubmitting(true);
    setStatusMessage("");

    try {
      await axios.post(`${apiBase}/register`, {
        fullName,
        username,
        email,
        password,
        accountType,
        identityNumber,
      });

      setRegisteredIdentifier(identifier);
      setStep("otp");
      setStatusMessage("Registration successful. OTP sent to your email. Enter it below to verify your account.");
      setResendCountdown(60); // Start 1-minute countdown
    } catch (err) {
      console.error(err);
      alert(err.response?.data || err.message || "Registration failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!registeredIdentifier || !otp) {
      alert("Please provide the OTP sent to your email.");
      return;
    }

    setSubmitting(true);
    setStatusMessage("");

    try {
      const res = await axios.post(`${apiBase}/verify-registration-otp`, {
        identifier: registeredIdentifier,
        otp,
      });

      setStatusMessage(res.data?.message || "Account verified. You may now log in.");
      if (onSuccess) {
        onSuccess(accountType);
      }
    } catch (err) {
      console.error(err);
      alert(err.response?.data || err.message || "OTP verification failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleResendOtp = async () => {
    setSubmitting(true);
    setStatusMessage("");

    try {
      const res = await axios.post(`${apiBase}/resend-registration-otp`, {
        identifier: registeredIdentifier,
      });

      setStatusMessage(res.data?.message || "OTP resent to your email.");
      setResendCountdown(60); // Restart 1-minute countdown
    } catch (err) {
      console.error(err);
      alert(err.response?.data || err.message || "Failed to resend OTP.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        background: "white",
        padding: "30px",
        borderRadius: "15px",
      }}
    >
      <h2
        style={{
          color: "#ED2224",
          textAlign: "center",
        }}
      >
        {accountType === "contributor"
          ? "Create Contributor Account"
          : "Create Customer Account"}
      </h2>

      {statusMessage ? (
        <div
          style={{
            marginBottom: "16px",
            padding: "12px",
            background: "#f3f4f6",
            borderRadius: "10px",
            color: "#111",
          }}
        >
          {statusMessage}
        </div>
      ) : null}

      {step === "form" ? (
        <>
          <input
            type="text"
            placeholder="Full Name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            style={inputStyle}
          />

          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            style={inputStyle}
          />

          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={inputStyle}
          />

          {accountType === "contributor" && (
            <input
              type="text"
              placeholder="Government ID / Passport Number"
              value={identityNumber}
              onChange={(e) => setIdentityNumber(e.target.value)}
              style={inputStyle}
            />
          )}

          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={inputStyle}
          />

          <input
            type="password"
            placeholder="Confirm Password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            style={inputStyle}
          />

          <button
            onClick={handleRegister}
            disabled={submitting}
            style={{
              width: "100%",
              padding: "12px",
              background: "#ED2224",
              color: "white",
              border: "none",
              borderRadius: "8px",
              cursor: "pointer",
              marginTop: "15px",
              opacity: submitting ? 0.7 : 1,
            }}
          >
            Register
          </button>
        </>
      ) : (
        <>
          <p style={{ marginBottom: "12px" }}>
            Enter the OTP sent to your registered email to verify your account.
          </p>
          <input
            type="text"
            placeholder="Enter OTP"
            value={otp}
            onChange={(e) => setOtp(e.target.value)}
            style={inputStyle}
          />
          <button
            onClick={handleVerifyOtp}
            disabled={submitting}
            style={{
              width: "100%",
              padding: "12px",
              background: "#ED2224",
              color: "white",
              border: "none",
              borderRadius: "8px",
              cursor: "pointer",
              marginTop: "15px",
              opacity: submitting ? 0.7 : 1,
            }}
          >
            Verify OTP
          </button>
          
          <button
            onClick={handleResendOtp}
            disabled={submitting || resendCountdown > 0}
            style={{
              width: "100%",
              padding: "12px",
              background: resendCountdown > 0 ? "#ccc" : "#333",
              color: "white",
              border: "none",
              borderRadius: "8px",
              cursor: resendCountdown > 0 ? "not-allowed" : "pointer",
              marginTop: "10px",
              opacity: resendCountdown > 0 ? 0.6 : 1,
            }}
          >
            {resendCountdown > 0 ? `Resend OTP in ${resendCountdown}s` : "Resend OTP"}
          </button>
        </>
      )}
    </div>
  );
}

const inputStyle = {
  width: "100%",
  padding: "12px",
  marginTop: "10px",
  borderRadius: "8px",
  border: "1px solid #ccc",
  boxSizing: "border-box",
};

export default RegistrationForm;
