# Customer confirmations and automatic replies

The existing estimator saves the request before attempting its receipt. The receipt includes the submitted move summary, confirmed locations and travel breakdown from the existing crew-plan notes, and:

> We received your estimate request. You can expect to hear back from our team within 24 hours. If you have any questions or your details change, call Chris at (587) 731-0695.

The subject is **We received your estimate request – Moving Forward to New Beginnings**. HTML and plain-text versions identify Moving Forward to New Beginnings and explain that staff review is pending; no price or booking is confirmed. Quick contact messages use the same sender and contact instructions.

When enabled, Cloudflare sends customer confirmations from **noreply@mftnb.com**, with Reply-To set to the same address. Incoming replies receive an automatic notice that the inbox is not monitored, the reply has not been forwarded, and questions or changes should go to Chris by phone. It does not promise a staff response to an unread reply. This handler belongs to the existing estimator repository; the customer workflow and submission endpoint stay unchanged.

## Current activation status

On September 29, 2026, the saved Cloudflare credential was verified and inbound routing was activated. Cloudflare reports `enabled: true, status: ready`. The exact `noreply@mftnb.com` rule routes to **mftnb-noreply**, whose two deployed module hashes match the reviewed source at `09a400be497cc09ccbd44afed95829122076ce57`. Worker and preview URLs are disabled. Cloudflare created three root MX records, one root SPF record and its routing DKIM record. Existing exact-address rules and the disabled catch-all were preserved.

The scoped activation ran through the existing secret in an isolated administrative branch: [verified setup run](https://github.com/sqaz2/1v1-nz/actions/runs/36513703817). It did not export the credential, send email, change billing, or deploy the game project.

**Outgoing customer confirmations are not activated yet.** After the owner completed Email Sending onboarding, the September 29 audit found three `cf-bounce` MX records, a `cf-bounce._domainkey` TXT record and a `_dmarc` TXT record. The live form endpoint still returned plain `ok`; the updated Apps Script bundle has not been deployed by this setup. Sending entitlement, runtime credentials and actual inbox delivery remain unverified. A GitHub/Pages deployment does not update the running Google Apps Script.

The live lead Sheet was also checked: actual submissions were in **Sheet1**, with 14 columns (`submittedAt, name, email, phone, pickup, dropoff, moveDate, timeWindow, homeSize, access, inventory, extras, notes, source`). The `Leads` tab was empty. The owner's full editor recording shows a saved draft that writes to `Leads` and sends via MailApp; its JSON health response differs from the deployed endpoint's plain `ok`. The editor draft and active deployment are different versions.

The updated bundle now writes to **Sheet1** and preserves its first 14 columns in place. It adds `bedrooms` and `consent` only at the end (O/P), filling only those empty headers and leaving existing records untouched. Unexpected headers stop the submission before any receipt is sent. The owner inbox and reconciliation use this same layout, including historical 14-column rows. No migration to `Leads` is needed. Before activation, confirm that the Sheet1 headers still match and preserve private settings. Replace the exposed Turnstile credential in private Script Properties; do not copy the recorded hardcoded secret into source or chat.

## Cloudflare setup

1. Use the existing account and `mftnb.com` zone. The setup credential needs DNS Edit, Zone Read, **Zone Settings Edit**, Email Routing Rules Edit, and Workers Scripts Edit. Keep secrets in the existing secret store, never code, logs or chat. The application runtime needs only an Email Sending token, not broad DNS or Worker access.
2. Check Email Sending entitlement. Cloudflare currently requires Workers Paid to send to arbitrary customer addresses. Do not assume the account has it or enable a paid plan without owner approval.
3. In **Compute → Email Service → Email Sending**, onboard `mftnb.com` and verify the provider-issued DNS records. Sending uses `cf-bounce` MX/SPF, `cf-bounce._domainkey` DKIM and `_dmarc`. Inspect existing DNS first and preserve other email services; do not create duplicate SPF/DMARC policies.
4. Incoming Email Routing is already enabled for `mftnb.com`; inspect its existing state before any future change. For root-zone activation, the documented `POST /zones/{zone_id}/email/routing/dns` call has no request body. The optional `name` parameter is for a subdomain; passing the root name produces error 2007.
5. Deploy `email-worker/worker.mjs` with `email-worker/wrangler.jsonc` to this account as **mftnb-noreply**. It has only an email handler, no public HTTP mail endpoint, no secrets and no database. Worker and preview URLs are disabled. Incoming `message.reply()` provides the reply path without a sending binding.
6. The exact Email Routing rule **noreply@mftnb.com → Send to a Worker: mftnb-noreply** is already installed. Preserve it and unrelated rules; do not add a duplicate or a catch-all. Verify actual reply delivery before enabling outgoing noreply confirmations.

## Activate the existing Google backend

The sender is in `backend/customer-email.gs`; handlers/templates are in `backend/forms.gs`. `apps_script.gs` is generated with `npm ci && npm run build:push`, together with the owner-notification source. Edit source files, not the bundle.

1. Open the existing bound MFTNB Apps Script from the lead Sheet. Read and reconcile the live code/schema first. Preserve the Sheet binding, executing account, `TURNSTILE_SECRET`, owner features, office notifications and active `APPS_SCRIPT_URL`.
2. Integrate the sender and templates after a successful row write. Office notifications and owner sign-in codes retain MailApp. There must be only one customer send attempt per successful submission.
3. Set private Script Properties:

   | Property | Value |
   | --- | --- |
   | `CLOUDFLARE_ACCOUNT_ID` | Existing account's 32-character ID |
   | `CLOUDFLARE_EMAIL_API_TOKEN` | Server-only token permitted to send email |
   | `MFTNB_CUSTOMER_EMAIL_PROVIDER` | `cloudflare`, after domain and reply-route checks pass |

   An unset provider or explicit `google` retains the previous Google sender and office Reply-To. Once `cloudflare` is selected, configuration errors and send failures do not silently fall back to a different sender.
4. Note the active version for rollback, then **Deploy → Manage deployments → Edit → New version → Deploy** the same web app. Preserve its URL and access settings. Updated GET health includes `"version":"2026-09-29-cloudflare-email-sheet1"`; the independent `?action=owner-status` check is unchanged.
5. Using an owner-controlled inbox, submit one clearly marked test estimate. Verify the retained Sheet row, office notification, sender address, 24-hour expectation, Chris's phone link, plain-text alternative and travel/crew-plan notes. Check email authentication and actual receipt. Reply once and verify the automatic phone-contact notice. Check owner alerts if enabled. Do not send test leads or messages to real customers.

Rollback uses the previous version of the same Apps Script deployment. Changing the provider property to `google` intentionally restores the old sender, not a branded mailbox. Keep the inbound noreply rule for customers replying to earlier confirmations.

## Failures and loop prevention

- Validation, verification or Sheet-write failures prevent customer email. An office-email failure does not prevent the customer receipt attempt.
- Send failures are logged without the Cloudflare token, request or provider body. A saved estimate still returns `ok: true, confirmationEmailSent: false`; the existing form confirms the saved request without requiring resubmission.
- `confirmationEmailSent: true` means the provider accepted or queued the exact recipient, not guaranteed inbox delivery. Cloudflare errors, redirects, bounces, suppression and ambiguous responses never count as sent. There is no automatic retry that could duplicate a receipt after a timeout.
- Sending accepts one recipient and disables redirects. API credentials never enter browser configuration or form data.
- The reply handler ignores automated/list messages, delivery reports, null senders, own-domain messages, no-reply senders, suppression headers and long reference chains. It marks its response `Auto-Submitted: auto-replied` and `X-Auto-Response-Suppress: All`. It never echoes customer text or forwards the reply to staff.
- Cloudflare enforces valid inbound DMARC, matching sender/recipient and one reply per event. If it refuses a human-message reply, the handler rejects that inbound message with Chris's phone contact. Rejected, spam-filtered or automated mail may not receive a response.

`npm test` covers mocked provider acceptance/failure, preserved saved leads, sender/recipient safety, receipt content, owner flows and reply-loop guards. Tests send no live email.

References: [REST sending](https://developers.cloudflare.com/email-service/api/send-emails/rest-api/), [sender names](https://developers.cloudflare.com/email-service/examples/email-sending/specify-recipients/), [domain setup](https://developers.cloudflare.com/email-service/configuration/domains/), [sending entitlement](https://developers.cloudflare.com/email-service/platform/pricing/), [reply handler](https://developers.cloudflare.com/email-service/api/route-emails/email-handler/), [supported headers](https://developers.cloudflare.com/email-service/reference/headers/), [Google deployment updates](https://developers.google.com/apps-script/concepts/deployments#edit_a_versioned_deployment).
