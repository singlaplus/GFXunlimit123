const GA4_MEASUREMENT_ID_PATTERN = /^G-[A-Z0-9]{6,20}$/;
const GOOGLE_TAG_MANAGER_ID_PATTERN = /^GTM-[A-Z0-9]{6,20}$/;
const GA4_SCRIPT_ID = "gfx-google-analytics-script";
const GTM_SCRIPT_ID = "gfx-google-tag-manager-script";
const GTM_NOSCRIPT_ID = "gfx-google-tag-manager-noscript";
const LEGACY_SCRIPT_ID = "gfx-google-analytics-gtag-script";
let activeTagSettings = "";

export function normalizeGoogleAnalyticsMeasurementId(value) {
  if (typeof value !== "string") return null;
  const measurementId = value.trim().toUpperCase();
  if (!measurementId) return "";
  return GA4_MEASUREMENT_ID_PATTERN.test(measurementId) ? measurementId : null;
}

export function normalizeGoogleTagManagerId(value) {
  if (typeof value !== "string") return null;
  const tagManagerId = value.trim().toUpperCase();
  if (!tagManagerId) return "";
  return GOOGLE_TAG_MANAGER_ID_PATTERN.test(tagManagerId) ? tagManagerId : null;
}

export function extractGoogleTagIdsFromSnippet(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Paste a Google Analytics or Google Tag Manager script snippet.");
  }
  if (!/googletagmanager\.com\//i.test(value)) {
    throw new Error("Paste an official Google tag snippet that references googletagmanager.com.");
  }

  const ids = value.match(/\b(?:GTM-[A-Z0-9]{6,20}|G-[A-Z0-9]{6,20})\b/gi) || [];
  const measurementIds = [...new Set(ids.filter((id) => id.toUpperCase().startsWith("G-")).map((id) => id.toUpperCase()))];
  const tagManagerIds = [...new Set(ids.filter((id) => id.toUpperCase().startsWith("GTM-")).map((id) => id.toUpperCase()))];

  if (!measurementIds.length && !tagManagerIds.length) {
    throw new Error("The snippet must contain a valid GA4 (G-...) or Tag Manager (GTM-...) ID.");
  }
  if (measurementIds.length > 1 || tagManagerIds.length > 1) {
    throw new Error("The snippet contains multiple IDs for one integration. Use one ID per integration.");
  }

  return {
    measurementId: measurementIds[0] || "",
    tagManagerId: tagManagerIds[0] || "",
  };
}

export function installGoogleAnalyticsTags({ measurementId = "", tagManagerId = "" } = {}) {
  const normalizedMeasurementId = normalizeGoogleAnalyticsMeasurementId(measurementId);
  const normalizedTagManagerId = normalizeGoogleTagManagerId(tagManagerId);
  if (normalizedMeasurementId === null || normalizedTagManagerId === null) {
    throw new Error("Enter a valid GA4 Measurement ID (G-...) and/or Google Tag Manager ID (GTM-...).");
  }

  const settingsKey = JSON.stringify([normalizedMeasurementId, normalizedTagManagerId]);
  const existingGa4Script = document.getElementById(GA4_SCRIPT_ID);
  const existingGtmScript = document.getElementById(GTM_SCRIPT_ID);
  const existingNoScript = document.getElementById(GTM_NOSCRIPT_ID);
  const legacyScript = document.getElementById(LEGACY_SCRIPT_ID);

  const expectedScriptsExist =
    (!normalizedMeasurementId || Boolean(existingGa4Script))
    && (!normalizedTagManagerId || Boolean(existingGtmScript && existingNoScript));
  if (activeTagSettings === settingsKey && expectedScriptsExist) return;

  window.dataLayer = [];
  window.gtag = undefined;
  existingGa4Script?.remove();
  existingGtmScript?.remove();
  existingNoScript?.remove();
  legacyScript?.remove();

  if (normalizedMeasurementId) {
    window.gtag = function gtag() {
      window.dataLayer.push(arguments);
    };
    window.gtag("js", new Date());
    window.gtag("config", normalizedMeasurementId);

    const ga4Script = document.createElement("script");
    ga4Script.id = GA4_SCRIPT_ID;
    ga4Script.async = true;
    ga4Script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(normalizedMeasurementId)}`;
    ga4Script.onerror = () => console.error("Failed to load Google Analytics tag script", normalizedMeasurementId);
    document.head.appendChild(ga4Script);
  }

  if (normalizedTagManagerId) {
    const gtmScript = document.createElement("script");
    gtmScript.id = GTM_SCRIPT_ID;
    gtmScript.async = true;
    gtmScript.src = `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(normalizedTagManagerId)}`;
    gtmScript.onerror = () => console.error("Failed to load Google Tag Manager container", normalizedTagManagerId);
    document.head.appendChild(gtmScript);

    const noScript = document.createElement("noscript");
    noScript.id = GTM_NOSCRIPT_ID;
    const iframe = document.createElement("iframe");
    iframe.src = `https://www.googletagmanager.com/ns.html?id=${encodeURIComponent(normalizedTagManagerId)}`;
    iframe.height = "0";
    iframe.width = "0";
    iframe.style.display = "none";
    iframe.style.visibility = "hidden";
    noScript.appendChild(iframe);
    document.body.insertBefore(noScript, document.body.firstChild);
  }

  activeTagSettings = settingsKey;
}
