// Google Apps Script backend for Moving Forward to New Beginnings
// Handles chat-style estimate submissions, quick contact messages, donation pickups, and junk removal.

const ESTIMATE_SHEET_NAME = 'Leads';
const QUICK_SHEET_NAME = 'Quick Messages';
const DONATION_SHEET_NAME = 'Donation Pickups';
const JUNK_SHEET_NAME = 'Junk Removal';
const FURNITURE_INVENTORY_SHEET_NAME = 'Furniture Inventory';
const CORPORATE_DONOR_SHEET_NAME = 'Corporate Donors';

const OFFICE_EMAIL = 'info@mftnb.ca';
const CUSTOMER_SUBJECT = 'We received your message – Moving Forward to New Beginnings';
const SCRIPT_PROPERTIES = PropertiesService.getScriptProperties();
const TURNSTILE_SECRET_PROPERTY = 'TURNSTILE_SECRET';
const TURNSTILE_SECRET_FALLBACK = '';

function getTurnstileSecret() {
  const propertySecret = SCRIPT_PROPERTIES.getProperty(TURNSTILE_SECRET_PROPERTY);
  if (propertySecret) {
    const trimmedProperty = propertySecret.trim();
    if (trimmedProperty) {
      return trimmedProperty;
    }
  }
  if (TURNSTILE_SECRET_FALLBACK) {
    const trimmedFallback = String(TURNSTILE_SECRET_FALLBACK).trim();
    if (trimmedFallback) {
      return trimmedFallback;
    }
  }
  return '';
}

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
    const expectedAction = getExpectedAction(formType);
    const verification = verifyTurnstile(token, e, expectedAction);
    
    if (verification.configError) {
      return respond({
        ok: false,
        error: 'Verification service unavailable.',
        detail: verification.error || null
      }, 500);
    }
    if (!verification.success) {
      const failBody = { ok: false, error: 'Human verification failed.' };
      if (verification.error) {
        failBody.detail = verification.error;
      }
      if (verification.errorCodes && verification.errorCodes.length) {
        failBody.errorCodes = verification.errorCodes;
      }
      return respond(failBody, 400);
    }

    // Route to appropriate handler
    if (formType === 'estimate') {
      const record = handleEstimateSubmission(body);
      return respond({ ok: true, row: record.rowNumber });
    }

    if (formType === 'quick-message') {
      handleQuickMessageSubmission(body);
      return respond({ ok: true });
    }

    if (formType === 'donation-pickup') {
      const record = handleDonationPickup(body);
      return respond({ ok: true, row: record.rowNumber });
    }

    if (formType === 'junk-removal') {
      const record = handleJunkRemoval(body);
      return respond({ ok: true, row: record.rowNumber });
    }

    if (formType === 'corporate-donor') {
      const record = handleCorporateDonor(body);
      return respond({ ok: true, row: record.rowNumber });
    }

    throw new Error('Unsupported formType');
  } catch (err) {
    console.error('Error in doPost', err);
    return respond({ ok: false, error: err.message || String(err) }, 500);
  }
}

function getExpectedAction(formType) {
  const actionMap = {
    'estimate': 'estimate',
    'quick-message': 'quick_message',
    'donation-pickup': 'donation_pickup',
    'junk-removal': 'junk_removal',
    'corporate-donor': 'corporate_donor'
  };
  return actionMap[formType] || '';
}

// NEW: Handle donation pickup requests
function handleDonationPickup(body) {
  const requiredFields = ['name', 'phone', 'address'];
  for (var i = 0; i < requiredFields.length; i++) {
    var field = requiredFields[i];
    if (!body[field]) {
      throw new Error('Missing required field: ' + field);
    }
  }

  const sheet = getOrCreateSheet(DONATION_SHEET_NAME);
  const timestamp = new Date();
  
  const row = [
    timestamp,
    body.name || '',
    body.email || '',
    body.phone || '',
    body.address || '',
    body.pickupDate || '',
    body.timeWindow || '',
    body.itemDescription || '',
    body.itemCondition || '',
    body.photos || '',
    body.access || '',
    body.notes || '',
    'Pending' // Status column
  ];
  sheet.appendRow(row);
  const rowNumber = sheet.getLastRow();

  // Email to office
  const officeHtml = buildDonationOfficeHtml(body, timestamp, rowNumber);
  try {
    MailApp.sendEmail({
      to: OFFICE_EMAIL,
      subject: 'New furniture donation pickup request from ' + (body.name || 'Unknown'),
      htmlBody: officeHtml
    });
  } catch (err) {
    console.error('Unable to email donation pickup to office', err);
  }

  // Confirmation email to donor
  if (body.email) {
    const customerHtml = buildDonationCustomerHtml(body, timestamp);
    try {
      MailApp.sendEmail({
        to: body.email,
        subject: 'Thank you for donating furniture - MFTNB',
        htmlBody: customerHtml,
        replyTo: OFFICE_EMAIL
      });
    } catch (err) {
      console.error('Unable to send donation confirmation', err);
    }
  }

  return { rowNumber: rowNumber };
}

// NEW: Handle junk removal requests
function handleJunkRemoval(body) {
  const requiredFields = ['name', 'phone', 'address'];
  for (var i = 0; i < requiredFields.length; i++) {
    var field = requiredFields[i];
    if (!body[field]) {
      throw new Error('Missing required field: ' + field);
    }
  }

  const sheet = getOrCreateSheet(JUNK_SHEET_NAME);
  const timestamp = new Date();
  
  const row = [
    timestamp,
    body.name || '',
    body.email || '',
    body.phone || '',
    body.address || '',
    body.serviceDate || '',
    body.timeWindow || '',
    body.junkDescription || '',
    body.estimatedVolume || '',
    body.access || '',
    body.notes || '',
    'Pending' // Status column
  ];
  sheet.appendRow(row);
  const rowNumber = sheet.getLastRow();

  // Email to office
  const officeHtml = buildJunkRemovalOfficeHtml(body, timestamp, rowNumber);
  try {
    MailApp.sendEmail({
      to: OFFICE_EMAIL,
      subject: 'New junk removal request from ' + (body.name || 'Unknown'),
      htmlBody: officeHtml
    });
  } catch (err) {
    console.error('Unable to email junk removal to office', err);
  }

  // Confirmation email to customer
  if (body.email) {
    const customerHtml = buildJunkRemovalCustomerHtml(body, timestamp);
    try {
      MailApp.sendEmail({
        to: body.email,
        subject: 'Your junk removal request - MFTNB',
        htmlBody: customerHtml,
        replyTo: OFFICE_EMAIL
      });
    } catch (err) {
      console.error('Unable to send junk removal confirmation', err);
    }
  }

  return { rowNumber: rowNumber };
}

// NEW: Handle corporate donor sponsorship
function handleCorporateDonor(body) {
  const requiredFields = ['companyName', 'contactName', 'email', 'phone'];
  for (var i = 0; i < requiredFields.length; i++) {
    var field = requiredFields[i];
    if (!body[field]) {
      throw new Error('Missing required field: ' + field);
    }
  }

  const sheet = getOrCreateSheet(CORPORATE_DONOR_SHEET_NAME);
  const timestamp = new Date();
  
  const row = [
    timestamp,
    body.companyName || '',
    body.contactName || '',
    body.email || '',
    body.phone || '',
    body.donationType || '', // 'furniture', 'moving-services', 'both'
    body.furnitureItems || '',
    body.estimatedValue || '',
    body.sponsorshipInterest || '',
    body.notes || '',
    'New Lead' // Status column
  ];
  sheet.appendRow(row);
  const rowNumber = sheet.getLastRow();

  // Email to office
  const officeHtml = buildCorporateDonorOfficeHtml(body, timestamp, rowNumber);
  try {
    MailApp.sendEmail({
      to: OFFICE_EMAIL,
      subject: 'Corporate donation inquiry from ' + (body.companyName || 'Unknown company'),
      htmlBody: officeHtml
    });
  } catch (err) {
    console.error('Unable to email corporate donor inquiry', err);
  }

  // Confirmation email to company
  if (body.email) {
    const customerHtml = buildCorporateDonorCustomerHtml(body, timestamp);
    try {
      MailApp.sendEmail({
        to: body.email,
        subject: 'Thank you for your corporate giving inquiry - MFTNB',
        htmlBody: customerHtml,
        replyTo: OFFICE_EMAIL
      });
    } catch (err) {
      console.error('Unable to send corporate donor confirmation', err);
    }
  }

  return { rowNumber: rowNumber };
}

// Email builders for donation pickup
function buildDonationOfficeHtml(body, timestamp, rowNumber) {
  const lines = [];
  lines.push('<h2>New Donation Pickup Request (row ' + rowNumber + ')</h2>');
  lines.push('<p><strong>Received:</strong> ' + timestamp + '</p>');
  lines.push('<table border="0" cellpadding="6" cellspacing="0" style="border-collapse:collapse;">');
  lines.push('  <tbody>');
  lines.push('    <tr><td><strong>Name</strong></td><td>' + sanitize(body.name) + '</td></tr>');
  lines.push('    <tr><td><strong>Email</strong></td><td>' + sanitize(body.email || 'N/A') + '</td></tr>');
  lines.push('    <tr><td><strong>Phone</strong></td><td>' + sanitize(body.phone) + '</td></tr>');
  lines.push('    <tr><td><strong>Pickup Address</strong></td><td>' + sanitize(body.address) + '</td></tr>');
  lines.push('    <tr><td><strong>Preferred Date</strong></td><td>' + sanitize(body.pickupDate || 'Flexible') + '</td></tr>');
  lines.push('    <tr><td><strong>Time Window</strong></td><td>' + sanitize(body.timeWindow || 'Flexible') + '</td></tr>');
  lines.push('    <tr><td><strong>Item Description</strong></td><td>' + sanitize(body.itemDescription || '') + '</td></tr>');
  lines.push('    <tr><td><strong>Condition</strong></td><td>' + sanitize(body.itemCondition || '') + '</td></tr>');
  lines.push('    <tr><td><strong>Photos</strong></td><td>' + sanitize(body.photos || 'None provided') + '</td></tr>');
  lines.push('    <tr><td><strong>Access Details</strong></td><td>' + sanitize(body.access || '') + '</td></tr>');
  lines.push('    <tr><td><strong>Notes</strong></td><td>' + sanitize(body.notes || '') + '</td></tr>');
  lines.push('  </tbody>');
  lines.push('</table>');
  return lines.join('\n');
}

function buildDonationCustomerHtml(body, timestamp) {
  const lines = [];
  lines.push('<p>Hi ' + sanitize(body.name) + ',</p>');
  lines.push('<p>Thank you for donating furniture to Moving Forward to New Beginnings! Your generosity helps families starting over.</p>');
  lines.push('<h3>Pickup Request Summary</h3>');
  lines.push('<ul>');
  lines.push('  <li><strong>Pickup address:</strong> ' + sanitize(body.address) + '</li>');
  lines.push('  <li><strong>Preferred date:</strong> ' + sanitize(body.pickupDate || 'Flexible') + '</li>');
  lines.push('  <li><strong>Items:</strong> ' + sanitize(body.itemDescription || 'See notes') + '</li>');
  lines.push('  <li><strong>Condition:</strong> ' + sanitize(body.itemCondition || 'To be assessed') + '</li>');
  lines.push('</ul>');
  lines.push('<p>We'll review your donation and contact you within 1-2 business days to schedule pickup. We only accept quality furniture in good condition that we can rehome to families in need.</p>');
  lines.push('<p>Questions? Call or text <a href="tel:+15877310695">(587) 731-0695</a>.</p>');
  lines.push('<p>With gratitude,<br />Chris Ehret &amp; the MFTNB team</p>');
  return lines.join('\n');
}

// Email builders for junk removal
function buildJunkRemovalOfficeHtml(body, timestamp, rowNumber) {
  const lines = [];
  lines.push('<h2>New Junk Removal Request (row ' + rowNumber + ')</h2>');
  lines.push('<p><strong>Received:</strong> ' + timestamp + '</p>');
  lines.push('<table border="0" cellpadding="6" cellspacing="0" style="border-collapse:collapse;">');
  lines.push('  <tbody>');
  lines.push('    <tr><td><strong>Name</strong></td><td>' + sanitize(body.name) + '</td></tr>');
  lines.push('    <tr><td><strong>Email</strong></td><td>' + sanitize(body.email || 'N/A') + '</td></tr>');
  lines.push('    <tr><td><strong>Phone</strong></td><td>' + sanitize(body.phone) + '</td></tr>');
  lines.push('    <tr><td><strong>Service Address</strong></td><td>' + sanitize(body.address) + '</td></tr>');
  lines.push('    <tr><td><strong>Preferred Date</strong></td><td>' + sanitize(body.serviceDate || 'Flexible') + '</td></tr>');
  lines.push('    <tr><td><strong>Time Window</strong></td><td>' + sanitize(body.timeWindow || 'Flexible') + '</td></tr>');
  lines.push('    <tr><td><strong>Items to Remove</strong></td><td>' + sanitize(body.junkDescription || '') + '</td></tr>');
  lines.push('    <tr><td><strong>Estimated Volume</strong></td><td>' + sanitize(body.estimatedVolume || '') + '</td></tr>');
  lines.push('    <tr><td><strong>Access Details</strong></td><td>' + sanitize(body.access || '') + '</td></tr>');
  lines.push('    <tr><td><strong>Notes</strong></td><td>' + sanitize(body.notes || '') + '</td></tr>');
  lines.push('  </tbody>');
  lines.push('</table>');
  return lines.join('\n');
}

function buildJunkRemovalCustomerHtml(body, timestamp) {
  const lines = [];
  lines.push('<p>Hi ' + sanitize(body.name) + ',</p>');
  lines.push('<p>Thank you for requesting junk removal services from Moving Forward to New Beginnings. We'll handle your unwanted items responsibly.</p>');
  lines.push('<h3>Service Request Summary</h3>');
  lines.push('<ul>');
  lines.push('  <li><strong>Service address:</strong> ' + sanitize(body.address) + '</li>');
  lines.push('  <li><strong>Preferred date:</strong> ' + sanitize(body.serviceDate || 'Flexible') + '</li>');
  lines.push('  <li><strong>Items to remove:</strong> ' + sanitize(body.junkDescription || 'See notes') + '</li>');
  lines.push('  <li><strong>Estimated volume:</strong> ' + sanitize(body.estimatedVolume || 'To be assessed') + '</li>');
  lines.push('</ul>');
  lines.push('<p>Our team will contact you within 1 business day with a quote and to schedule your service.</p>');
  lines.push('<p>Questions? Call or text <a href="tel:+15877310695">(587) 731-0695</a>.</p>');
  lines.push('<p>Best regards,<br />Chris Ehret &amp; the MFTNB team</p>');
  return lines.join('\n');
}

// Email builders for corporate donors
function buildCorporateDonorOfficeHtml(body, timestamp, rowNumber) {
  const lines = [];
  lines.push('<h2>Corporate Donation Inquiry (row ' + rowNumber + ')</h2>');
  lines.push('<p><strong>Received:</strong> ' + timestamp + '</p>');
  lines.push('<table border="0" cellpadding="6" cellspacing="0" style="border-collapse:collapse;">');
  lines.push('  <tbody>');
  lines.push('    <tr><td><strong>Company Name</strong></td><td>' + sanitize(body.companyName) + '</td></tr>');
  lines.push('    <tr><td><strong>Contact Name</strong></td><td>' + sanitize(body.contactName) + '</td></tr>');
  lines.push('    <tr><td><strong>Email</strong></td><td>' + sanitize(body.email) + '</td></tr>');
  lines.push('    <tr><td><strong>Phone</strong></td><td>' + sanitize(body.phone) + '</td></tr>');
  lines.push('    <tr><td><strong>Donation Type</strong></td><td>' + sanitize(body.donationType || '') + '</td></tr>');
  lines.push('    <tr><td><strong>Furniture Items</strong></td><td>' + sanitize(body.furnitureItems || 'N/A') + '</td></tr>');
  lines.push('    <tr><td><strong>Estimated Value</strong></td><td>' + sanitize(body.estimatedValue || 'N/A') + '</td></tr>');
  lines.push('    <tr><td><strong>Sponsorship Interest</strong></td><td>' + sanitize(body.sponsorshipInterest || 'N/A') + '</td></tr>');
  lines.push('    <tr><td><strong>Notes</strong></td><td>' + sanitize(body.notes || '') + '</td></tr>');
  lines.push('  </tbody>');
  lines.push('</table>');
  return lines.join('\n');
}

function buildCorporateDonorCustomerHtml(body, timestamp) {
  const lines = [];
  lines.push('<p>Hi ' + sanitize(body.contactName) + ',</p>');
  lines.push('<p>Thank you for ' + sanitize(body.companyName) + '\'s interest in supporting Moving Forward to New Beginnings through corporate giving.</p>');
  lines.push('<p>Your inquiry has been received and our team will reach out within 1-2 business days to discuss how we can work together to support families in need.</p>');
  lines.push('<h3>Ways to Partner</h3>');
  lines.push('<ul>');
  lines.push('  <li><strong>Furniture donations:</strong> Help us furnish homes for families starting over</li>');
  lines.push('  <li><strong>Sponsored moves:</strong> Cover moving costs for a family fleeing domestic violence</li>');
  lines.push('  <li><strong>Ongoing partnership:</strong> Regular support that keeps our rescue move program running</li>');
  lines.push('</ul>');
  lines.push('<p>Questions? Contact us at <a href="mailto:info@mftnb.ca">info@mftnb.ca</a> or <a href="tel:+15877310695">(587) 731-0695</a>.</p>');
  lines.push('<p>With gratitude,<br />Chris Ehret<br />Founder, Moving Forward to New Beginnings</p>');
  return lines.join('\n');
}

// Keep all existing functions below (handleEstimateSubmission, handleQuickMessageSubmission, etc.)
// I'm omitting them here for brevity but they stay exactly as they are in your original code

function handleEstimateSubmission(body) {
  const requiredFields = ['name', 'email', 'phone', 'pickup', 'dropoff'];
  for (var i = 0; i < requiredFields.length; i++) {
    var field = requiredFields[i];
    if (!body[field]) {
      throw new Error('Missing required field: ' + field);
    }
  }

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
  var officeSubjectName = body.name ? String(body.name) : '';
  if (officeSubjectName) {
    officeSubjectName = officeSubjectName.trim();
  }
  if (!officeSubjectName) {
    officeSubjectName = 'Unknown contact';
  }
  try {
    MailApp.sendEmail({
      to: OFFICE_EMAIL,
      subject: 'New moving estimate from ' + officeSubjectName,
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

  return { rowNumber: rowNumber };
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

  const sanitizedMessage = sanitize(body.message).replace(/\n/g, '<br />');
  const officeBodyLines = [
    '<p><strong>New quick message received:</strong></p>',
    '<ul>',
    '  <li><strong>Name:</strong> ' + sanitize(body.name) + '</li>',
    '  <li><strong>Email:</strong> ' + sanitize(body.email || 'N/A') + '</li>',
    '  <li><strong>Phone:</strong> ' + sanitize(body.phone || 'N/A') + '</li>',
    '  <li><strong>Message:</strong><br />' + sanitizedMessage + '</li>',
    '</ul>'
  ];
  const officeBody = officeBodyLines.join('\n');
  var quickSubjectName = body.name ? String(body.name) : '';
  if (quickSubjectName) {
    quickSubjectName = quickSubjectName.trim();
  }
  if (!quickSubjectName) {
    quickSubjectName = 'Unknown contact';
  }

  try {
    MailApp.sendEmail({
      to: OFFICE_EMAIL,
      subject: 'Quick message from ' + quickSubjectName,
      htmlBody: officeBody
    });
  } catch (err) {
    console.error('Unable to email quick message', err);
  }

  if (body.email) {
    const customerBodyLines = [
      '<p>Hi ' + sanitize(body.name) + ',</p>',
      '<p>Thanks for getting in touch with Moving Forward to New Beginnings. We received your note and will reply shortly.</p>',
      '<p><strong>Your message:</strong><br />' + sanitizedMessage + '</p>',
      '<p>If anything changes, call or text us at <a href="tel:+15877310695">(587) 731-0695</a>.</p>',
      '<p>– Chris Ehret &amp; the MFTNB team</p>'
    ];
    const customerBody = customerBodyLines.join('\n');
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
    return { success: false, error: 'missing-token' };
  }

  const secret = getTurnstileSecret();
  if (!secret) {
    console.error('Turnstile secret is not configured. Set TURNSTILE_SECRET in Script Properties.');
    return { success: false, configError: true, error: 'missing-secret' };
  }

  const remoteip = e && e.context ? e.context.clientIp : '';
  const payload = {
    secret: secret,
    response: token
  };
  if (remoteip) {
    payload.remoteip = remoteip;
  }

  let response;
  try {
    response = UrlFetchApp.fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'post',
      payload,
      muteHttpExceptions: true
    });
  } catch (err) {
    console.error('Turnstile verification request failed', err);
    return { success: false, error: 'fetch-error' };
  }

  let data;
  try {
    data = JSON.parse(response.getContentText() || '{}');
  } catch (err) {
    console.error('Unable to parse Turnstile response', err);
    return { success: false, error: 'parse-error' };
  }

  const status = typeof response.getResponseCode === 'function' ? response.getResponseCode() : 0;
  if (status && status !== 200) {
    console.error('Turnstile verification returned status', status, data);
  }

  if (!data.success) {
    console.error('Turnstile verification failed', data['error-codes']);
    return {
      success: false,
      error: 'turnstile-failed',
      errorCodes: Array.isArray(data['error-codes']) ? data['error-codes'] : []
    };
  }

  if (expectedAction && data.action && data.action !== expectedAction) {
    console.warn('Unexpected Turnstile action', data.action, 'expected', expectedAction);
  }

  return data;
}

function buildEstimateHtml(body, timestamp, rowNumber) {
  const extras = Array.isArray(body.extras) && body.extras.length ? body.extras.join(', ') : 'None';
  const lines = [];
  lines.push('<h2>New moving estimate (row ' + rowNumber + ')</h2>');
  lines.push('<p><strong>Received:</strong> ' + timestamp + '</p>');
  lines.push('<table border="0" cellpadding="6" cellspacing="0" style="border-collapse:collapse;">');
  lines.push('  <tbody>');
  lines.push('    <tr><td><strong>Name</strong></td><td>' + sanitize(body.name) + '</td></tr>');
  lines.push('    <tr><td><strong>Email</strong></td><td>' + sanitize(body.email) + '</td></tr>');
  lines.push('    <tr><td><strong>Phone</strong></td><td>' + sanitize(body.phone) + '</td></tr>');
  lines.push('    <tr><td><strong>Moving from</strong></td><td>' + sanitize(body.pickup) + '</td></tr>');
  lines.push('    <tr><td><strong>Moving to</strong></td><td>' + sanitize(body.dropoff) + '</td></tr>');
  lines.push('    <tr><td><strong>Move date</strong></td><td>' + sanitize(body.moveDate || 'Flexible') + '</td></tr>');
  lines.push('    <tr><td><strong>Preferred time</strong></td><td>' + sanitize(body.timeWindow || 'Flexible') + '</td></tr>');
  lines.push('    <tr><td><strong>Home type</strong></td><td>' + sanitize(body.homeType || body.homeSize || '') + '</td></tr>');
  lines.push('    <tr><td><strong>Bedrooms</strong></td><td>' + sanitize(body.bedrooms || '') + '</td></tr>');
  lines.push('    <tr><td><strong>Access details</strong></td><td>' + sanitize(body.access || '') + '</td></tr>');
  lines.push('    <tr><td><strong>Special items</strong></td><td>' + sanitize(body.inventory || '') + '</td></tr>');
  lines.push('    <tr><td><strong>Extras</strong></td><td>' + sanitize(extras) + '</td></tr>');
  lines.push('    <tr><td><strong>Notes</strong></td><td>' + sanitize(body.notes || '') + '</td></tr>');
  lines.push('    <tr><td><strong>Source</strong></td><td>' + sanitize(body.source || '') + '</td></tr>');
  lines.push('  </tbody>');
  lines.push('</table>');
  return lines.join('\n');
}

function buildCustomerEstimateHtml(body, timestamp) {
  const extras = Array.isArray(body.extras) && body.extras.length ? body.extras.join(', ') : 'None';
  const summaryParts = [];
  if (body.homeType || body.homeSize) {
    summaryParts.push(body.homeType || body.homeSize);
  }
  if (body.bedrooms) {
    summaryParts.push(body.bedrooms);
  }
  const homeSummary = summaryParts.filter(function(part) {
    return part;
  }).join(' · ') || 'Details pending';
  const lines = [];
  lines.push('<p>Hi ' + sanitize(body.name) + ',</p>');
  lines.push('<p>Thank you for reaching out to Moving Forward to New Beginnings. We received your moving details on <strong>' + timestamp.toLocaleString() + '</strong> and will follow up shortly with next steps.</p>');
  lines.push('<h3>Your summary</h3>');
  lines.push('<ul>');
  lines.push('  <li><strong>Move date:</strong> ' + sanitize(body.moveDate || 'Flexible') + '</li>');
  lines.push('  <li><strong>From:</strong> ' + sanitize(body.pickup) + '</li>');
  lines.push('  <li><strong>To:</strong> ' + sanitize(body.dropoff) + '</li>');
  lines.push('  <li><strong>Home type &amp; rooms:</strong> ' + sanitize(homeSummary) + '</li>');
  lines.push('  <li><strong>Access details:</strong> ' + sanitize(body.access || 'Provided verbally') + '</li>');
  lines.push('  <li><strong>Special items:</strong> ' + sanitize(body.inventory || 'None noted') + '</li>');
  lines.push('  <li><strong>Extra services:</strong> ' + sanitize(extras) + '</li>');
  lines.push('  <li><strong>Additional notes:</strong> ' + sanitize(body.notes || 'None') + '</li>');
  lines.push('</ul>');
  lines.push('<p>If anything changes, reply to this email or call/text <a href="tel:+15877310695">(587) 731-0695</a>.</p>');
  lines.push('<p>With gratitude,<br />Chris Ehret &amp; the MFTNB team</p>');
  return lines.join('\n');
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
  if (typeof output.setHeaders === 'function') {
    output.setHeaders({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
  } else if (typeof output.setHeader === 'function') {
    output.setHeader('Access-Control-Allow-Origin', '*');
    output.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS, GET');
    output.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (typeof code === 'number' && typeof output.setResponseCode === 'function') {
    output.setResponseCode(code);
  }
  return output;
}