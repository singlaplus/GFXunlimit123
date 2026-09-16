import { useEffect, useState } from "react";
import axios from "axios";
import { getAssetPreviewUrl } from "../utils/assetPreview";
import Pagination from "./Pagination";

function MyDownloads({ darkMode = false }) {

  const [downloads, setDownloads] =
    useState([]);
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;

  useEffect(() => {

    fetchDownloads();

  }, []);

  const fetchDownloads = async () => {

    try {

      const token = localStorage.getItem("token");

      const apiBaseUrl = process.env.REACT_APP_API_BASE_URL || "http://localhost:5000";
      // customer_downloads with tokens and expiry
      const res1 = await axios.get(`${apiBaseUrl}/my-customer-downloads`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      // older downloads history (optional)
      let res2 = { data: [] };
      try {
        res2 = await axios.get(`${apiBaseUrl}/downloads`, {
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch (e) {
        // ignore if not present
      }

      const customerDownloads = (res1.data || []).map((d) => {
        const imgId = d.image_id || d.imageId;
        return {
          id: d.id,
          image_id: imgId,
          title: d.title || d.filename || '',
          downloaded_at: d.created_at || null,
          expires_at: d.expires_at || null,
          is_active: d.is_active,
          download_token: d.download_token,
          thumbnail_url: d.thumbnail_url || null,
          thumbnail_status: d.thumbnail_status || null,
          source: 'customer_downloads'
        };
      });

      const customerImageIds = new Set(customerDownloads.map((d) => String(d.image_id)));
      const historyDownloads = [];
      (res2.data || []).forEach((d) => {
        const imgId = d.image_id || d.id || d.imageId;
        if (!customerImageIds.has(String(imgId))) historyDownloads.push({
          id: d.id,
          image_id: imgId,
          title: d.title || d.name || '',
          downloaded_at: d.downloaded_at || d.created_at || null,
          expires_at: null,
          is_active: false,
          thumbnail_url: d.thumbnail_url || null,
          thumbnail_status: d.thumbnail_status || null,
          source: 'downloads'
        });
      });

      setDownloads([...customerDownloads, ...historyDownloads]);
      setPage(1);

    } catch (err) {
      console.error(err);
    }

  };

  const totalPages = Math.max(1, Math.ceil(downloads.length / limit));
  const visibleDownloads = downloads.slice((page - 1) * limit, page * limit);

  const handleDownload = async (image) => {
    try {
      const tokenLocal = localStorage.getItem('token');
      if (!tokenLocal) return alert('You must be logged in to download.');

      // Get active customer download token for this image
      const apiBaseUrl = process.env.REACT_APP_API_BASE_URL || "http://localhost:5000";
      const tokenRes = await axios.get(`${apiBaseUrl}/customer-download-token/${image.image_id}`, {
        headers: { Authorization: `Bearer ${tokenLocal}` },
      });

      const dlToken = tokenRes.data && tokenRes.data.download_token;
      if (!dlToken) return alert('No active download available for this item');

      const res = await axios.get(`${apiBaseUrl}/customer-download/${dlToken}`, {
        responseType: 'blob',
        headers: { Authorization: `Bearer ${tokenLocal}` },
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
      // Prefer the image title as filename
      const sanitize = (s) => (s || '').toString().trim().replace(/\s+/g, '_').replace(/[^a-z0-9._-]/gi, '_').slice(0, 200);
      const titleBase = sanitize(image.title || image.image_id || 'asset');
      let ext = '';
      if (filename && filename.includes('.')) {
        ext = '.' + filename.split('.').pop().split('?')[0];
      } else {
        try {
          const respUrl = res.request && res.request.responseURL;
          if (respUrl) {
            const parts = respUrl.split('/');
            const last = parts[parts.length - 1];
            if (last && last.includes('.')) ext = '.' + last.split('.').pop().split('?')[0];
          }
        } catch (e) {}
      }
      a.download = `${titleBase}${ext || ''}`;
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

      {downloads.length === 0 ? (

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
                src={getAssetPreviewUrl({ id: image.image_id || image.id, title: image.title, thumbnail_url: image.thumbnail_url, thumbnail_status: image.thumbnail_status }, { quality: 50, watermark: false })}
                alt={image.title}
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
                  {image.downloaded_at ? new Date(image.downloaded_at).toLocaleString() : ''}
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