# Google Search Console connection setup

The Search Console OAuth flow needs a Google Cloud OAuth client before the admin UI can connect an account.

1. In Google Cloud Console, enable the **Google Search Console API** and configure the OAuth consent screen.
2. Create an OAuth client ID for a **Web application**. Add the frontend origin to its authorized JavaScript origins and the backend callback URL to its authorized redirect URIs.
3. Configure these variables in the backend environment:

   - `GOOGLE_SEARCH_CONSOLE_CLIENT_ID` — OAuth client ID.
   - `GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET` — OAuth client secret.
   - `GOOGLE_SEARCH_CONSOLE_REDIRECT_URI` — exact backend callback URL, ending in `/search-console/oauth/callback`.
   - `GOOGLE_SEARCH_CONSOLE_TOKEN_KEY` — a private, persistent 32-byte key, encoded as 64 hex characters or base64. Generate one with `openssl rand -hex 32`. Do not commit it or share it.

   The admin Search Console page can import the downloaded OAuth client JSON to fill the client ID and secret, then save the configuration. Saved settings are written to `backend/.env`; keep this file private and on persistent backend storage. The UI confirms whether secrets are saved but does not return their values to the browser. Leave secret fields blank to keep existing values, or enter replacements to rotate them.

   To switch to a different Google account or OAuth client, use **Reset Search Console configuration** in the admin configuration tab and confirm the action. This removes the four Search Console OAuth settings from `backend/.env`, deletes the saved account connection and tokens, and leaves unrelated environment settings intact. Save the new OAuth values and connect the replacement account afterward.

4. Ensure the frontend origin is included in the backend's allowed CORS origins, then restart the backend so migrations `034_google_search_console.sql` and `035_google_search_console_selected_property.sql` are applied.
5. Connect an account that has permission for at least one Search Console property. The OAuth flow requests full Search Console access so it can submit sitemaps as well as read performance data. Existing connections created with read-only access must disconnect and reconnect to grant this scope.
6. In the **Property** tab, choose an available property and select **Save property**. The chosen property is stored with the Google account connection. Use **Reset property** to clear that saved selection without disconnecting the account.
7. For Domain-property verification with Cloudflare, create a Cloudflare API token scoped to the zone with **Zone → DNS → Edit**. In the **Ownership verification** tab, enter the token, zone ID, and domain, save them, then paste Google's exact TXT value and choose **Add TXT record to Cloudflare**. The token is stored in the private backend `.env` and is never returned to the browser. Confirm verification back in Google Search Console.
8. The **Overview** tab shows clicks, impressions, CTR, average position, daily trends, top queries and pages, and sitemap health for the selected date range. **Search performance** provides a detailed breakdown with up to 100 query/page/country/device rows. Search Console data can be delayed by Google and may be empty for recent dates.
9. In **Sitemaps**, submit the sitemap URL for the saved property (the site's sitemap is `https://gfxunlimit.com/sitemap.xml`) and use **Refresh status** to view Google's processing state. The URL must belong to the selected Search Console property.
10. If sitemap submission reports insufficient permissions, check the Google account tab for the granted write-scope status. A read-only connection must be disconnected, removed from the Google Account's third-party connections, then reconnected with Search Console manage access approved on the consent screen. Also confirm the account is an owner of the selected Search Console property.

HTML verification files and meta tags must still be deployed through the website host or deployment pipeline; this app does not have website-file deployment credentials. Google Analytics and Tag Manager verification also require their respective snippets and account permissions to already be set up.

The token key must remain unchanged across restarts. If it is lost or rotated, stored OAuth tokens cannot be decrypted and the Google account must be connected again. Never expose the client secret or token key in frontend variables.
