import { useEffect, useState } from "react";
import axios from "axios";
import { getEffectiveAuthToken } from "../utils/authSession";
import "./AdminCurrentPlansPage.css";

const PLAN_DURATION_ORDER = ["monthly", "3_months", "6_months", "1_year", "yearly", "limited"];
const PLAN_DURATION_LABELS = {
  monthly: "Month",
  "3_months": "3 Months",
  "6_months": "6 Months",
  "1_year": "Yearly",
  yearly: "Yearly",
  limited: "Limited time"
};

export default function AdminCurrentPlansPage({ darkMode = false }) {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editingPlan, setEditingPlan] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const fetchPlans = async () => {
      try {
        const token = getEffectiveAuthToken();
        const response = await axios.get(
          `${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"}/admin/subscription-plans`,
          { headers: token ? { Authorization: `Bearer ${token}` } : {} }
        );
        setPlans(Array.isArray(response.data) ? response.data : []);
      } catch (err) {
        console.error(err);
        setError(err.response?.data?.error || "Unable to load current plans.");
      } finally {
        setLoading(false);
      }
    };

    fetchPlans();
  }, []);

  const reloadPlans = async () => {
    const token = getEffectiveAuthToken();
    const response = await axios.get(
      `${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"}/admin/subscription-plans`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} }
    );
    setPlans(Array.isArray(response.data) ? response.data : []);
  };

  const startEditing = (plan) => {
    const duration = plan.plan_settings?.duration || "monthly";
    setEditingPlan(plan);
    setForm({
      name: plan.name || "",
      shortDescription: plan.short_description || "",
      active: plan.active !== false,
      recommended: plan.recommended === true,
      currency: plan.pricing?.currency || "USD",
      currencies: Object.keys(plan.pricing?.currency_prices || { [plan.pricing?.currency || "USD"]: true }),
      currencyPrices: plan.pricing?.currency_prices || { [plan.pricing?.currency || "USD"]: plan.pricing?.prices || { [duration]: plan.pricing?.amount ?? "" } },
      newCurrency: "",
      durations: plan.plan_settings?.durations || { [duration]: true },
      prices: plan.pricing?.prices || { [duration]: plan.pricing?.amount ?? "" },
      startDate: plan.plan_settings?.start_date || "",
      endDate: plan.plan_settings?.end_date || "",
      downloads: plan.download_limits?.downloads ?? ""
    });
  };

  const savePlan = async (event) => {
    event.preventDefault();
    const selectedDurations = Object.keys(form.durations).filter((duration) => form.durations[duration]);
    if (!form.name.trim() || selectedDurations.length === 0 || (selectedDurations.includes("limited") && (!form.startDate || !form.endDate)) || selectedDurations.some((duration) => form.prices[duration] === "" || Number(form.prices[duration]) < 0) || form.currencies.some((currency) => selectedDurations.some((duration) => form.currencyPrices[currency]?.[duration] === "" || form.currencyPrices[currency]?.[duration] === undefined || Number(form.currencyPrices[currency][duration]) < 0)) || form.downloads === "" || Number(form.downloads) < 0) {
      setError("Complete the plan name, selected duration prices, downloads, and limited-time dates when required.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const token = getEffectiveAuthToken();
      await axios.post(`${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"}/admin/subscription-plans`, {
        id: editingPlan.id,
        name: form.name.trim(),
        short_description: form.shortDescription.trim(),
        icon: editingPlan.icon || "",
        badge: editingPlan.badge || "",
        color: editingPlan.color || "#2196f3",
        display_order: form.active ? 0 : (editingPlan.display_order || 0),
        active: form.active,
        recommended: form.recommended,
        pricing: { amount: Number(form.prices[selectedDurations[0]]) || 0, currency: form.currency, prices: Object.fromEntries(selectedDurations.map((duration) => [duration, Number(form.prices[duration])])), currency_prices: Object.fromEntries(form.currencies.map((currency) => [currency, Object.fromEntries(selectedDurations.map((duration) => [duration, Number(form.currencyPrices[currency][duration])]))])) },
        download_limits: { downloads: Number(form.downloads) },
        licenses: editingPlan.licenses || [],
        asset_access: editingPlan.asset_access || [],
        member_benefits: editingPlan.member_benefits || {},
        limitations: editingPlan.limitations || {},
        plan_settings: { ...(editingPlan.plan_settings || {}), duration: selectedDurations[0], durations: Object.fromEntries(selectedDurations.map((duration) => [duration, true])), start_date: selectedDurations.includes("limited") ? form.startDate : null, end_date: selectedDurations.includes("limited") ? form.endDate : null }
      }, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      setEditingPlan(null);
      setForm(null);
      await reloadPlans();
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.error || "Unable to save plan.");
    } finally {
      setSaving(false);
    }
  };

  const deletePlan = async (plan) => {
    if (!window.confirm(`Delete ${plan.name || "this plan"}?`)) return;
    try {
      const token = getEffectiveAuthToken();
      await axios.delete(`${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"}/admin/subscription-plans/${plan.id}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      await reloadPlans();
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.error || "Unable to delete plan.");
    }
  };

  const movePlan = async (planIndex, direction) => {
    const targetIndex = planIndex + direction;
    if (targetIndex < 0 || targetIndex >= plans.length) return;
    const reorderedPlans = [...plans];
    [reorderedPlans[planIndex], reorderedPlans[targetIndex]] = [reorderedPlans[targetIndex], reorderedPlans[planIndex]];
    try {
      const token = getEffectiveAuthToken();
      await axios.post(`${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"}/admin/subscription-plans/reorder`, {
        orders: reorderedPlans.map((item, index) => ({ id: item.id, display_order: index }))
      }, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      setPlans(reorderedPlans);
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.error || "Unable to reorder plans.");
    }
  };

  const activePlans = plans.filter((plan) => plan.active !== false).length;
  const recommendedPlans = plans.filter((plan) => plan.recommended).length;

  return (
    <main className="current-plans-page">
      <div className="current-plans-shell">
      <div className="current-plans-header">
        <div>
          <p className="current-plans-kicker">Subscription control center</p>
          <h1>View Current Plans</h1>
          <p>Review your live offers, pricing architecture, and customer access in one place.</p>
        </div>
        <a className="current-plans-back" href="/admin">Back to Admin Panel</a>
      </div>

      <div className="current-plans-summary">
        <div className="current-plans-summary-item"><strong>{plans.length}</strong><span>Total plans</span></div>
        <div className="current-plans-summary-item"><strong>{activePlans}</strong><span>Active plans</span></div>
        <div className="current-plans-summary-item"><strong>{recommendedPlans}</strong><span>Most popular</span></div>
      </div>

      {loading && <p>Loading current plans...</p>}
      {error && <p style={{ color: "#d32f2f" }}>{error}</p>}
      {!loading && !error && plans.length === 0 && <p>No current plans found.</p>}
      {!loading && !error && plans.length > 0 && (
        <div className="current-plans-list">
          {plans.map((plan, planIndex) => (
            <article key={plan.id} className={`current-plan-card${plan.recommended ? " is-recommended" : ""}`}>
              <div className="current-plan-topline">
                <div>
                  <h2 className="current-plan-name">{plan.name || "Unnamed plan"} {plan.recommended && <span className="current-plan-badge">Most Popular</span>}</h2>
                  {plan.short_description ? <ul className="current-plan-description">{String(plan.short_description).split(/\r?\n|\s*•\s*/).map((item) => item.trim()).filter(Boolean).map((item, index) => <li key={`${plan.id}-description-${index}`}>{item.replace(/^[-*]\s*/, "")}</li>)}</ul> : <p className="current-plan-description">No description</p>}
                </div>
                <div className="current-plan-actions">
                  <button className="current-plan-action move" type="button" onClick={() => movePlan(planIndex, -1)} disabled={planIndex === 0} title="Move plan up">Up</button>
                  <button className="current-plan-action move" type="button" onClick={() => movePlan(planIndex, 1)} disabled={planIndex === plans.length - 1} title="Move plan down">Down</button>
                  <button className="current-plan-action edit" type="button" onClick={() => startEditing(plan)}>Edit</button>
                  <button className="current-plan-action delete" type="button" onClick={() => deletePlan(plan)}>Delete</button>
                </div>
              </div>
              <div className="current-plan-details">
                {plan.pricing?.amount != null ? `${plan.pricing.amount} ${plan.pricing.currency || ""}`.trim() : "Price not set"}
                {" · "}{plan.active === false ? "Inactive" : "Active"}
                {plan.recommended ? " · Recommended" : ""}
              </div>
              <div className="current-plan-currencies">
                <span className="current-plan-currencies-title">All currency prices</span>
                {Object.entries(plan.pricing?.currency_prices || { [plan.pricing?.currency || "USD"]: plan.pricing?.prices || { [plan.plan_settings?.duration || "monthly"]: plan.pricing?.amount } }).map(([currency, currencyPrices]) => {
                  const durations = Object.keys(currencyPrices || {}).sort((first, second) => PLAN_DURATION_ORDER.indexOf(first) - PLAN_DURATION_ORDER.indexOf(second));
                  return (
                    <div key={currency} className="current-plan-currency-row">
                      <strong>{currency}</strong>
                      <span>{durations.map((duration) => `${PLAN_DURATION_LABELS[duration] || duration}: ${currencyPrices[duration]}`).join(" · ")}</span>
                    </div>
                  );
                })}
              </div>
              {editingPlan?.id === plan.id && form && (
                <form onSubmit={savePlan} className="current-plan-edit">
                  <label className="current-plan-edit-label"><span>Plan Name</span><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></label>
                  <label className="current-plan-edit-label"><span>Description</span><textarea rows="5" value={form.shortDescription} onChange={(event) => setForm({ ...form, shortDescription: event.target.value })} placeholder="Enter a custom description for this subscription plan" /></label>
                  <fieldset>
                    <legend>Duration and Price</legend>
                    {[['monthly', 'Monthly'], ['3_months', '3 Months'], ['6_months', '6 Months'], ['1_year', '1 Year'], ['limited', 'Limited time']].map(([value, label]) => (
                      <div key={value} className="current-plan-duration-editor">
                        <label><input type="checkbox" checked={Boolean(form.durations[value])} onChange={(event) => setForm({ ...form, durations: { ...form.durations, [value]: event.target.checked } })} /> <span>{label}</span></label>
                        {form.durations[value] && <div className="current-plan-currency-edit-grid">{(form.currencies || [form.currency || "USD"]).map((currency) => <label key={currency} className="current-plan-edit-label"><span>{currency}</span><input aria-label={`${currency} ${label} price`} type="number" min="0" step="0.01" value={form.currencyPrices?.[currency]?.[value] ?? form.prices?.[value] ?? ""} onChange={(event) => setForm({ ...form, currencyPrices: { ...(form.currencyPrices || {}), [currency]: { ...(form.currencyPrices?.[currency] || {}), [value]: event.target.value } }, prices: currency === form.currency ? { ...form.prices, [value]: event.target.value } : form.prices })} required /></label>)}</div>}
                      </div>
                    ))}
                  </fieldset>
                  <div className="current-plan-add-currency"><input aria-label="New currency code" maxLength="5" placeholder="Currency code (e.g. GBP)" value={form.newCurrency} onChange={(event) => setForm({ ...form, newCurrency: event.target.value.toUpperCase() })} /><button type="button" onClick={() => { const currency = form.newCurrency.trim().toUpperCase(); if (!currency || form.currencies.includes(currency)) return; setForm({ ...form, currencies: [...form.currencies, currency], currencyPrices: { ...form.currencyPrices, [currency]: Object.fromEntries(Object.keys(form.durations).map((duration) => [duration, ""])) }, newCurrency: "" }); }}>Add currency</button></div>
                  {form.durations.limited && <div className="current-plan-duration-row"><label className="current-plan-edit-label"><span>Start date</span><input type="date" value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} required /></label><label className="current-plan-edit-label"><span>End date</span><input type="date" value={form.endDate} min={form.startDate || undefined} onChange={(event) => setForm({ ...form, endDate: event.target.value })} required /></label></div>}
                  <label className="current-plan-edit-label"><span>Downloads</span><input type="number" min="0" step="1" value={form.downloads} onChange={(event) => setForm({ ...form, downloads: event.target.value })} required /></label>
                  <label><input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} /> <span>Active plan</span></label>
                  <label><input type="checkbox" checked={form.recommended} onChange={(event) => setForm({ ...form, recommended: event.target.checked })} /> <span>Recommended</span></label>
                  <div className="current-plan-edit-actions"><button className="current-plan-action edit" type="submit" disabled={saving}>{saving ? "Saving..." : "Save Changes"}</button><button type="button" onClick={() => { setEditingPlan(null); setForm(null); }}>Cancel</button></div>
                </form>
              )}
            </article>
          ))}
        </div>
      )}
      </div>
    </main>
  );
}
