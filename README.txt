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
3) File → Save. Deploy → New deployment → Web app → Execute as: Me; Access: Anyone (or Anyone with the link). Copy URL.
4) Open index.html and set BACKEND.appsScriptUrl to that URL. Save and redeploy your site.
5) Submit a test; a new row appears in the sheet and an email is sent (optional).

Privacy & anti-spam
- No secrets or keys in the frontend. Apps Script runs server-side in your Google account.
- Hidden honeypot field to block bots. Add reCAPTCHA v3 later if needed.
