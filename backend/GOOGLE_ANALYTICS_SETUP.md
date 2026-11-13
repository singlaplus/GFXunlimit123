# Google Analytics account connection

The **Connect Google Analytics** action uses a server-side Google OAuth popup and requests read-only Analytics access. It does not execute pasted code, expose OAuth tokens to the browser, or import reports by itself.

1. In Google Cloud Console, enable the **Google Analytics Data API** in the project used by your existing Google Search Console OAuth client. Configure the OAuth consent screen to include Analytics read-only access.
2. Reuse the Search Console Web application OAuth client when available. Add the Analytics backend callback URL to its authorized redirect URIs, keeping the existing Search Console callback as well:

   - Local: `http://localhost:5000/google-analytics/oauth/callback`
   - Live: `https://gfxunlimit.com/google-analytics/oauth/callback`

   The website origin must also be listed under authorized JavaScript origins. If you use a different backend host, use that host in the callback URL.
3. On the admin Google Analytics page, choose **Connect Google Analytics → Configure OAuth Manually**. The app reuses the Search Console client ID and secret from the backend when present. Confirm the callback URL and enter or generate a separate Analytics token key. These settings are saved to the private backend `backend/.env` file.
4. If Search Console OAuth credentials are not configured, provide these client values through the backend environment:

   - `GOOGLE_ANALYTICS_CLIENT_ID` — Web application OAuth client ID.
   - `GOOGLE_ANALYTICS_CLIENT_SECRET` — matching OAuth client secret.

   The manual configuration button stores `GOOGLE_ANALYTICS_REDIRECT_URI` and `GOOGLE_ANALYTICS_TOKEN_KEY`. The callback must exactly match a URI registered in Google Cloud. The token key is a private, persistent 32-byte key encoded as 64 hex characters or base64.

   Never put the client secret or token key in frontend variables or source control. Keep the token key unchanged so saved credentials remain decryptable. The configuration form can generate a secure key for you.
5. Ensure the website origin is included in the backend's allowed CORS origins, then restart the backend if you configured OAuth by editing `.env` directly. The admin configuration button applies its settings to the running backend immediately. The backend applies migration `036_google_analytics_connections.sql` on startup.
6. In the admin Google Analytics page, choose **Connect Google Analytics**. Google will open in a separate popup and request `openid`, `email`, and `analytics.readonly` access. After consent, the account email is shown on the page and its tokens are encrypted with AES-256-GCM in the backend database.

Google Analytics account linking is stored separately from Search Console. The existing GA4 Measurement ID and Google Tag Manager fields continue to install website tags; OAuth authorization alone does not install a tag or import Analytics reports.
