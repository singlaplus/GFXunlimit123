import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import "./PublicProfilePage.css";

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || "http://localhost:5000";
const emptyProfile = {
  displayName: "",
  portfolioUrl: "https://www.shutterstock.com/g/",
  website: "https://",
  tagline: "",
  location: "",
  contributorType: "",
  styles: "",
  subjects: "",
  equipment: "",
  biography: "",
  facebook: "facebook.com/",
  instagram: "",
  linkedin: "linkedin.com/in/",
  twitter: "",
  profilePicture: "",
};

export default function PublicProfilePage({ darkMode, username }) {
  const [profile, setProfile] = useState(emptyProfile);
  const [saved, setSaved] = useState(false);

  const storageKey = useMemo(() => `public_profile_${username || "contributor"}`, [username]);
  const portfolioUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/c/c/c/c/${encodeURIComponent(username || "contributor")}`;

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) || "null");
      if (stored) setProfile({ ...emptyProfile, ...stored });
    } catch (error) {
      // Ignore invalid local profile data.
    }
  }, [storageKey]);

  useEffect(() => {
    let mounted = true;
    const token = localStorage.getItem("token");
    if (!token) return undefined;
    axios.get(`${API_BASE_URL}/profile`, { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => {
        if (mounted) setProfile((current) => ({ ...current, displayName: current.displayName || response.data?.full_name || response.data?.username || username || "" }));
      })
      .catch(() => {});
    return () => { mounted = false; };
  }, [username]);

  const updateField = (field, value) => {
    setSaved(false);
    setProfile((current) => ({ ...current, [field]: value }));
  };

  const saveProfile = (event) => {
    event.preventDefault();
    localStorage.setItem(storageKey, JSON.stringify(profile));
    setSaved(true);
  };

  const handlePicture = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => updateField("profilePicture", String(reader.result));
    reader.readAsDataURL(file);
  };

  const field = (label, key, placeholder = "") => (
    <label className="public-profile-field">
      <span>{label}</span>
      <input value={profile[key]} placeholder={placeholder} onChange={(event) => updateField(key, event.target.value)} />
    </label>
  );

  return (
    <main className={`public-profile-page ${darkMode ? "is-dark" : ""}`}>
      <form onSubmit={saveProfile}>
        <header className="public-profile-header">
          <div>
            <span className="public-profile-eyebrow">Contributor profile</span>
            <h1>Public profile</h1>
            <p>Choose what visitors see when they view your contributor profile.</p>
          </div>
          <button className="public-profile-save" type="submit">Save profile</button>
        </header>
        {saved && <p className="public-profile-saved" role="status">Profile settings saved.</p>}

        <section className="public-profile-section">
          <h2>Basic information</h2>
          <div className="public-profile-picture-row">
            <div className="public-profile-picture">{profile.profilePicture ? <img src={profile.profilePicture} alt="Profile preview" /> : <span>{(profile.displayName || username || "C").charAt(0).toUpperCase()}</span>}</div>
            <label className="public-profile-upload">Profile Picture<input type="file" accept="image/*" onChange={handlePicture} /></label>
          </div>
          <div className="public-profile-grid">
            {field("Display name", "displayName")}
            <label className="public-profile-field"><span>Portfolio URL</span><div className="public-profile-url-field"><input value={portfolioUrl} readOnly aria-label="Portfolio URL" /><a href={portfolioUrl} target="_blank" rel="noreferrer" className="public-profile-open-link" aria-label="Open portfolio URL" title="Open portfolio URL">↗</a></div></label>
            {field("Website", "website", "https://")}
            {field("Location", "location")}
          </div>
          <label className="public-profile-field"><span>Tagline <small>{profile.tagline.length}/150</small></span><input maxLength={150} value={profile.tagline} onChange={(event) => updateField("tagline", event.target.value)} /></label>
        </section>

        <section className="public-profile-section">
          <h2>About</h2>
          <div className="public-profile-grid">
            {field("Contributor Type", "contributorType")}
            {field("Styles", "styles")}
            {field("Subjects", "subjects")}
            {field("Equipment", "equipment", "- ")}
          </div>
          <label className="public-profile-field"><span>Biography <small>{profile.biography.length}/2000</small></span><textarea maxLength={2000} value={profile.biography} onChange={(event) => updateField("biography", event.target.value)} /></label>
        </section>

        <section className="public-profile-section">
          <h2>Social Media</h2>
          <div className="public-profile-grid">
            {field("Facebook", "facebook", "facebook.com/")}
            {field("Instagram", "instagram")}
            {field("LinkedIn", "linkedin", "linkedin.com/in/")}
            {field("Twitter", "twitter")}
          </div>
        </section>

      </form>
    </main>
  );
}
