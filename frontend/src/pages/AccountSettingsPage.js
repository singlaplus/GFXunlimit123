import { useEffect, useState } from "react";
import axios from "axios";
import { buildAuthHeaders, getEffectiveAuthToken } from "../utils/authSession";
import "./AccountSettingsPage.css";

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || "http://localhost:5000";
const initialSettings = {
  email: "",
  id: "",
  displayName: "",
  expertise: "",
  mailingAddress: "",
  addressLine2: "",
  city: "",
  postalCode: "",
  country: "",
  province: "",
  sameAddress: false,
  phone: "",
  payoutName: "",
  payoutMethod: "",
  payoutEmail: "",
  minimumPayout: "",
};

export default function AccountSettingsPage({ darkMode, username }) {
  const [settings, setSettings] = useState(initialSettings);
  const [licensing, setLicensing] = useState({ image: true, video: true, imageData: true, videoData: true });
  const [saved, setSaved] = useState(false);
  const [uploadCount, setUploadCount] = useState(0);

  useEffect(() => {
    const token = getEffectiveAuthToken();
    if (!token) return undefined;
    Promise.all([
      axios.get(`${API_BASE_URL}/profile`, { headers: buildAuthHeaders(token) }),
      axios.get(`${API_BASE_URL}/profile/stats`, { headers: buildAuthHeaders(token) }),
    ]).then(([profileResponse, statsResponse]) => {
      setSettings((current) => ({ ...current, email: profileResponse.data?.email || "", id: profileResponse.data?.id || "", displayName: profileResponse.data?.full_name || profileResponse.data?.username || username || "" }));
      setUploadCount(Number(statsResponse.data?.total_uploads || 0));
    }).catch(() => {});
    return undefined;
  }, [username]);

  const update = (field, value) => {
    setSaved(false);
    setSettings((current) => ({ ...current, [field]: value }));
  };

  const save = (event) => {
    event.preventDefault();
    localStorage.setItem(`account_settings_${username || "contributor"}`, JSON.stringify({ settings, licensing }));
    setSaved(true);
  };

  const input = (label, field, options = {}) => <label className="account-settings-field"><span>{label}</span><input value={settings[field]} onChange={(event) => update(field, event.target.value)} {...options} /></label>;

  return (
    <main className={`account-settings-page ${darkMode ? "is-dark" : ""}`}>
      <form onSubmit={save}>
        <header className="account-settings-header"><div><span className="account-settings-eyebrow">Contributor account</span><h1>Account settings</h1></div><button type="submit">Save settings</button></header>
        {saved && <p className="account-settings-saved" role="status">Settings saved.</p>}

        <section className="account-settings-section"><h2>User details</h2>{input("Email address", "email", { readOnly: true })}<a href="https://contributor-accounts.shutterstock.com/users/current/email?language=en" target="_blank" rel="noreferrer">Change email ↗</a><div className="account-settings-grid"><div className="account-settings-readonly"><span>ID</span><strong>{settings.id || "-"}</strong></div>{input("Display name", "displayName")}</div><div className="account-settings-expertise"><div className="account-settings-expertise-heading"><span>Level of Expertise</span><strong>{uploadCount % 100}/100</strong></div><div className="account-settings-progress"><i style={{ width: `${uploadCount % 100}%` }} /></div><p className="account-settings-upload-count">{uploadCount} assets uploaded</p><div className="account-settings-points">Points earned: <strong>{Math.floor(uploadCount / 100)}</strong></div></div><p className="account-settings-note">This information will not be shown on your profile and has no effect on your status or royalties.</p></section>

        <section className="account-settings-section"><h2>Contact information</h2><div className="account-settings-grid">{input("Mailing Address", "mailingAddress")}{input("Address line 2 (Apartment #, street #)", "addressLine2")}{input("City", "city")}{input("Postal/Zip code", "postalCode")}{input("Country", "country")}{input("Province", "province")}{input("Phone", "phone", { type: "tel" })}</div><label className="account-settings-checkbox"><input type="checkbox" checked={settings.sameAddress} onChange={(event) => update("sameAddress", event.target.checked)} /> Residential and mailing addresses are the same</label></section>

        <section className="account-settings-section"><h2>Payout information</h2><p>Make payments to</p><div className="account-settings-grid">{input("Payout method", "payoutMethod")}{input("Payout email", "payoutEmail", { type: "email" })}{input("Minimum payout", "minimumPayout", { type: "number", min: "0", step: "0.01" })}</div><span className="account-settings-currency">$ USD</span></section>

        <section className="account-settings-section"><h2>Licensing options</h2>{[["image", "Image licensing"], ["video", "Video licensing"], ["imageData", "Image data licensing"], ["videoData", "Video data licensing"]].map(([key, label]) => <label className="account-settings-toggle" key={key}><span>{label}</span><input type="checkbox" checked={licensing[key]} onChange={(event) => setLicensing((current) => ({ ...current, [key]: event.target.checked }))} /><b>{licensing[key] ? "Yes" : "No"}</b></label>)}</section>

      </form>
    </main>
  );
}
