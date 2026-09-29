// Customer confirmations only. Office mail and owner sign-in keep their existing sender.
// Enable Cloudflare only after the sending domain and inbound automatic reply are live.
function sendCustomerEmail_(email) {
  const recipient = typeof email.to === 'string' ? email.to.trim() : '';
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i.test(recipient) || recipient.length > 254) {
    throw new Error('Invalid customer email recipient');
  }
  const provider = (SCRIPT_PROPERTIES.getProperty('MFTNB_CUSTOMER_EMAIL_PROVIDER') || '').trim().toLowerCase();
  if (!provider || provider === 'google') {
    MailApp.sendEmail({
      to: recipient, subject: email.subject, body: email.body, htmlBody: email.htmlBody,
      name: 'Moving Forward to New Beginnings', replyTo: OFFICE_EMAIL
    });
    return;
  }
  if (provider !== 'cloudflare') throw new Error('Unsupported customer email provider');

  const accountId = (SCRIPT_PROPERTIES.getProperty('CLOUDFLARE_ACCOUNT_ID') || '').trim();
  const token = (SCRIPT_PROPERTIES.getProperty('CLOUDFLARE_EMAIL_API_TOKEN') || '').trim();
  if (!/^[a-f0-9]{32}$/i.test(accountId) || !token || /\s/.test(token)) {
    throw new Error('Cloudflare customer email is not configured');
  }
  let response;
  try {
    response = UrlFetchApp.fetch('https://api.cloudflare.com/client/v4/accounts/' + accountId + '/email/sending/send', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true, followRedirects: false,
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify({
        to: recipient,
        from: { address: 'noreply@mftnb.com', name: 'Moving Forward to New Beginnings' },
        reply_to: 'noreply@mftnb.com',
        subject: email.subject, text: email.body, html: email.htmlBody,
        headers: { 'Auto-Submitted': 'auto-generated', 'X-Auto-Response-Suppress': 'All' }
      })
    });
  } catch (err) {
    // Provider errors can contain request data. Never log the request, token, or raw response.
    throw new Error('Cloudflare customer email request failed');
  }
  const status = response.getResponseCode();
  if (status < 200 || status >= 300) {
    throw new Error('Cloudflare customer email HTTP ' + status);
  }
  let data;
  try {
    data = JSON.parse(response.getContentText());
  } catch (err) {
    throw new Error('Invalid Cloudflare customer email response');
  }
  const result = data && data.result;
  function includesRecipient(list) {
    return Array.isArray(list) && list.some(function(address) {
      return typeof address === 'string' && address.toLowerCase() === recipient.toLowerCase();
    });
  }
  if (!data || data.success !== true || !result ||
      includesRecipient(result.permanent_bounces) || includesRecipient(result.suppressed_recipients) ||
      (!includesRecipient(result.delivered) && !includesRecipient(result.queued))) {
    throw new Error('Cloudflare did not accept the customer email recipient');
  }
  // Accepted or queued by the provider; inbox delivery is not guaranteed.
}
