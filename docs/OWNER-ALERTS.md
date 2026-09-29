# MFTNB owner lead alerts

The phone app lives at `https://mftnb.com/owner/` in this repository. It uses the existing bound Google Apps Script and Google Sheet. There is no additional hosting service, push vendor, paid account, or separate customer submission endpoint.

## Current deployment boundary

Publishing this repository deploys the owner app assets through the existing Cloudflare Pages connection. It **does not update Google's running Apps Script**. Until that script is updated and enabled, the app explicitly says setup is pending and does not offer sign-in. Do not describe push delivery as live until the Google-side activation and a real phone test have succeeded.

`apps_script.gs` is now a generated, single-file deployment bundle. Its sources are `backend/forms.gs`, `backend/owner-notifications.gs`, and `tools/push-crypto.mjs`. Run `npm ci && npm run build:push` after editing them. The original estimate and message handlers retain their existing email flow, including the customer receipt's 24-hour reply expectation. The old public health version remains available; `?action=owner-status` is the owner-feature activation check.

## Activate the existing Google backend

1. Open the existing MFTNB lead Sheet and **Extensions → Apps Script**. Read its current source and private settings first. Reconcile any live-only edits with `backend/forms.gs`, regenerate the bundle, and preserve the existing spreadsheet binding, Turnstile secret, deployment URL, and executing Google account. Note the active version for rollback.
2. Verify the company owner's address in the Sheet/settings. Set private Script Property **MFTNB_OWNER_EMAIL** to that verified address. An existing Sheet named range **MFTNB_OWNER_EMAIL** is also supported; the setup function saves its value as the private property. Do not infer an administrator from customer rows, and do not put the owner's personal email in this public repository.
3. Replace the existing backend source with the generated `apps_script.gs`, including its bundled signature implementation. Avoid keeping duplicate old `doPost`/`doGet` functions. Use the **V8** runtime. The bundled cryptography needs BigInt support.
4. Run **enableOwnerNotifications** once from the editor and approve Google's requested Sheet, email, external-request and trigger permissions. It creates the private `Owner Inbox` tab and one 1-minute retry trigger. It sends no email or push. Re-running is safe and does not duplicate the trigger or replay old leads.
5. **Deploy → Manage deployments → Edit → New version → Deploy** the existing web app. Do not create a new endpoint or change who executes the app. A GET to the existing endpoint plus `?action=owner-status` must return `{"ok":true,"ownerApp":1,"enabled":true}`.
6. Open `/owner/` on Chris's phone. On iPhone, first add it to the home screen from Safari, then open that icon. Sign in with the configured owner email, enter the emailed 8-digit code, and tap **Enable notifications**. The first authorized phone generates the VAPID signing key using native Web Crypto and registers the phone. Private key material is kept in Script Properties and never returned by the API.
7. Chris can tap **Send a test alert** and confirm the notification actually appears. The app reports push-service acceptance separately from device delivery. After that, send a clearly marked test lead only with explicit authorization and verify the Sheet record, office/customer emails, phone alert and private inbox details. Repository tests make no live submissions.

Google Drive access and Apps Script deployment permissions are different capabilities. A Drive connection alone does not establish that the active script can be edited or deployed.

## Behavior and reliability

- Both successfully saved estimates and quick messages enter the owner inbox. The source Sheet row is committed first. Customer submission success is independent of email and notification delivery.
- The scheduled trigger normally sends new alerts within about a minute. A durable queue retries network errors, HTTP 429 and server errors with backoff (up to six attempts). HTTP 404/410 unregisters expired subscriptions; other permanent failures stay visible in the Sheet's `Push state` and `Last push result` columns. Delivery may be delayed by Google quotas, network conditions, phone settings or a push service.
- The trigger reconciles new source rows if the initial enqueue fails. It skips rows that existed before activation, claims jobs under a lease, and does not resend to a device already recorded as delivered. A crash between remote acceptance and recording can still yield a duplicate; this is not an exactly-once guarantee.
- Source tabs (`Leads` and `Quick Messages`) and `Owner Inbox` are append-only operational data. Use filter views; do not physically sort, delete or insert raw source rows. The reconciliation cursor is based on their append order. Lead status should be changed in the app.
- Only a generic notification is sent to the phone. The standard Web Push request deliberately has an empty body; the service worker immediately displays a visible notification and opens the authenticated inbox. It never receives customer details or session credentials. Alerts consolidate under one notification tag; the inbox contains each lead separately.
- Lead list shows the newest 200 leads received after activation. Call, text and email links are available on the detail view. Status choices are New, Contacted, Booked and Closed.
- Owner email codes require a valid production Turnstile check, expire after 10 minutes, allow five guesses, and have a one-minute resend cooldown and a 10-per-day limit. Sessions last 90 days, store only token hashes, and are tied to the configured owner email. Up to five sessions/devices are kept; the oldest is retired on the next sign-in. Changing the owner email invalidates previous sessions and delivery devices.
- Push endpoints are restricted to Apple, Google and Mozilla's HTTPS push services. Redirects are disabled. Subscription endpoints and signing keys are private Script Properties, not browser-facing configuration or a public Sheet.
- The owner service worker has scope `/owner/` only. It does not intercept fetches, cache customer details, or affect the estimator. Notification permission is requested only on the owner's button press.
- Sign out revokes the server session and phone subscription. Turning off notifications leaves inbox access intact. If a phone's subscription disappears, the app offers setup again on its next refresh.

## Verification and rollback

- `npm test` covers original estimate behavior, receipts, authentication limits, session revocation, endpoint validation, independently verified VAPID signatures, queue reconciliation/retry, and failures after saving.
- `node tests/owner.browser.cjs` covers owner login, mobile/desktop rendering, safe customer-text display, call links, status edits, phone controls, iPhone installation guidance, and the setup-pending state. It uses Playwright, with external endpoints mocked. Set `CODEX_PRIMARY_RUNTIME_NODE_MODULES` to the runtime modules, or install Playwright locally for CI.
- Production smoke checks fetch only public assets and owner feature status. They do not send email, push or customer leads.
- To stop alerts, run `disableOwnerNotifications` in Apps Script. It revokes sessions/devices and removes only this feature's trigger. It preserves source leads and the owner inbox. For a full rollback, stop the trigger and select the preceding version of the same web-app deployment, then revert the website commit if necessary.

References: [Web Push on iPhone](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/), [VAPID (RFC 8292)](https://www.rfc-editor.org/rfc/rfc8292), [HTTP Web Push (RFC 8030)](https://www.rfc-editor.org/rfc/rfc8030), [Google installable triggers](https://developers.google.com/apps-script/guides/triggers/installable), [Google web-app deployments](https://developers.google.com/apps-script/concepts/deployments).
