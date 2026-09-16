import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import axios from "axios";
import { getEffectiveAuthToken } from "../utils/authSession";
import "./SubscriptionCheckoutPage.css";

const API_BASE_URL =
  process.env.REACT_APP_API_BASE_URL || "http://localhost:5000";
const CREDITS_PAYMENT_METHOD = "GFX's Credits";

export default function SubscriptionCheckoutPage({ darkMode = false }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [plan, setPlan] = useState(null);
  const [duration, setDuration] = useState(searchParams.get("duration") || "");
  const [currency, setCurrency] = useState(searchParams.get("currency") || "");
  const [paymentMethods, setPaymentMethods] = useState([]);
  const [paymentMethod, setPaymentMethod] = useState("");
  const [creditBalance, setCreditBalance] = useState(0);
  const [billing, setBilling] = useState({
    fullName: localStorage.getItem("fullName") || "",
    email: localStorage.getItem("email") || "",
  });
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [couponCode, setCouponCode] = useState("");
  const [coupon, setCoupon] = useState(null);
  const [couponMessage, setCouponMessage] = useState("");

  useEffect(() => {
    const loadCheckout = async () => {
      try {
        const token = getEffectiveAuthToken();
        const [plansResponse, settingsResponse] = await Promise.all([
          axios.get(`${API_BASE_URL}/subscription-plans`),
          axios.get(`${API_BASE_URL}/payment-settings`),
        ]);
        const selectedPlan = (plansResponse.data || []).find(
          (item) => String(item.id) === searchParams.get("plan"),
        );
        if (!selectedPlan) {
          setMessage("This subscription plan is no longer available.");
          return;
        }
        setPlan(selectedPlan);
        const availableCurrencies = Object.keys(
          selectedPlan.pricing?.currency_prices || {},
        );
        const nextCurrency =
          currency ||
          availableCurrencies[0] ||
          selectedPlan.pricing?.currency ||
          "USD";
        setCurrency(nextCurrency);
        const durations = Object.keys(
          selectedPlan.plan_settings?.durations || {},
        );
        const nextDuration =
          duration ||
          durations[0] ||
          selectedPlan.plan_settings?.duration ||
          "monthly";
        setDuration(nextDuration);
        const methods = [
          CREDITS_PAYMENT_METHOD,
          ...(settingsResponse.data?.enabledGateways || []),
        ];
        setPaymentMethods([...new Set(methods)]);
        setPaymentMethod(methods[0] || "");
        if (token) {
          const profile = await axios.get(`${API_BASE_URL}/profile`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          setBilling((current) => ({
            fullName:
              profile.data?.full_name ||
              profile.data?.user?.full_name ||
              current.fullName,
            email:
              profile.data?.email || profile.data?.user?.email || current.email,
          }));
          setCreditBalance(
            Number(profile.data?.credits ?? profile.data?.user?.credits ?? 0),
          );
        }
      } catch (error) {
        console.error(error);
        setMessage(
          error.response?.data?.error ||
            "Unable to load subscription checkout.",
        );
      } finally {
        setLoading(false);
      }
    };
    loadCheckout();
  }, [searchParams, duration]);

  const basePrices = plan?.pricing?.prices || {};
  const prices =
    plan?.pricing?.currency_prices?.[currency] ||
    (currency === (plan?.pricing?.currency || "USD") ? basePrices : {});
  const amount = Number(prices[duration] ?? 0);
  const save = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setMessage("");
    try {
      const token = getEffectiveAuthToken();
      const response = await axios.post(
        `${API_BASE_URL}/checkout/subscribe`,
        {
          planId: plan.id,
          duration,
          currency,
          paymentMethod,
          billing,
          couponCode: coupon?.code || couponCode.trim(),
        },
        { headers: token ? { Authorization: `Bearer ${token}` } : {} },
      );
      navigate(`/orders/${response.data.orderId}`);
    } catch (error) {
      setMessage(
        error.response?.data?.error ||
          "Unable to complete subscription purchase.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const pageColor = darkMode ? "#f8fafc" : "#0f172a";
  const surface = darkMode ? "#111827" : "#ffffff";
  const discount = coupon
    ? Math.min(
        amount,
        coupon.discount_type === "percentage"
          ? (amount * Number(coupon.discount_value || 0)) / 100
          : Number(coupon.discount_value || 0),
      )
    : 0;
  const total = Math.max(0, amount - discount);
  const applyCoupon = async () => {
    if (!couponCode.trim()) return;
    try {
      const token = getEffectiveAuthToken();
      const response = await axios.post(
        `${API_BASE_URL}/checkout/validate-coupon`,
        { code: couponCode.trim() },
        { headers: token ? { Authorization: `Bearer ${token}` } : {} },
      );
      setCoupon(response.data?.coupon || null);
      setCouponMessage(response.data?.message || "Coupon applied");
    } catch (error) {
      setCoupon(null);
      setCouponMessage(
        error.response?.data?.error || "Coupon could not be applied",
      );
    }
  };
  return (
    <main
      style={{
        minHeight: "100vh",
        padding: "42px 20px 70px",
        background: darkMode
          ? "#020617"
          : "linear-gradient(145deg, #f8fafc, #eef2f7)",
        color: pageColor,
      }}
    >
      <div style={{ maxWidth: 1040, margin: "0 auto" }}>
        <button
          type="button"
          onClick={() => navigate("/pricing")}
          style={{
            border: 0,
            background: "transparent",
            color: "#2563eb",
            cursor: "pointer",
            fontWeight: 700,
            padding: 0,
          }}
        >
          Back to pricing
        </button>
        <p
          style={{
            margin: "26px 0 8px",
            color: "#ed2224",
            fontWeight: 800,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            fontSize: "0.75rem",
          }}
        >
          Secure membership checkout
        </p>
        <h1 style={{ margin: 0, fontSize: "clamp(2rem, 4vw, 3.2rem)" }}>
          Complete your subscription
        </h1>
        {loading && <p>Loading checkout...</p>}
        {!loading && plan && (
          <form
            className="subscription-checkout-form"
            onSubmit={save}
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) minmax(280px, 0.72fr)",
              gap: 18,
              marginTop: 26,
              padding: 26,
              borderRadius: 24,
              background: surface,
              border: darkMode ? "1px solid #334155" : "1px solid #e2e8f0",
              boxShadow: "0 24px 65px rgba(15,23,42,0.14)",
            }}
          >
            <div style={{ display: "grid", gap: 18 }}>
              <div>
                <h2 style={{ margin: 0 }}>{plan.name}</h2>
                <p
                  style={{
                    margin: "6px 0 0",
                    color: darkMode ? "#cbd5e1" : "#64748b",
                  }}
                >
                  {plan.short_description || "Subscription access"}
                </p>
              </div>
              <label className="subscription-currency-field">
                <span className="subscription-currency-label">Billing currency</span>
                <select
                  className="subscription-currency-select"
                  value={currency}
                  onChange={(event) => setCurrency(event.target.value)}
                >
                  {Object.keys(
                    plan.pricing?.currency_prices || {
                      [plan.pricing?.currency || "USD"]: true,
                    },
                  ).map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
                <small>Prices shown in your selected currency</small>
              </label>
              <label style={{ display: "grid", gap: 7 }}>
                <span>Full name</span>
                <input
                  value={billing.fullName}
                  onChange={(event) =>
                    setBilling({ ...billing, fullName: event.target.value })
                  }
                  required
                />
              </label>
              <label style={{ display: "grid", gap: 7 }}>
                <span>Email</span>
                <input
                  type="email"
                  value={billing.email}
                  onChange={(event) =>
                    setBilling({ ...billing, email: event.target.value })
                  }
                  required
                />
              </label>
              <fieldset
                style={{
                  display: "grid",
                  gap: 10,
                  border: "1px solid #cbd5e1",
                  borderRadius: 12,
                  padding: 14,
                }}
              >
                <legend>Choose duration</legend>
                {Object.keys(prices).map((option) => (
                  <label
                    key={option}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                    }}
                  >
                    <span>
                      <input
                        type="radio"
                        name="duration"
                        checked={duration === option}
                        onChange={() => setDuration(option)}
                      />{" "}
                      {option.replace("_", " ")}
                    </span>
                    <strong>
                      {prices[option]} {currency}
                    </strong>
                  </label>
                ))}
              </fieldset>
              <fieldset
                style={{
                  display: "grid",
                  gap: 10,
                  border: "1px solid #cbd5e1",
                  borderRadius: 12,
                  padding: 14,
                }}
              >
                <legend>Payment method</legend>
                {total > 0 ? (
                  paymentMethods.map((method) => (
                    <label
                      key={method}
                      style={{ display: "flex", alignItems: "center", gap: 8 }}
                    >
                      <input
                        type="radio"
                        name="paymentMethod"
                        checked={paymentMethod === method}
                        onChange={() => setPaymentMethod(method)}
                      />
                      <span style={{ flex: 1 }}>{method}</span>
                      {method === CREDITS_PAYMENT_METHOD ? (
                        <span style={{ opacity: 0.5, whiteSpace: "nowrap" }}>
                          Balance: {creditBalance.toFixed(2)} credits
                        </span>
                      ) : null}
                    </label>
                  ))
                ) : (
                  <span>No payment required</span>
                )}
              </fieldset>
            </div>
            <aside
              style={{
                alignSelf: "start",
                padding: 20,
                borderRadius: 18,
                background: darkMode ? "#1e293b" : "#f8fafc",
                border: darkMode ? "1px solid #475569" : "1px solid #e2e8f0",
              }}
            >
              <p
                style={{
                  margin: 0,
                  color: "#64748b",
                  fontSize: "0.75rem",
                  fontWeight: 800,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                }}
              >
                Order summary
              </p>
              <h3 style={{ margin: "10px 0 18px" }}>{plan.name}</h3>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginBottom: 10,
                }}
              >
                <span>{duration.replace("_", " ")}</span>
                <strong>
                  {amount} {currency}
                </strong>
              </div>
              <div style={{ display: "flex", gap: 8, margin: "18px 0" }}>
                <input
                  value={couponCode}
                  onChange={(event) => setCouponCode(event.target.value)}
                  placeholder="Coupon code"
                  style={{
                    minWidth: 0,
                    flex: 1,
                    padding: "10px 11px",
                    border: "1px solid #cbd5e1",
                    borderRadius: 9,
                  }}
                />
                <button
                  type="button"
                  onClick={applyCoupon}
                  style={{
                    border: 0,
                    borderRadius: 9,
                    padding: "10px 12px",
                    background: "#0f172a",
                    color: "white",
                    cursor: "pointer",
                    fontWeight: 700,
                  }}
                >
                  Apply
                </button>
              </div>
              {couponMessage && (
                <p
                  style={{
                    margin: "-8px 0 12px",
                    color: coupon ? "#16a34a" : "#dc2626",
                    fontSize: "0.85rem",
                  }}
                >
                  {couponMessage}
                </p>
              )}
              {coupon && (
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    color: "#16a34a",
                    marginBottom: 10,
                  }}
                >
                  <span>Discount</span>
                  <strong>
                    -{discount.toFixed(2)} {currency}
                  </strong>
                </div>
              )}
              <div
                style={{
                  borderTop: "1px solid #cbd5e1",
                  paddingTop: 14,
                  display: "flex",
                  justifyContent: "space-between",
                  fontWeight: 800,
                  fontSize: "1.2rem",
                }}
              >
                <span>Total</span>
                <strong>
                  {total.toFixed(2)} {currency}
                </strong>
              </div>
              <button
                type="submit"
                disabled={submitting}
                style={{
                  width: "100%",
                  marginTop: 20,
                  border: 0,
                  borderRadius: 12,
                  padding: "14px 18px",
                  background: "linear-gradient(135deg, #ed2224, #b91c1c)",
                  color: "white",
                  cursor: "pointer",
                  fontWeight: 800,
                }}
              >
                {submitting ? "Processing..." : `Buy ${plan.name}`}
              </button>
              {message && (
                <p style={{ margin: "12px 0 0", color: "#dc2626" }}>
                  {message}
                </p>
              )}
            </aside>
          </form>
        )}
        {!loading && !plan && <p>{message}</p>}
      </div>
    </main>
  );
}
