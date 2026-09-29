'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'apps_script.gs'), 'utf8');
const estimate = {
  formType: 'estimate', turnstileToken: 'test-token',
  name: 'Jamie & Pat <img src=x onerror=alert(1)>', email: 'customer@example.com', phone: '4035550100',
  pickup: '123 Test Street, Red Deer, AB', dropoff: '456 Test Street, Blackfalds, AB',
  moveDate: '2099-01-01', homeType: 'Single-family home', bedrooms: '3 bedrooms',
  access: 'Side door', inventory: 'Piano', extras: ['Packing'], consent: true,
  notes: 'Pickup: Red Deer, unit 2\nDestination: Blackfalds, unit 3\ntravel estimate unavailable—staff review required'
};

const cloudflareProperties = {
  MFTNB_CUSTOMER_EMAIL_PROVIDER: 'cloudflare',
  CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32),
  CLOUDFLARE_EMAIL_API_TOKEN: 'test-cloudflare-secret'
};
function backend({ failTo = [], failWrite = false, verified = true, properties = {},
  sendStatus = 200, sendResponse = { success: true, result: { delivered: [estimate.email] } },
  sendRaw, sendThrows = false } = {}) {
  const events = [], rows = [], emails = [], errors = [], requests = [];
  const sheet = {
    appendRow(row) {
      if (failWrite) throw new Error('Sheet unavailable');
      rows.push(row); events.push('saved');
    },
    getLastRow() { return rows.length; }
  };
  const context = vm.createContext({
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: key => ({ TURNSTILE_SECRET: 'test-secret', ...properties })[key] || null }) },
    SpreadsheetApp: { flush() {}, getActiveSpreadsheet: () => ({ getSheetByName: () => sheet }) },
    MailApp: { sendEmail(email) {
      events.push('email:' + email.to);
      if (failTo.includes(email.to)) throw new Error('Mail unavailable');
      emails.push(email);
    } },
    UrlFetchApp: { fetch(url, options) {
      if (url === 'https://challenges.cloudflare.com/turnstile/v0/siteverify') {
        return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ success: verified, action: 'estimate' }) };
      }
      requests.push({ url, options }); events.push('cloudflare');
      if (sendThrows) throw new Error('Sensitive request data: test-cloudflare-secret');
      return { getResponseCode: () => sendStatus, getContentText: () => sendRaw ?? JSON.stringify(sendResponse) };
    } },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: text => ({ text, setMimeType() { return this; } })
    },
    console: { error: (...args) => errors.push(args), warn() {} }
  });
  vm.runInContext(source, context, { filename: 'apps_script.gs' });
  const submit = (body = estimate) => JSON.parse(context.doPost({ postData: { contents: JSON.stringify(body) } }).text);
  return { context, submit, events, rows, emails, errors, requests };
}

test('saved estimate sends the requested HTML and plain-text receipt to the customer', () => {
  const b = backend();
  assert.deepEqual(b.submit(), { ok: true, row: 1, confirmationEmailSent: true });
  assert.deepEqual(b.events, ['saved', 'email:info@mftnb.ca', 'email:customer@example.com']);
  assert.equal(b.rows.length, 1);
  assert.equal(b.rows[0][13], estimate.notes);
  const email = b.emails[1];
  assert.equal(email.subject, 'We received your estimate request – Moving Forward to New Beginnings');
  assert.equal(email.name, 'Moving Forward to New Beginnings');
  assert.equal(email.replyTo, 'info@mftnb.ca');
  for (const content of [email.htmlBody, email.body]) {
    assert.match(content, /We received your estimate request/);
    assert.match(content, /within 24 hours/);
    assert.match(content, /call Chris at/);
    assert.ok(content.includes('(587) 731-0695'));
    assert.match(content, /no price or booking is confirmed yet/);
    assert.doesNotMatch(content, /You can also reply/);
    for (const detail of [estimate.pickup, estimate.dropoff, 'unit 2', 'unit 3', 'Piano', 'Packing', 'travel estimate unavailable—staff review required']) {
      assert.ok(content.includes(detail), detail);
    }
  }
  assert.ok(email.htmlBody.includes('href="tel:+15877310695"'));
  assert.ok(email.htmlBody.includes('Jamie &amp; Pat &lt;img'));
  assert.doesNotMatch(email.htmlBody, /<img|<script/);
  assert.ok(email.htmlBody.includes('unit 2<br />Destination'));
  assert.ok(email.body.includes(estimate.notes));
  assert.ok(email.body.includes(estimate.name));
  assert.equal(b.errors.length, 0);
});

test('an office notification failure still attempts the customer receipt', () => {
  const b = backend({ failTo: ['info@mftnb.ca'] });
  assert.equal(b.submit().confirmationEmailSent, true);
  assert.equal(b.emails.length, 1);
  assert.equal(b.emails[0].to, estimate.email);
  assert.equal(b.rows.length, 1);
  assert.equal(b.errors.length, 1);
});

test('a customer email failure preserves the saved request and reports the failed send', () => {
  const b = backend({ failTo: [estimate.email] });
  assert.deepEqual(b.submit(), { ok: true, row: 1, confirmationEmailSent: false });
  assert.equal(b.rows.length, 1);
  assert.equal(b.emails.length, 1);
  assert.equal(b.emails[0].to, 'info@mftnb.ca');
  assert.equal(b.errors.length, 1);
});

test('failure of both emails does not turn a saved request into a retryable submission failure', () => {
  const b = backend({ failTo: ['info@mftnb.ca', estimate.email] });
  assert.deepEqual(b.submit(), { ok: true, row: 1, confirmationEmailSent: false });
  assert.equal(b.rows.length, 1);
  assert.equal(b.emails.length, 0);
});

test('a failed Sheet write sends no receipt and does not acknowledge receipt', () => {
  const b = backend({ failWrite: true });
  assert.equal(b.submit().ok, false);
  assert.equal(b.rows.length, 0);
  assert.equal(b.events.length, 0);
});

test('missing customer fields send no receipt', () => {
  const b = backend();
  assert.equal(b.submit({ ...estimate, email: '' }).ok, false);
  assert.equal(b.rows.length, 0);
  assert.equal(b.emails.length, 0);
});

test('failed human verification sends no receipt and writes no lead', () => {
  const b = backend({ verified: false });
  assert.equal(b.submit().ok, false);
  assert.equal(b.rows.length, 0);
  assert.equal(b.emails.length, 0);
});

test('public health response verifies the backend release without sending email', () => {
  const b = backend();
  assert.deepEqual(JSON.parse(b.context.doGet().text), {
    ok: true, service: 'mftnb-apps-script', version: '2026-09-29-cloudflare-email'
  });
  assert.equal(b.events.length, 0);
});

test('Cloudflare sends the saved estimate from noreply and preserves office delivery', () => {
  const b = backend({ properties: cloudflareProperties });
  assert.deepEqual(b.submit(), { ok: true, row: 1, confirmationEmailSent: true });
  assert.deepEqual(b.events, ['saved', 'email:info@mftnb.ca', 'cloudflare']);
  assert.equal(b.emails.length, 1);
  const request = b.requests[0];
  assert.equal(request.url, 'https://api.cloudflare.com/client/v4/accounts/' + 'a'.repeat(32) + '/email/sending/send');
  assert.equal(request.options.followRedirects, false);
  assert.equal(request.options.headers.Authorization, 'Bearer test-cloudflare-secret');
  const email = JSON.parse(request.options.payload);
  assert.deepEqual(email.from, { address: 'noreply@mftnb.com', name: 'Moving Forward to New Beginnings' });
  assert.equal(email.to, estimate.email);
  assert.equal(email.reply_to, 'noreply@mftnb.com');
  assert.equal(email.headers['Auto-Submitted'], 'auto-generated');
  assert.equal(email.headers['X-Auto-Response-Suppress'], 'All');
  for (const content of [email.html, email.text]) {
    assert.match(content, /within 24 hours/);
    assert.ok(content.includes('(587) 731-0695'));
    assert.ok(content.includes('travel estimate unavailable—staff review required'));
  }
  assert.doesNotMatch(email.html, /<img|<script/);
  assert.equal(b.errors.length, 0);
});

test('Cloudflare queued receipt counts as accepted', () => {
  const b = backend({ properties: cloudflareProperties, sendResponse: { success: true, result: { queued: [estimate.email] } } });
  assert.equal(b.submit().confirmationEmailSent, true);
});

for (const [label, overrides] of [
  ['permission failure', { sendStatus: 403 }],
  ['redirect', { sendStatus: 302 }],
  ['rate limit', { sendStatus: 429 }],
  ['network failure', { sendThrows: true }],
  ['invalid JSON', { sendRaw: 'bad-response test-cloudflare-secret' }],
  ['null response', { sendResponse: null }],
  ['unsuccessful response', { sendResponse: { success: false } }],
  ['ambiguous acceptance', { sendResponse: { success: true, result: { message_id: 'id' } } }],
  ['wrong recipient', { sendResponse: { success: true, result: { delivered: ['someone-else@example.com'] } } }],
  ['permanent bounce', { sendResponse: { success: true, result: { delivered: [estimate.email], permanent_bounces: [estimate.email] } } }],
  ['suppressed recipient', { sendResponse: { success: true, result: { queued: [estimate.email], suppressed_recipients: [estimate.email] } } }]
]) {
  test('Cloudflare ' + label + ' preserves the saved lead without a fallback send', () => {
    const b = backend({ properties: cloudflareProperties, ...overrides });
    assert.deepEqual(b.submit(), { ok: true, row: 1, confirmationEmailSent: false });
    assert.equal(b.rows.length, 1);
    assert.equal(b.requests.length, 1);
    assert.deepEqual(b.emails.map(email => email.to), ['info@mftnb.ca']);
    assert.equal(b.errors.length, 1);
    const logs = b.errors.flat().map(String).join(' ');
    assert.doesNotMatch(logs, /test-cloudflare-secret|customer@example.com|bad-response/);
  });
}

for (const [label, properties] of [
  ['missing token', { ...cloudflareProperties, CLOUDFLARE_EMAIL_API_TOKEN: '' }],
  ['bad account', { ...cloudflareProperties, CLOUDFLARE_ACCOUNT_ID: '../other' }],
  ['unknown provider', { MFTNB_CUSTOMER_EMAIL_PROVIDER: 'unknown' }]
]) {
  test(label + ' fails closed without losing the estimate', () => {
    const b = backend({ properties });
    assert.equal(b.submit().confirmationEmailSent, false);
    assert.equal(b.rows.length, 1);
    assert.equal(b.requests.length, 0);
    assert.deepEqual(b.emails.map(email => email.to), ['info@mftnb.ca']);
  });
}

test('multiple recipients and injected headers cannot receive customer confirmations', () => {
  for (const email of ['a@example.com,b@example.com', 'a@example.com\r\nBcc: b@example.com', 'Name <a@example.com>']) {
    const b = backend({ properties: cloudflareProperties });
    assert.equal(b.submit({ ...estimate, email }).confirmationEmailSent, false);
    assert.equal(b.rows.length, 1);
    assert.equal(b.requests.length, 0);
  }
});

test('Cloudflare does not send after a failed write or human verification', () => {
  for (const options of [{ failWrite: true }, { verified: false }]) {
    const b = backend({ properties: cloudflareProperties, ...options });
    assert.equal(b.submit().ok, false);
    assert.equal(b.requests.length, 0);
  }
});

test('quick message confirmations use the same noreply sender and contact instructions', () => {
  const b = backend({ properties: cloudflareProperties });
  assert.equal(b.submit({ formType: 'quick-message', turnstileToken: 'test', name: 'Jamie', email: estimate.email, message: '<script>Test</script>' }).ok, true);
  assert.equal(b.rows.length, 1);
  const email = JSON.parse(b.requests[0].options.payload);
  assert.equal(email.from.address, 'noreply@mftnb.com');
  assert.match(email.text, /within 24 hours/);
  assert.match(email.text, /call Chris at \(587\) 731-0695/);
  assert.doesNotMatch(email.html, /<script/);
});
