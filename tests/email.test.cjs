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

function backend({ failTo = [], failWrite = false, verified = true } = {}) {
  const events = [], rows = [], emails = [], errors = [];
  const sheet = {
    appendRow(row) {
      if (failWrite) throw new Error('Sheet unavailable');
      rows.push(row); events.push('saved');
    },
    getLastRow() { return rows.length; }
  };
  const context = vm.createContext({
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'test-secret' }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => sheet }) },
    MailApp: { sendEmail(email) {
      events.push('email:' + email.to);
      if (failTo.includes(email.to)) throw new Error('Mail unavailable');
      emails.push(email);
    } },
    UrlFetchApp: { fetch: () => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify({ success: verified, action: 'estimate' }) }) },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: text => ({ text, setMimeType() { return this; } })
    },
    console: { error: (...args) => errors.push(args), warn() {} }
  });
  vm.runInContext(source, context, { filename: 'apps_script.gs' });
  const submit = (body = estimate) => JSON.parse(context.doPost({ postData: { contents: JSON.stringify(body) } }).text);
  return { context, submit, events, rows, emails, errors };
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
    ok: true, service: 'mftnb-apps-script', version: '2026-09-29-estimate-receipt'
  });
  assert.equal(b.events.length, 0);
});
