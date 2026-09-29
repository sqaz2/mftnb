# Customer estimate receipts

The existing Google Apps Script backend saves the estimate request to the `Leads` sheet, then sends the office notification and customer receipt. The receipt contains the submitted move summary, confirmed locations and travel details from the existing plan notes, and this message:

> We received your estimate request. You can expect to hear back from our team within 24 hours. If you have any questions, call Chris at (587) 731-0695.

The subject is **We received your estimate request – Moving Forward to New Beginnings**. Both HTML and plain-text versions are provided. The sender display name is Moving Forward to New Beginnings, and replies go to `info@mftnb.ca`; the sending account remains the account executing the existing Apps Script. This is a receipt for staff review, with no confirmed price or booking.

## Update the existing deployment

GitHub and Cloudflare publish the website files only. They do not update the running Google Apps Script. The email changes require this separate deployment step in the **existing** backend project:

1. Open the existing MFTNB leads spreadsheet, then **Extensions → Apps Script**. Compare its code with `apps_script.gs` and apply the changes while preserving any project-only customizations. Keep the existing spreadsheet binding and Script Properties, including `TURNSTILE_SECRET`.
2. Save the code. Open **Deploy → Manage deployments**, select the active web app used by `APPS_SCRIPT_URL` in `script.js`, and note its current version for rollback.
3. Click **Edit**, select **New version**, and deploy. Keep the existing deployment URL, executing account, and access settings. Do not create a different web app or change the website endpoint for this update.
4. Open that existing `/exec` URL with a GET request. The response should include `"version":"2026-09-29-estimate-receipt"`. This verifies the code version without creating a lead or sending an email.
5. Submit one clearly marked test estimate using an email inbox you control. Verify the Sheet row, office email, customer subject, 24-hour message, Chris's phone link, and reply-to address. Check the plain-text alternative and spam folder if needed. This live inbox check is separate from the mocked regression tests.

To roll back, edit the same deployment and select the previous version. The endpoint stays the same.

## Failure handling

- Validation or a Sheet write failure prevents a receipt from being sent.
- An office email failure does not prevent the customer receipt attempt.
- A customer email failure is logged in Apps Script Executions. The saved request still returns `ok: true` with `confirmationEmailSent: false`, so the form confirms receipt and explains that the email could not be sent. It tells the customer they do not need to submit again.
- `confirmationEmailSent: true` means MailApp accepted the send, not that inbox delivery is guaranteed. The website does not claim delivery.
- An older backend response without this flag still works; the website confirms the saved request without claiming an email was sent.

Google references: [MailApp](https://developers.google.com/apps-script/reference/mail/mail-app) and [updating an existing deployment](https://developers.google.com/apps-script/concepts/deployments#edit_a_versioned_deployment).
