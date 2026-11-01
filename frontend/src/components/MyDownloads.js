import { API_BASE_URL } from "../utils/apiBaseUrl.js";
import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { buildAuthHeaders, getEffectiveAuthToken } from "../utils/authSession";
import { getAssetPreviewUrl } from "../utils/assetPreview";
import { formatIndiaDateTime } from "../utils/indiaTime";
import Pagination from "./Pagination";
import { useStartupReadiness } from "../startup/StartupReadinessProvider";

function MyDownloads({ darkMode = false }) {

  const { reportResource, retryKey, routeId } = useStartupReadiness();
  const [downloads, setDownloads] =
    useState([]);
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [loadStatus, setLoadStatus] = useState("loading");
  const [loadError, setLoadError] = useState("");
  const [localRetry, setLocalRetry] = useState(0);
  const requestIdRef = useRef(0);
  const legacyHistoryRequestedRef = useRef(false);
  const readinessAttemptRef = useRef({ routeId, retryKey, localRetry });
  readinessAttemptRef.current = { routeId, retryKey, localRetry };
  const token = getEffectiveAuthToken();

  useEffect(() => {
    fetchDownloads();
    return () => { requestIdRef.current += 1; };
  }, [retryKey, routeId, localRetry]);

  const fetchDownloads = async () => {
    const requestId = requestIdRef.current + 1;
    const requestAttempt = { routeId, retryKey, localRetry };
    requestIdRef.current = requestId;
    setLoadStatus("loading");
    setLoadError("");
    reportResource("downloads", "loading", "", routeId);
    try {
      const authHeaders = buildAuthHeaders();
      if (!authHeaders.Authorization) {
        if (requestId !== requestIdRef.current) return;
        setDownloads([]);
        setLoadStatus("ready");
        reportResource("downloads", "ready", "", routeId);
        return;
      }

      const apiBaseUrl = API_BASE_URL;
      const response = await axios.get(`${apiBaseUrl}/my-customer-downloads`, {
        headers: authHeaders,
      });
      if (!Array.isArray(response.data) || response.data.some((download) =>
        !download || typeof download !== "object" || Array.isArray(download) ||
        download.id == null || (download.image_id == null && download.imageId == null)
      )) {
        throw new Error("Downloads response was invalid.");
      }
      if (requestId !== requestIdRef.current ||
          requestAttempt.routeId !== readinessAttemptRef.current.routeId ||
          requestAttempt.retryKey !== readinessAttemptRef.current.retryKey ||
          requestAttempt.localRetry !== readinessAttemptRef.current.localRetry) return;

      const customerDownloads = response.data.map((d) => {
        const imgId = d.image_id || d.imageId;
        return {
          id: d.id,
          image_id: imgId,
          title: d.title || d.filename || '',
          filename: d.filename || '',
          order_number: d.order_number || '',
          downloaded_at: d.created_at || null,
          expires_at: d.expires_at || null,
          is_active: d.is_active,
          download_token: d.download_token,
          thumbnail_url: d.thumbnail_url || null,
          thumbnail_status: d.thumbnail_status || null,
          source: 'customer_downloads'
        };
      });
      setDownloads(customerDownloads);
      setPage(1);
      setLoadStatus("ready");
      reportResource("downloads", "ready", "", routeId);

      if (legacyHistoryRequestedRef.current) return;
      legacyHistoryRequestedRef.current = true;
      try {
        const legacyResponse = await axios.get(`${apiBaseUrl}/downloads`, {
          headers: authHeaders,
        });
        if (requestId !== requestIdRef.current ||
            requestAttempt.routeId !== readinessAttemptRef.current.routeId ||
            requestAttempt.retryKey !== readinessAttemptRef.current.retryKey ||
            requestAttempt.localRetry !== readinessAttemptRef.current.localRetry ||
            !Array.isArray(legacyResponse.data)) return;
        const customerImageIds = new Set(customerDownloads.map((d) => String(d.image_id)));
        const historyDownloads = legacyResponse.data
          .filter((download) => download && typeof download === "object" && !Array.isArray(download))
          .map((d) => {
            const imgId = d.image_id || d.id || d.imageId;
            return {
              id: d.id,
              image_id: imgId,
              title: d.title || d.name || '',
              downloaded_at: d.downloaded_at || d.created_at || null,
              expires_at: null,
              is_active: false,
              thumbnail_url: d.thumbnail_url || null,
              thumbnail_status: d.thumbnail_status || null,
              source: 'downloads'
            };
          })
          .filter((download) => download.image_id != null && !customerImageIds.has(String(download.image_id)));
        if (historyDownloads.length) {
          setDownloads((current) => [...current, ...historyDownloads]);
        }
      } catch (e) {
        console.error("Unable to load optional legacy download history", e);
      }
    } catch (err) {
      if (requestId !== requestIdRef.current ||
          requestAttempt.routeId !== readinessAttemptRef.current.routeId ||
          requestAttempt.retryKey !== readinessAttemptRef.current.retryKey ||
          requestAttempt.localRetry !== readinessAttemptRef.current.localRetry) return;
      console.error(err);
      const message = err?.response
        ? `Unable to load downloads (HTTP ${err.response.status}).`
        : err?.message || "Unable to load downloads.";
      setLoadError(message);
      setLoadStatus("error");
      reportResource("downloads", "error", message, routeId);
    }
  };

  const totalPages = Math.max(1, Math.ceil(downloads.length / limit));
  const visibleDownloads = downloads.slice((page - 1) * limit, page * limit);

  const handleDownload = async (image) => {
    try {
      const authHeaders = buildAuthHeaders();
      if (!authHeaders.Authorization) return alert('You must be logged in to download.');

      // Get active customer download token for this image
      const apiBaseUrl = API_BASE_URL;
      const tokenRes = await axios.get(`${apiBaseUrl}/customer-download-token/${image.image_id}`, {
        headers: authHeaders,
      });

      const dlToken = tokenRes.data && tokenRes.data.download_token;
      if (!dlToken) return alert('No active download available for this item');

      const res = await axios.get(`${apiBaseUrl}/customer-download/${dlToken}`, {
        responseType: 'blob',
        headers: authHeaders,
      });

      if (!res || res.status !== 200 || !res.data) {
        throw new Error('Download failed');
      }

      const blob = res.data instanceof Blob ? res.data : new Blob([res.data]);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // derive filename from content-disposition or url
      let filename = null;
      const cdHeader = res.headers && (res.headers['content-disposition'] || res.headers['Content-Disposition']);
      if (cdHeader) {
        const match = cdHeader.match(/filename\*=UTF-8''([^;\n]+)/i) || cdHeader.match(/filename="?([^";\n]+)"?/i);
        if (match) filename = decodeURIComponent(match[1]);
      }
      if (!filename) {
        try {
          const respUrl = res.request && res.request.responseURL;
          if (respUrl) {
            const parts = respUrl.split('/');
            const last = parts[parts.length - 1];
            if (last) filename = decodeURIComponent(last.split('?')[0]);
          }
        } catch (e) {}
      }
      const sanitize = (s) => (s || '').toString().trim().replace(/\s+/g, '_').replace(/[^a-z0-9._-]/gi, '_').slice(0, 200);
      if (!filename) {
        const titleBase = sanitize(image.title || image.image_id || 'asset');
        const actualName = sanitize((image.filename || tokenRes.data?.filename || '').split('/').pop().replace(/\.[^.]+$/, '')) || 'file';
        const orderNumber = sanitize(image.order_number || tokenRes.data?.order_number || 'order');
        let ext = '';
        try {
          const respUrl = res.request && res.request.responseURL;
          if (respUrl) {
            const parts = respUrl.split('/');
            const last = parts[parts.length - 1];
            if (last && last.includes('.')) ext = '.' + last.split('.').pop().split('?')[0];
          }
        } catch (e) {}
        filename = `${titleBase}_${actualName}_${orderNumber}${ext || ''}`;
      }
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Download failed', err);
      alert(err.response?.data?.error || 'Download failed');
    }
  };

  if (!token) {
    return (
      <div style={{ marginTop: 20, color: darkMode ? "#f5f5f5" : "#111827" }}>
        <h2>⬇ My Downloads</h2>
        <p>You must be logged in to view your downloads. Please <a href="/login" style={{ color: darkMode ? "#93c5fd" : undefined }}>log in</a>.</p>
      </div>
    );
  }

  return (

    <div
      style={{
        marginTop: "20px",
        color: darkMode ? "#f5f5f5" : "#111827"
      }}
    >

      <h2>
        ⬇ My Downloads
      </h2>

      {loadStatus === "loading" ? (
        <p role="status">Loading downloads...</p>
      ) : loadError ? (
        <div role="alert">
          <p>{loadError}</p>
          <button type="button" onClick={() => {
            requestIdRef.current += 1;
            setLocalRetry((attempt) => attempt + 1);
          }}>Retry</button>
        </div>
      ) : downloads.length === 0 ? (

        <p>
          No downloads yet.
        </p>

      ) : (

        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "repeat(auto-fill,minmax(220px,1fr))",
            gap: "15px"
          }}
        >

          {visibleDownloads.map((image) => (

            <div
              key={
                image.id +
                image.downloaded_at
              }
              style={{
                background: darkMode ? "#1e1e1e" : "#ffffff",
                border: darkMode ? "1px solid #3a3a3a" : "1px solid #e5e7eb",
                borderRadius: "12px",
                overflow: "hidden",
                boxShadow:
                  "0 2px 10px rgba(0,0,0,0.1)"
              }}
            >

              <img
                src={getAssetPreviewUrl({ id: image.image_id || image.id, title: image.title, thumbnail_url: image.thumbnail_url, thumbnail_status: image.thumbnail_status, thumbnail_generated_at: image.thumbnail_generated_at }, { quality: 50, watermark: false, thumbnailOnly: true })}
                alt={image.title}
                loading="lazy"
                decoding="async"
                style={{
                  width: "100%",
                  height: "180px",
                  objectFit: "cover"
                }}
              />

              <div
                style={{
                  padding: "10px",
                  color: darkMode ? "#f5f5f5" : "#111827"
                }}
              >

                <strong>
                  {image.title}
                </strong>

                <p style={{ margin: 0, fontSize: '0.95rem', color: darkMode ? '#cbd5e1' : '#475569' }}>
                  {image.downloaded_at ? `${formatIndiaDateTime(image.downloaded_at)} IST` : ''}
                </p>
                <div style={{ marginTop: 10 }}>
                  {(() => {
                    const expiresAt = image.expires_at ? new Date(image.expires_at) : null;
                    const now = new Date();
                    const daysLeft = expiresAt ? Math.max(0, Math.ceil((expiresAt - now) / (24 * 60 * 60 * 1000))) : 0;
                    const disabled = !image.is_active || daysLeft <= 0;
                    return (
                      <>
                        <div style={{ fontSize: '0.92rem', color: disabled ? '#f87171' : darkMode ? '#cbd5e1' : '#475569', marginBottom: 6 }}>
                          {disabled ? 'Expired' : `Expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`}
                        </div>
                        <button
                          onClick={() => handleDownload(image)}
                          disabled={disabled}
                          style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid #1f6feb', background: disabled ? (darkMode ? '#374151' : '#f5f5f5') : '#1f6feb', color: disabled ? (darkMode ? '#cbd5e1' : '#999') : '#fff', cursor: disabled ? 'not-allowed' : 'pointer' }}
                        >
                          {disabled ? 'Download unavailable' : 'Download'}
                        </button>
                      </>
                    );
                  })()}
                </div>

              </div>

            </div>

          ))}

        </div>

      )}

      {downloads.length > limit && (
        <Pagination
          currentPage={page}
          totalPages={totalPages}
          totalImages={downloads.length}
          setCurrentPage={setPage}
          darkMode={darkMode}
        />
      )}

    </div>
  );

}
export default MyDownloads;