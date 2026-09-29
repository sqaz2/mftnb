# Customer confirmations and automatic replies

The existing estimator saves the request before attempting its receipt. The receipt includes the submitted move summary, confirmed locations and travel breakdown from the existing crew-plan notes, and:

> We received your estimate request. You can expect to hear back from our team within 24 hours. If you have any questions or your details change, call Chris at (587) 731-0695.

The subject is **We received your estimate request – Moving Forward to New Beginnings**. HTML and plain-text versions identify Moving Forward to New Beginnings and explain that staff review is pending; no price or booking is confirmed. Quick contact messages use the same sender and contact instructions.

When enabled, Cloudflare sends customer confirmations from **noreply@mftnb.com**, with Reply-To set to the same address. Incoming replies receive an automatic notice that the inbox is not monitored, the reply has not been forwarded, and questions or changes should go to Chris by phone. It does not promise a staff response to an unread reply. This handler belongs to the existing estimator repository; the customer workflow and submission endpoint stay unchanged.

## Current activation status

Repository code is ready for configuration. A GitHub/Pages deployment does not activate email or update the running Google Apps Script. On September 29, 2026, the saved Cloudflare token could read `mftnb.com` but received HTTP 403 for DNS and Email Routing settings/rules. No DNS or email settings were changed. Sending entitlement and inbox delivery remain unverified.

The live lead Sheet was also checked: actual submissions were in **Sheet1**, with 14 columns (`submittedAt, name, email, phone, pickup, dropoff, moveDate, timeWindow, homeSize, access, inventory, extras, notes, source`). The repository's `Leads` tab was empty, and the live `/exec` health response was plain `ok`. **Compare the active script before deployment.** Preserve the live Sheet1 mapping and private changes; do not silently move submissions to another tab or paste the repository's 16-column layout over Sheet1. If reconciling the full bundle, align owner inbox readers/reconciliation with the retained live schema too.

## Cloudflare setup

1. Use the existing account and `mftnb.com` zone. The setup credential needs permission to manage DNS, Email Routing settings/rules and Workers scripts. Keep secrets in the existing secret store, never code, logs or chat. The application runtime needs only an Email Sending token, not broad DNS or Worker access.
2. Check Email Sending entitlement. Cloudflare currently requires Workers Paid to send to arbitrary customer addresses. Do not assume the account has it or enable a paid plan without owner approval.
3. In **Compute → Email Service → Email Sending**, onboard `mftnb.com` and verify the provider-issued DNS records. Sending uses `cf-bounce` MX/SPF, `cf-bounce._domainkey` DKIM and `_dmarc`. Inspect existing DNS first and preserve other email services; do not create duplicate SPF/DMARC policies.
4. Enable incoming Email Routing for `mftnb.com`, reviewing its required root MX/SPF and DKIM records and existing inbound rules before changing anything.
5. Deploy `email-worker/worker.mjs` with `email-worker/wrangler.jsonc` to this account as **mftnb-noreply**. It has only an email handler, no public HTTP mail endpoint, no secrets and no database. Worker and preview URLs are disabled. Incoming `message.reply()` provides the reply path without a sending binding.
6. Create an exact Email Routing rule: **noreply@mftnb.com → Send to a Worker: mftnb-noreply**. Do not use a catch-all or replace unrelated rules. Verify this route before enabling outgoing noreply confirmations.

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
4. Note the active version for rollback, then **Deploy → Manage deployments → Edit → New version → Deploy** the same web app. Preserve its URL and access settings. Updated GET health includes `"version":"2026-09-29-cloudflare-email"`; the independent `?action=owner-status` check is unchanged.
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
