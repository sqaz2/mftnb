// Google Apps Script backend for Moving Forward to New Beginnings
// Handles chat-style estimate submissions and quick contact messages.

const ESTIMATE_SHEET_NAME = 'Leads';
const QUICK_SHEET_NAME = 'Quick Messages';
const OFFICE_EMAIL = 'info@mftnb.ca';
const CUSTOMER_SUBJECT = 'We received your message – Moving Forward to New Beginnings';
const TURNSTILE_SECRET = '0x4AAAAAAB2kYsZYtF1wgSrfu8k7BEI0OMw';

function doOptions() {
  return respond({ ok: true }, 200);
}

function doGet() {
  return respond({ ok: true, service: 'mftnb-apps-script' });
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      throw new Error('Missing request body');
    }
    const body = JSON.parse(e.postData.contents);
    const formType = body.formType;
    if (!formType) throw new Error('Missing formType');
    const token = body.turnstileToken;
    const expectedAction = formType === 'estimate' ? 'estimate' : (formType === 'quick-message' ? 'quick_message' : '');
    const verification = verifyTurnstile(token, e, expectedAction);
    if (!verification.success) {
      return respond({ ok: false, error: 'Human verification failed.' }, 400);
    }

    if (formType === 'estimate') {
      const record = handleEstimateSubmission(body);
      return respond({ ok: true, row: record.rowNumber });
    }

    if (formType === 'quick-message') {
      handleQuickMessageSubmission(body);
      return respond({ ok: true });
    }

    throw new Error('Unsupported formType');
  } catch (err) {
    console.error('Error in doPost', err);
    return respond({ ok: false, error: err.message || String(err) }, 500);
  }
}

function handleEstimateSubmission(body) {
  const requiredFields = ['name', 'email', 'phone', 'pickup', 'dropoff'];
  requiredFields.forEach(field => {
    if (!body[field]) {
      throw new Error('Missing required field: ' + field);
    }
  });

  const sheet = getOrCreateSheet(ESTIMATE_SHEET_NAME);
  const timestamp = new Date();
  const extras = Array.isArray(body.extras) ? body.extras.join(', ') : '';
  const row = [
    timestamp,
    body.name || '',
    body.email || '',
    body.phone || '',
    body.pickup || '',
    body.dropoff || '',
    body.moveDate || '',
    body.timeWindow || '',
    body.homeType || body.homeSize || '',
    body.bedrooms || '',
    body.access || '',
    body.inventory || '',
    extras,
    body.notes || '',
    body.source || '',
    body.consent === true ? 'Yes' : 'No'
  ];
  sheet.appendRow(row);
  const rowNumber = sheet.getLastRow();

  const officeHtml = buildEstimateHtml(body, timestamp, rowNumber);
  try {
    MailApp.sendEmail({
      to: OFFICE_EMAIL,
      subject: `New moving estimate from ${body.name}`,
      htmlBody: officeHtml
    });
  } catch (err) {
    console.error('Unable to email office copy', err);
  }

  if (body.email) {
    const customerHtml = buildCustomerEstimateHtml(body, timestamp);
    try {
      MailApp.sendEmail({
        to: body.email,
        subject: 'Thanks for reaching out to Moving Forward to New Beginnings',
        htmlBody: customerHtml,
        replyTo: OFFICE_EMAIL
      });
    } catch (err) {
      console.error('Unable to send customer confirmation', err);
    }
  }

  return { rowNumber };
}

function handleQuickMessageSubmission(body) {
  if (!body.name) throw new Error('Missing name');
  if (!body.message) throw new Error('Missing message');

  const sheet = getOrCreateSheet(QUICK_SHEET_NAME);
  const timestamp = new Date();
  sheet.appendRow([
    timestamp,
    body.name || '',
    body.email || '',
    body.phone || '',
    body.message || '',
    body.source || ''
  ]);

  const officeBody = `
    <p><strong>New quick message received:</strong></p>
    <ul>
      <li><strong>Name:</strong> ${sanitize(body.name)}</li>
      <li><strong>Email:</strong> ${sanitize(body.email || 'N/A')}</li>
      <li><strong>Phone:</strong> ${sanitize(body.phone || 'N/A')}</li>
      <li><strong>Message:</strong><br />${sanitize(body.message).replace(/\n/g, '<br />')}</li>
    </ul>
  `;

  try {
    MailApp.sendEmail({
      to: OFFICE_EMAIL,
      subject: `Quick message from ${body.name}`,
      htmlBody: officeBody
    });
  } catch (err) {
    console.error('Unable to email quick message', err);
  }

  if (body.email) {
    const customerBody = `
      <p>Hi ${sanitize(body.name)},</p>
      <p>Thanks for getting in touch with Moving Forward to New Beginnings. We received your note and will reply shortly.</p>
      <p><strong>Your message:</strong><br />${sanitize(body.message).replace(/\n/g, '<br />')}</p>
      <p>If anything changes, call or text us at <a href="tel:+15877310695">(587) 731-0695</a>.</p>
      <p>— Chris Ehret &amp; the MFTNB team</p>
    `;
    try {
      MailApp.sendEmail({
        to: body.email,
        subject: CUSTOMER_SUBJECT,
        htmlBody: customerBody,
        replyTo: OFFICE_EMAIL
      });
    } catch (err) {
      console.error('Unable to send quick message confirmation', err);
    }
  }
}

function verifyTurnstile(token, e, expectedAction) {
  if (!token) {
    return { success: false };
  }
  const remoteip = e && e.context ? e.context.clientIp : '';
  const payload = {
    secret: TURNSTILE_SECRET,
    response: token
  };
  if (remoteip) {
    payload.remoteip = remoteip;
  }
  const response = UrlFetchApp.fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'post',
    payload,
    muteHttpExceptions: true
  });
  const data = JSON.parse(response.getContentText() || '{}');
  if (!data.success) {
    console.error('Turnstile verification failed', data['error-codes']);
    return { success: false };
  }
  if (expectedAction && data.action && data.action !== expectedAction) {
    console.warn('Unexpected Turnstile action', data.action, 'expected', expectedAction);
  }
  return data;
}

function buildEstimateHtml(body, timestamp, rowNumber) {
  const extras = Array.isArray(body.extras) && body.extras.length ? body.extras.join(', ') : 'None';
  return `
    <h2>New moving estimate (row ${rowNumber})</h2>
    <p><strong>Received:</strong> ${timestamp}</p>
    <table border="0" cellpadding="6" cellspacing="0" style="border-collapse:collapse;">
      <tbody>
        <tr><td><strong>Name</strong></td><td>${sanitize(body.name)}</td></tr>
        <tr><td><strong>Email</strong></td><td>${sanitize(body.email)}</td></tr>
        <tr><td><strong>Phone</strong></td><td>${sanitize(body.phone)}</td></tr>
        <tr><td><strong>Moving from</strong></td><td>${sanitize(body.pickup)}</td></tr>
        <tr><td><strong>Moving to</strong></td><td>${sanitize(body.dropoff)}</td></tr>
        <tr><td><strong>Move date</strong></td><td>${sanitize(body.moveDate || 'Flexible')}</td></tr>
        <tr><td><strong>Preferred time</strong></td><td>${sanitize(body.timeWindow || 'Flexible')}</td></tr>
        <tr><td><strong>Home type</strong></td><td>${sanitize(body.homeType || body.homeSize || '')}</td></tr>
        <tr><td><strong>Bedrooms</strong></td><td>${sanitize(body.bedrooms || '')}</td></tr>
        <tr><td><strong>Access details</strong></td><td>${sanitize(body.access || '')}</td></tr>
        <tr><td><strong>Special items</strong></td><td>${sanitize(body.inventory || '')}</td></tr>
        <tr><td><strong>Extras</strong></td><td>${sanitize(extras)}</td></tr>
        <tr><td><strong>Notes</strong></td><td>${sanitize(body.notes || '')}</td></tr>
        <tr><td><strong>Source</strong></td><td>${sanitize(body.source || '')}</td></tr>
      </tbody>
    </table>
  `;
}

function buildCustomerEstimateHtml(body, timestamp) {
  const extras = Array.isArray(body.extras) && body.extras.length ? body.extras.join(', ') : 'None';
  return `
    <p>Hi ${sanitize(body.name)},</p>
    <p>Thank you for reaching out to Moving Forward to New Beginnings. We received your moving details on <strong>${timestamp.toLocaleString()}</strong> and will follow up shortly with next steps.</p>
    <h3>Your summary</h3>
    <ul>
      <li><strong>Move date:</strong> ${sanitize(body.moveDate || 'Flexible')}</li>
      <li><strong>From:</strong> ${sanitize(body.pickup)}</li>
      <li><strong>To:</strong> ${sanitize(body.dropoff)}</li>
      <li><strong>Home type &amp; rooms:</strong> ${sanitize([body.homeType || body.homeSize || '', body.bedrooms || ''].filter(Boolean).join(' · ') || 'Details pending')}</li>
      <li><strong>Access details:</strong> ${sanitize(body.access || 'Provided verbally')}</li>
      <li><strong>Special items:</strong> ${sanitize(body.inventory || 'None noted')}</li>
      <li><strong>Extra services:</strong> ${sanitize(extras)}</li>
      <li><strong>Additional notes:</strong> ${sanitize(body.notes || 'None')}</li>
    </ul>
    <p>If anything changes, reply to this email or call/text <a href="tel:+15877310695">(587) 731-0695</a>.</p>
    <p>With gratitude,<br />Chris Ehret &amp; the MFTNB team</p>
  `;
}

function getOrCreateSheet(name) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(name);
  }
  return sheet;
}

function sanitize(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function respond(obj, code) {
  const output = ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
  output.setHeaders({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  if (typeof code === 'number') {
    output.setResponseCode(code);
  }
  return output;
}
