import { useState, useEffect } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { startFaviconAnimation, stopFaviconAnimation } from "../utils/faviconAnimation";
import { dispatchAuthBusyStart, dispatchAuthBusyEnd } from "../utils/authBusyEvents";

function Login({ onSuccess, onClose }) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState("login");
  const [statusMessage, setStatusMessage] = useState("");
  const [forgotMode, setForgotMode] = useState("idle");
  const [forgotIdentifier, setForgotIdentifier] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [forgotOtp, setForgotOtp] = useState("");
  const [forgotStatus, setForgotStatus] = useState("");
  const [resendCountdown, setResendCountdown] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const apiBase = process.env.REACT_APP_API_BASE_URL || "http://localhost:5000";

  const clearOtpLogin = () => {
    setOtp("");
    setStep("login");
    setStatusMessage("");
  };

  useEffect(() => {
    if (resendCountdown <= 0) return undefined;
    const timer = setTimeout(() => setResendCountdown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCountdown]);

  const resetForgotFlow = () => {
    setForgotMode("idle");
    setForgotIdentifier("");
    setNewPassword("");
    setConfirmPassword("");
    setForgotOtp("");
    setForgotStatus("");
    setResendCountdown(0);
  };

  const handleResendForgotOtp = async () => {
    if (!forgotIdentifier) {
      toast.error("Email or username is required for password recovery.");
      return;
    }

    setSubmitting(true);
    setForgotStatus("");

    try {
      await axios.post(`${apiBase}/forgot-password/resend-otp`, {
        identifier: forgotIdentifier,
      });
      setForgotStatus("A new recovery OTP has been sent to your registered email.");
      setResendCountdown(60);
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data || err.message || "Failed to resend OTP.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogin = async (e) => {
    if (e?.preventDefault) {
      e.preventDefault();
    }
    if (e?.stopPropagation) {
      e.stopPropagation();
    }

    if (!identifier || !password) {
      toast.error("Email/username and password are required.");
      return;
    }

    startFaviconAnimation();
    dispatchAuthBusyStart("login");
    setSubmitting(true);
    setStatusMessage("");

    try {
      const payload = { identifier, password };
      if (step === "otp") {
        payload.otp = otp;
      }

      const res = await axios.post(`${apiBase}/login`, payload);

      if (res.status === 202) {
        setStep("otp");
        setStatusMessage(res.data?.message || "OTP sent to registered email. Please enter it to complete login.");
        return;
      }

      localStorage.setItem("token", res.data.token);
      localStorage.setItem("username", res.data.username);
      localStorage.setItem("userId", res.data.userId);
      if (res.data.email) {
        localStorage.setItem("email", res.data.email);
      }
      if (res.data.fullName) {
        localStorage.setItem("fullName", res.data.fullName);
      }
      if (res.data.role) {
        localStorage.setItem("userRole", res.data.role);
      }
      localStorage.setItem("userPermissions", JSON.stringify(res.data.custom_permissions || {}));

      window.dispatchEvent(new Event("auth-changed"));
      toast.success("Login successful");
      clearOtpLogin();
      resetForgotFlow();

      if (onSuccess) {
        onSuccess();
      } else if (onClose) {
        onClose();
      }
    } catch (err) {
      console.error(err);
      const responseMessage = typeof err.response?.data === "string"
        ? err.response.data
        : err.response?.data?.message;
      toast.error(responseMessage || err.message || "Login failed");
    } finally {
      stopFaviconAnimation();
      dispatchAuthBusyEnd();
      setSubmitting(false);
    }
  };

  const handleSendForgotOtp = async () => {
    if (!forgotIdentifier) {
      toast.error("Email or username is required for password recovery.");
      return;
    }

    setSubmitting(true);
    setForgotStatus("");

    try {
      await axios.post(`${apiBase}/forgot-password`, { identifier: forgotIdentifier });
      setForgotMode("otpVerify");
      setForgotStatus("Recovery OTP sent to your registered email. Enter it below to continue.");
      setResendCountdown(60);
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data || err.message || "Failed to send recovery OTP.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifyForgotOtp = async () => {
    if (!forgotIdentifier || !forgotOtp) {
      toast.error("Identifier and recovery OTP are required.");
      return;
    }

    setSubmitting(true);
    setForgotStatus("");

    try {
      await axios.post(`${apiBase}/forgot-password/verify-otp`, {
        identifier: forgotIdentifier,
        otp: forgotOtp,
      });
      setForgotMode("passwordSet");
      setForgotStatus("OTP verified. Please set your new password.");
      setResendCountdown(0);
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data || err.message || "OTP verification failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleResetForgotPassword = async () => {
    if (!forgotIdentifier || !forgotOtp) {
      toast.error("Identifier and recovery OTP are required.");
      return;
    }

    if (!newPassword || !confirmPassword) {
      toast.error("Please enter and confirm your new password.");
      return;
    }

    if (newPassword !== confirmPassword) {
      toast.error("New password and confirm password do not match.");
      return;
    }

    setSubmitting(true);
    setForgotStatus("");

    try {
      await axios.post(`${apiBase}/forgot-password/reset-password`, {
        identifier: forgotIdentifier,
        otp: forgotOtp,
        newPassword,
        confirmPassword,
      });
      setForgotMode("done");
      setForgotStatus("Password reset successful. Please log in with your new password.");
      setPassword("");
      setOtp("");
      setStep("login");
      setForgotIdentifier("");
      setForgotOtp("");
      setNewPassword("");
      setConfirmPassword("");
      setResendCountdown(0);
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data || err.message || "Password reset failed.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        border: "1px solid #4b5563",
        background: "#111827",
        padding: "22px",
        borderRadius: "16px",
        marginBottom: "20px",
        color: "#f9fafb",
      }}
    >
      <h2 style={{ marginBottom: "18px" }}>Login</h2>

      {statusMessage ? (
        <div
          style={{
            marginBottom: "12px",
            padding: "12px",
            borderRadius: "8px",
            background: "#f3f4f6",
            color: "#111",
          }}
        >
          {statusMessage}
        </div>
      ) : null}

      <form
        onSubmit={handleLogin}
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.target.tagName !== "BUTTON") {
            e.preventDefault();
            e.stopPropagation();
            handleLogin(e);
          }
        }}
      >
        <input
          type="text"
          placeholder="Email or Username"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          style={{
            width: "100%",
            padding: "10px",
            marginBottom: "10px",
          }}
        />

        <div style={{ position: "relative", marginBottom: "10px" }}>
          <input
            type={showPassword ? "text" : "password"}
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{
              width: "100%",
              padding: "10px 44px 10px 10px",
              boxSizing: "border-box",
            }}
          />
          <button
            type="button"
            aria-label={showPassword ? "Hide password" : "Show password"}
            onClick={() => setShowPassword((visible) => !visible)}
            style={{
              position: "absolute",
              top: 0,
              right: 0,
              height: "100%",
              width: "40px",
              padding: 0,
              border: "none",
              background: "transparent",
              color: "#4b5563",
              cursor: "pointer",
            }}
            title={showPassword ? "Hide password" : "Show password"}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              {showPassword ? (
                <>
                  <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
                  <circle cx="12" cy="12" r="3" />
                </>
              ) : (
                <>
                  <path d="M3 3l18 18" />
                  <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
                  <path d="M9.9 4.2A10.8 10.8 0 0 1 12 4c6.5 0 10 8 10 8a18.3 18.3 0 0 1-3.1 4.4" />
                  <path d="M6.1 6.1C3.6 8 2 12 2 12s3.5 8 10 8a10.8 10.8 0 0 0 2.1-.2" />
                </>
              )}
            </svg>
          </button>
        </div>

        {step === "otp" && (
          <input
            type="text"
            placeholder="Enter OTP"
            value={otp}
            onChange={(e) => setOtp(e.target.value)}
            style={{
              width: "100%",
              padding: "10px",
              marginBottom: "10px",
            }}
          />
        )}

        <button
          type="submit"
          disabled={submitting}
          style={{
            padding: "10px 20px",
            background: "#111",
            color: "white",
            border: "none",
            borderRadius: "5px",
            cursor: "pointer",
            opacity: submitting ? 0.7 : 1,
          }}
        >
          {step === "otp" ? "Verify OTP & Login" : "Login"}
        </button>

        {step === "otp" && (
          <button
            type="button"
            onClick={clearOtpLogin}
            disabled={submitting}
            style={{
              marginLeft: "10px",
              padding: "10px 20px",
              background: "#555",
              color: "white",
              border: "none",
              borderRadius: "5px",
              cursor: "pointer",
              opacity: submitting ? 0.7 : 1,
            }}
          >
            Back to login
          </button>
        )}
      </form>

      <div style={{ marginTop: "20px" }}>
        {forgotMode === "idle" ? (
          <button
            type="button"
            onClick={() => setForgotMode("request")}
            style={{
              background: "transparent",
              border: "none",
              color: "#fff",
              textDecoration: "underline",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            Forgot password?
          </button>
        ) : (
          <div
            style={{
              marginTop: "16px",
              padding: "16px",
              background: "#f9fafb",
              borderRadius: "10px",
            }}
          >
            {forgotStatus ? (
              <div
                style={{
                  marginBottom: "12px",
                  color: "#111",
                }}
              >
                {forgotStatus}
              </div>
            ) : null}

            <input
              type="text"
              placeholder="Email or Username"
              value={forgotIdentifier}
              onChange={(e) => setForgotIdentifier(e.target.value)}
              disabled={forgotMode === "otpVerify" || forgotMode === "passwordSet" || forgotMode === "done"}
              style={{
                width: "100%",
                padding: "10px",
                marginBottom: "10px",
                opacity: forgotMode === "otpVerify" || forgotMode === "passwordSet" || forgotMode === "done" ? 0.7 : 1,
              }}
            />

            {forgotMode === "request" && (
              <button
                type="button"
                disabled={submitting}
                onClick={handleSendForgotOtp}
                style={{
                  width: "100%",
                  padding: "10px 20px",
                  background: "#111",
                  color: "white",
                  border: "none",
                  borderRadius: "5px",
                  cursor: "pointer",
                  opacity: submitting ? 0.7 : 1,
                }}
              >
                Send recovery OTP
              </button>
            )}

            {forgotMode === "otpVerify" && (
              <>
                <input
                  type="text"
                  placeholder="Recovery OTP"
                  value={forgotOtp}
                  onChange={(e) => setForgotOtp(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "10px",
                    marginBottom: "10px",
                  }}
                />

                <button
                  type="button"
                  disabled={submitting}
                  onClick={handleVerifyForgotOtp}
                  style={{
                    width: "100%",
                    padding: "10px 20px",
                    background: "#111",
                    color: "white",
                    border: "none",
                    borderRadius: "5px",
                    cursor: "pointer",
                    opacity: submitting ? 0.7 : 1,
                  }}
                >
                  Verify OTP
                </button>

                <button
                  type="button"
                  disabled={submitting || resendCountdown > 0}
                  onClick={handleResendForgotOtp}
                  style={{
                    marginTop: "10px",
                    width: "100%",
                    padding: "10px 20px",
                    background: resendCountdown > 0 ? "#d1d5db" : "#374151",
                    color: "white",
                    border: "none",
                    borderRadius: "5px",
                    cursor: resendCountdown > 0 ? "not-allowed" : "pointer",
                    opacity: submitting ? 0.7 : 1,
                  }}
                >
                  {resendCountdown > 0 ? `Resend OTP in ${resendCountdown}s` : "Resend OTP"}
                </button>
              </>
            )}

            {forgotMode === "passwordSet" && (
              <>
                <input
                  type="password"
                  placeholder="New password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "10px",
                    marginBottom: "10px",
                  }}
                />

                <input
                  type="password"
                  placeholder="Confirm new password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "10px",
                    marginBottom: "10px",
                  }}
                />

                <button
                  type="button"
                  disabled={submitting}
                  onClick={handleResetForgotPassword}
                  style={{
                    width: "100%",
                    padding: "10px 20px",
                    background: "#111",
                    color: "white",
                    border: "none",
                    borderRadius: "5px",
                    cursor: "pointer",
                    opacity: submitting ? 0.7 : 1,
                  }}
                >
                  Set New Password
                </button>
              </>
            )}

            {forgotMode === "done" && (
              <button
                type="button"
                onClick={() => {
                  resetForgotFlow();
                  setStatusMessage("Password recovery complete. Please log in with your new password.");
                }}
                style={{
                  marginTop: "10px",
                  width: "100%",
                  padding: "10px 20px",
                  background: "#111",
                  color: "white",
                  border: "none",
                  borderRadius: "5px",
                  cursor: "pointer",
                }}
              >
                Back to login
              </button>
            )}

            <button
              type="button"
              onClick={resetForgotFlow}
              style={{
                marginTop: "10px",
                width: "100%",
                padding: "10px 20px",
                background: "transparent",
                color: "#111",
                border: "1px solid #ccc",
                borderRadius: "5px",
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default Login;
