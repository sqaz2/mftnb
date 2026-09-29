MFTNB — Production Site

This is a ready-to-host static website for Moving Forward to New Beginnings with a chat-style estimator and a backend that stores submissions to Google Sheets (no server secrets in the browser).

Deploy the frontend (free)

Option A: GitHub Pages
1) Create a GitHub repo and add index.html to the root.
2) Repo → Settings → Pages → Deploy from branch (main / root).
3) Your site goes live at https://<username>.github.io/<repo>/

Option B: Cloudflare Pages
1) Pages → Create a project → Direct Upload → upload index.html.
2) Attach your own domain (mftnb.ca) when ready.

Set up the backend (Google Apps Script → Google Sheets)
1) Drive → New → Google Sheet (e.g., “MFTNB Leads”), keep Sheet1.
2) Extensions → Apps Script → paste contents of apps_script.gs.
3) File → Save. In Project Settings → Script properties, add `TURNSTILE_SECRET` with your Cloudflare secret key. (Never store the secret in source control.)
4) Deploy → New deployment → Web app → Execute as: Me; Access: Anyone (or Anyone with the link). Copy URL.
5) Open script.js and set `APPS_SCRIPT_URL` to that URL. Save and redeploy your site.
6) Use a controlled test submission to verify the Sheet row, office notification, and customer receipt. See docs/ESTIMATE-EMAIL.md for updating the existing deployment and checking email delivery.

Estimate receipt emails
- The existing Apps Script sends a customer receipt after saving the estimate request to the Leads sheet.
- The receipt says the request was received, a reply is expected within 24 hours, and questions can go to Chris at (587) 731-0695. Replies go to info@mftnb.ca.
- Updating GitHub or Cloudflare does not deploy apps_script.gs. Update the existing Apps Script web app version using docs/ESTIMATE-EMAIL.md.

Cloudflare Turnstile configuration
- Frontend: The estimator and quick message forms render Turnstile explicitly. Update `TURNSTILE_SITE_KEY` in `script.js` with your site key from the Cloudflare dashboard.
- The widget is loaded via `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit`. If the script is blocked, the UI now surfaces a clear message so visitors know to refresh or allow the challenge.
- Backend: Store the secret key in the `TURNSTILE_SECRET` script property. (Keep `TURNSTILE_SECRET_FALLBACK` blank unless you are doing a one-off local test.) The Apps Script verifies every submission with Cloudflare before anything is written to Sheets.
- Rotate keys in the Cloudflare dashboard as needed; only update Script Properties and the site key constant—no repository changes are required when swapping secrets.

Privacy & anti-spam
- No server secrets in the frontend. An optional Google Maps browser key must be restricted to this site and the required APIs. Apps Script runs server-side in your Google account.
- Hidden honeypot field to block bots. Add reCAPTCHA v3 later if needed.

Address confirmation and Google Maps travel
- See docs/MAPS-SETUP.md for the activation checklist and staff calculation contract.
- maps-config.js deliberately starts without a browser key and with an unconfirmed shop pin. Manual address confirmation and staff review remain available.
- Cloudflare Pages is the current GitHub-connected host; this feature uses the same repository and delivery endpoint.

Owner phone notifications
- Installable private owner app: https://mftnb.com/owner/.
- See docs/OWNER-ALERTS.md for the separate Google Apps Script activation and real-phone delivery check.
- The owner email stays in private Google settings. The public app shows setup pending until the backend is enabled.
- apps_script.gs is generated: edit backend/*.gs, then run npm ci && npm run build:push.
