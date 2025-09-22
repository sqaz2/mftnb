MFTNB — Production Site

This is a ready-to-host static website for Moving Forward to New Beginnings with a chat-style estimator and a backend that stores submissions to Google Sheets (no API keys in the browser).

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
6) Submit a test; a new row appears in the sheet and an email is sent (optional).

Cloudflare Turnstile configuration
- Frontend: The estimator and quick message forms render Turnstile explicitly. Update `TURNSTILE_SITE_KEY` in `script.js` with your site key from the Cloudflare dashboard.
- The widget is loaded via `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit`. If the script is blocked, the UI now surfaces a clear message so visitors know to refresh or allow the challenge.
- Backend: Store the secret key in the `TURNSTILE_SECRET` script property. (Keep `TURNSTILE_SECRET_FALLBACK` blank unless you are doing a one-off local test.) The Apps Script verifies every submission with Cloudflare before anything is written to Sheets.
- Rotate keys in the Cloudflare dashboard as needed; only update Script Properties and the site key constant—no repository changes are required when swapping secrets.

Privacy & anti-spam
- No secrets or keys in the frontend. Apps Script runs server-side in your Google account.
- Hidden honeypot field to block bots. Add reCAPTCHA v3 later if needed.
