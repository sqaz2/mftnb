// Private owner inbox + standards-based Web Push. No customer data in push payloads.
const OWNER_PREFIX = 'MFTNB_OWNER_';
const OWNER_SHEET = 'Owner Inbox';
const OWNER_DAYS = 90;
const OWNER_COLUMNS = ['ID', 'Received', 'Kind', 'Details JSON', 'Status', 'Push state', 'Attempts', 'Retry after', 'Lease until', 'Delivered devices', 'Last push result'];

function ownerLocked_(work) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try { return work(); } finally {
    try { SpreadsheetApp.flush(); } finally { lock.releaseLock(); }
  }
}
function appendLeadRow_(sheet, row, columns) {
  return ownerLocked_(function() {
    if (columns) {
      if (!sheet.getLastRow()) {
        sheet.appendRow(columns);
      } else {
        const header = sheet.getRange(1, 1, 1, columns.length).getValues()[0];
        // Only the two new trailing headers may be blank. Never write into an unknown layout.
        if (columns.some(function(name, i) { return header[i] !== name && !(i >= 14 && !header[i]); })) {
          throw new Error('The estimate sheet columns have changed. Staff setup is required before saving.');
        }
        if (!header[14] || !header[15]) sheet.getRange(1, 15, 1, 2).setValues([columns.slice(14)]);
      }
    }
    sheet.appendRow(row);
    return sheet.getLastRow();
  });
}
function ownerEmail_() {
  // Deliberately never search customer rows or accept an address from the browser as an administrator.
  const stored = SCRIPT_PROPERTIES.getProperty(OWNER_PREFIX + 'EMAIL');
  const named = stored ? null : SpreadsheetApp.getActiveSpreadsheet().getRangeByName('MFTNB_OWNER_EMAIL');
  const email = String(stored || (named && named.getValue()) || '').trim().toLowerCase();
  return /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(email) ? email : '';
}
function ownerEnabled_() {
  return SCRIPT_PROPERTIES.getProperty(OWNER_PREFIX + 'ENABLED') === 'true' && !!ownerEmail_();
}
function ownerJson_(name, fallback) {
  const value = SCRIPT_PROPERTIES.getProperty(OWNER_PREFIX + name);
  return value ? JSON.parse(value) : fallback;
}
function ownerSave_(name, value) { SCRIPT_PROPERTIES.setProperty(OWNER_PREFIX + name, JSON.stringify(value)); }
function ownerBase64_(bytes) {
  return Utilities.base64EncodeWebSafe(Array.from(bytes, function(n) { return n > 127 ? n - 256 : n; })).replace(/=+$/, '');
}
function ownerBytes_(encoded) { return new Uint8Array(Utilities.base64DecodeWebSafe(encoded).map(function(n) { return n & 255; })); }
function ownerUtf8_(text) { return new Uint8Array(Utilities.newBlob(String(text)).getBytes().map(function(n) { return n & 255; })); }
function ownerHash_(text) { return ownerBase64_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text), Utilities.Charset.UTF_8)); }
function ownerEqual_(a, b) {
  a = String(a); b = String(b); let mismatch = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ (b.charCodeAt(i) || 0);
  return mismatch === 0;
}
function ownerSessions_() {
  const now = Date.now(), email = ownerEmail_();
  return ownerJson_('SESSIONS', []).filter(function(s) { return s.expires > now && s.email === email; });
}
function ownerSession_(token) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(String(token || ''))) throw new Error('Please sign in again.');
  const hash = ownerHash_(token);
  const session = ownerSessions_().find(function(s) { return ownerEqual_(s.hash, hash); });
  if (!session) throw new Error('Please sign in again.');
  return session;
}
function ownerRequest_(body, e) {
  try {
    if (!ownerEnabled_()) return { ok: false, error: 'Owner alerts are waiting for setup.', setupRequired: true };
    if (body.action === 'owner.code') return ownerSendCode_(body, e);
    if (body.action === 'owner.verify') return ownerVerify_(body);
    const session = ownerSession_(body.token);
    switch (body.action) {
      case 'owner.inbox': return ownerInbox_(session);
      case 'owner.keys': return ownerSetKeys_(body);
      case 'owner.subscribe': return ownerSubscribe_(session, body.subscription);
      case 'owner.unsubscribe':
        ownerLocked_(function() { ownerSave_('DEVICES', ownerJson_('DEVICES', []).filter(function(d) { return d.sessionId !== session.id; })); });
        return { ok: true };
      case 'owner.status': return ownerSetStatus_(body.id, body.status);
      case 'owner.test': return ownerTest_(session);
      case 'owner.logout':
        ownerLocked_(function() {
          ownerSave_('SESSIONS', ownerSessions_().filter(function(s) { return s.id !== session.id; }));
          ownerSave_('DEVICES', ownerJson_('DEVICES', []).filter(function(d) { return d.sessionId !== session.id; }));
        });
        return { ok: true };
      default: return { ok: false, error: 'Unknown owner action.' };
    }
  } catch (error) {
    // Only intentionally authored messages reach the client; no keys, endpoints or payloads in errors.
    const message = String(error.message || '');
    const allowed = ['Please sign in again.', 'That code has expired. Request a new one.', 'That code is not correct.', 'Too many attempts. Request a new code.', 'Please wait a minute before requesting another code.', 'The daily sign-in limit has been reached. Try again tomorrow.', 'Enter a valid email address.', 'Unable to send a sign-in code. Please try again later.', 'This phone does not have a supported push subscription.', 'Enable notifications on this phone first.', 'Wait a minute before sending another test.', 'Push notifications need to be enabled again on this phone.', 'The test could not be delivered. Please try again later.', 'The lead could not be found.', 'Invalid lead status.'];
    return { ok: false, error: allowed.indexOf(message) >= 0 ? message : 'The owner service is unavailable. Please try again.' };
  }
}
function ownerSendCode_(body, e) {
  const email = String(body.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email address.');
  const verification = verifyTurnstile(body.turnstileToken, e, 'owner_login');
  if (!verification.success || verification.action !== 'owner_login' || ['mftnb.com','www.mftnb.com','mftnb.pages.dev'].indexOf(verification.hostname) < 0) {
    return { ok: false, error: 'Please complete the security check and try again.' };
  }
  const generic = { ok: true, message: 'If this is the owner email, a sign-in code is on its way.' };
  if (!ownerEqual_(email, ownerEmail_())) return generic;
  let code;
  ownerLocked_(function() {
    const now = Date.now(), today = new Date().toISOString().slice(0, 10);
    const quota = ownerJson_('CODE_LIMIT', { day: today, count: 0, last: 0 });
    if (quota.day !== today) { quota.day = today; quota.count = 0; }
    if (now - quota.last < 60000) throw new Error('Please wait a minute before requesting another code.');
    if (quota.count >= 10) throw new Error('The daily sign-in limit has been reached. Try again tomorrow.');
    // The pre-existing Turnstile server secret supplies secret entropy; UUID is a nonce only.
    const secret = getTurnstileSecret();
    if (!secret) throw new Error('Missing server secret');
    const random = Utilities.computeHmacSha256Signature(Utilities.getUuid() + ':' + now, secret);
    code = String(random.slice(0, 6).reduce(function(n, v) { return (n * 256 + (v & 255)) % 100000000; }, 0)).padStart(8, '0');
    quota.count++; quota.last = now; ownerSave_('CODE_LIMIT', quota);
    ownerSave_('CHALLENGE', { hash: ownerHash_(code), email: email, expires: now + 600000, attempts: 0 });
  });
  try {
    MailApp.sendEmail({ to: email, subject: 'Your MFTNB Leads sign-in code', body: 'Your sign-in code is ' + code + '.\n\nIt expires in 10 minutes. Enter it in MFTNB Leads on your phone.\n\nIf you did not request this, ignore this email. Never share the code.' });
  } catch (error) { throw new Error('Unable to send a sign-in code. Please try again later.'); }
  return generic;
}
function ownerVerify_(body) {
  return ownerLocked_(function() {
    const challenge = ownerJson_('CHALLENGE', null);
    if (!challenge || challenge.expires < Date.now() || challenge.email !== ownerEmail_()) throw new Error('That code has expired. Request a new one.');
    if (challenge.attempts >= 5) throw new Error('Too many attempts. Request a new code.');
    challenge.attempts++; ownerSave_('CHALLENGE', challenge);
    if (!/^\d{8}$/.test(String(body.code || '')) || !ownerEqual_(challenge.hash, ownerHash_(body.code))) throw new Error('That code is not correct.');
    if (!/^[A-Za-z0-9_-]{43}$/.test(String(body.newToken || ''))) throw new Error('Invalid session');
    const sessions = ownerSessions_();
    if (sessions.length >= 5) {
      const removed = sessions.shift();
      ownerSave_('DEVICES', ownerJson_('DEVICES', []).filter(function(d) { return d.sessionId !== removed.id; }));
    }
    const hash = ownerHash_(body.newToken);
    sessions.push({ id: hash.slice(0, 22), hash: hash, email: ownerEmail_(), expires: Date.now() + OWNER_DAYS * 86400000 });
    ownerSave_('SESSIONS', sessions);
    SCRIPT_PROPERTIES.deleteProperty(OWNER_PREFIX + 'CHALLENGE');
    return { ok: true };
  });
}
function ownerSetKeys_(body) {
  return ownerLocked_(function() {
    let keys = ownerJson_('VAPID', null);
    if (!keys) {
      if (!/^[A-Za-z0-9_-]{43}$/.test(String(body.privateKey || ''))) throw new Error('Invalid key');
      const publicKey = ownerBase64_(MftnbPushCrypto.publicKey(ownerBytes_(body.privateKey)));
      if (!ownerEqual_(publicKey, String(body.publicKey || ''))) throw new Error('Invalid key');
      keys = { publicKey: publicKey, privateKey: body.privateKey };
      ownerSave_('VAPID', keys);
    }
    return { ok: true, publicKey: keys.publicKey }; // Never return the private key.
  });
}
function ownerEndpoint_(endpoint) {
  if (typeof endpoint !== 'string' || endpoint.length > 1024) return '';
  const match = endpoint.match(/^https:\/\/([a-z0-9.-]+)(\/[^\s#]+)$/);
  if (!match) return '';
  const host = match[1];
  if (host !== 'fcm.googleapis.com' && !/^(?:[a-z0-9-]+\.)*push\.apple\.com$/.test(host) && !/^(?:[a-z0-9-]+\.)*push\.services\.mozilla\.com$/.test(host)) return '';
  return 'https://' + host;
}
function ownerSubscribe_(session, subscription) {
  if (!subscription || !ownerEndpoint_(subscription.endpoint)) throw new Error('This phone does not have a supported push subscription.');
  const keys = ownerJson_('VAPID', null);
  if (!keys) throw new Error('Missing push keys');
  ownerLocked_(function() {
    const devices = ownerJson_('DEVICES', []).filter(function(d) { return d.sessionId !== session.id && d.endpoint !== subscription.endpoint; });
    devices.push({ id: ownerHash_(subscription.endpoint).slice(0, 22), sessionId: session.id, endpoint: subscription.endpoint, expires: session.expires, registered: Date.now() });
    ownerSave_('DEVICES', devices);
  });
  return { ok: true };
}
function ownerDevices_() {
  const sessions = ownerSessions_().map(function(s) { return s.id; });
  return ownerJson_('DEVICES', []).filter(function(d) { return d.expires > Date.now() && sessions.indexOf(d.sessionId) >= 0; });
}
function ownerPush_(device, topic) {
  const audience = ownerEndpoint_(device.endpoint), keys = ownerJson_('VAPID', null);
  if (!audience || !keys) return { success: false, status: 400, retry: false };
  const header = ownerBase64_(ownerUtf8_(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = ownerBase64_(ownerUtf8_(JSON.stringify({ aud: audience, exp: Math.floor(Date.now() / 1000) + 3600, sub: 'https://mftnb.com' })));
  const unsigned = header + '.' + claims;
  const jwt = unsigned + '.' + ownerBase64_(MftnbPushCrypto.sign(ownerUtf8_(unsigned), ownerBytes_(keys.privateKey)));
  try {
    // RFC 8030 permits empty messages. The worker always displays a generic notification.
    const response = UrlFetchApp.fetch(device.endpoint, { method: 'post', payload: '', followRedirects: false, muteHttpExceptions: true, headers: {
      Authorization: 'vapid t=' + jwt + ', k=' + keys.publicKey,
      TTL: '86400', Urgency: 'high', Topic: String(topic).slice(0, 32)
    }});
    const status = response.getResponseCode();
    return { success: status >= 200 && status < 300, gone: status === 404 || status === 410, retry: status === 429 || status >= 500, status: status };
  } catch (error) { return { success: false, retry: true, status: 0 }; }
}
function ownerTest_(session) {
  const device = ownerDevices_().find(function(d) { return d.sessionId === session.id; });
  if (!device) throw new Error('Enable notifications on this phone first.');
  ownerLocked_(function() {
    const key = 'TEST_' + session.id, previous = Number(SCRIPT_PROPERTIES.getProperty(OWNER_PREFIX + key) || 0);
    if (Date.now() - previous < 60000) throw new Error('Wait a minute before sending another test.');
    SCRIPT_PROPERTIES.setProperty(OWNER_PREFIX + key, String(Date.now()));
  });
  const result = ownerPush_(device, 'mftnb-test');
  if (result.gone) { ownerRemoveDevices_([device.id]); throw new Error('Push notifications need to be enabled again on this phone.'); }
  if (!result.success) throw new Error('The test could not be delivered. Please try again later.');
  return { ok: true, accepted: true };
}
function ownerRemoveDevices_(ids) {
  ownerLocked_(function() { ownerSave_('DEVICES', ownerJson_('DEVICES', []).filter(function(d) { return ids.indexOf(d.id) < 0; })); });
}
function ownerSheet_() {
  const sheet = getOrCreateSheet(OWNER_SHEET);
  if (!sheet.getLastRow()) { sheet.appendRow(OWNER_COLUMNS); sheet.setFrozenRows(1); }
  return sheet;
}
function ownerLeadData_(kind, values) {
  function v(i, limit) { return String(values[i] == null ? '' : values[i]).slice(0, limit || 1024); }
  const data = { name: v(1), email: v(2), phone: v(3) };
  if (kind === 'estimate') Object.assign(data, { pickup: v(4, 2048), dropoff: v(5, 2048), moveDate: v(6), timeWindow: v(7), homeType: v(8), bedrooms: v(14), access: v(9), inventory: v(10, 6000), extras: v(11), notes: v(12, 12000) });
  else data.message = v(4, 12000);
  return data;
}
function ownerRecord_(kind, sourceRow, values) {
  const received = new Date(values[0]).getTime();
  if (!Number.isFinite(received)) return; // Ignore any source header row.
  const id = ownerHash_(kind + ':' + sourceRow + ':' + received).slice(0, 22);
  const sheet = ownerSheet_(), count = sheet.getLastRow();
  if (count > 1 && sheet.getRange(2, 1, count - 1, 1).getValues().some(function(row) { return row[0] === id; })) return;
  sheet.appendRow([id, received, kind, JSON.stringify(ownerLeadData_(kind, values)), 'new', 'pending', 0, 0, 0, '[]', '']);
}
function recordOwnerLeadSafely_(kind, rowNumber, values) {
  try {
    if (!ownerEnabled_()) return;
    ownerLocked_(function() { ownerRecord_(kind, rowNumber, values); });
    // Time trigger performs delivery independently: a slow push service cannot delay a form receipt.
  } catch (error) { console.error('Owner inbox update deferred; saved lead remains in its source sheet.'); }
}
function ownerInbox_(session) {
  const sheet = ownerSheet_(), last = sheet.getLastRow();
  const start = Math.max(2, last - 199), rows = last < 2 ? [] : sheet.getRange(start, 1, last - start + 1, OWNER_COLUMNS.length).getValues();
  const leads = rows.map(function(r) { return { id: r[0], received: r[1], kind: r[2], details: JSON.parse(r[3]), status: r[4], pushState: r[5] }; }).reverse();
  const keys = ownerJson_('VAPID', null);
  return { ok: true, leads: leads, publicKey: keys ? keys.publicKey : null, notificationsEnabled: ownerDevices_().some(function(d) { return d.sessionId === session.id; }), lastDeliveryRun: Number(SCRIPT_PROPERTIES.getProperty(OWNER_PREFIX + 'LAST_RUN') || 0) };
}
function ownerSetStatus_(id, status) {
  if (['new', 'contacted', 'booked', 'closed'].indexOf(status) < 0) throw new Error('Invalid lead status.');
  return ownerLocked_(function() {
    const sheet = ownerSheet_(), count = sheet.getLastRow();
    const index = count < 2 ? -1 : sheet.getRange(2, 1, count - 1, 1).getValues().findIndex(function(r) { return r[0] === id; });
    if (index < 0) throw new Error('The lead could not be found.');
    sheet.getRange(index + 2, 5).setValue(status);
    return { ok: true };
  });
}
// Run once from the Sheet's Apps Script editor. This sends no emails or test notifications.
function enableOwnerNotifications() {
  const email = ownerEmail_();
  if (!email) throw new Error('Set private Script Property MFTNB_OWNER_EMAIL or the Sheet named range MFTNB_OWNER_EMAIL to the verified owner email first.');
  if (!getTurnstileSecret()) throw new Error('The existing TURNSTILE_SECRET must be configured.');
  ownerLocked_(function() {
    ownerSheet_();
    if (SCRIPT_PROPERTIES.getProperty(OWNER_PREFIX + 'ENABLED') !== 'true') {
      ['estimate', 'message'].forEach(function(kind) {
        const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(kind === 'estimate' ? ESTIMATE_SHEET_NAME : QUICK_SHEET_NAME);
        SCRIPT_PROPERTIES.setProperty(OWNER_PREFIX + 'CURSOR_' + kind, String(sheet ? sheet.getLastRow() : 0));
      });
    }
    SCRIPT_PROPERTIES.setProperty(OWNER_PREFIX + 'EMAIL', email);
  });
  if (!ScriptApp.getProjectTriggers().some(function(t) { return t.getHandlerFunction() === 'processOwnerNotifications'; })) {
    ScriptApp.newTrigger('processOwnerNotifications').timeBased().everyMinutes(1).create();
  }
  SCRIPT_PROPERTIES.setProperty(OWNER_PREFIX + 'ENABLED', 'true');
  return 'Owner inbox enabled. Publish a new version of the existing web-app deployment, then open https://mftnb.com/owner/.';
}
function disableOwnerNotifications() {
  SCRIPT_PROPERTIES.setProperty(OWNER_PREFIX + 'ENABLED', 'false');
  ownerSave_('SESSIONS', []); ownerSave_('DEVICES', []);
  ScriptApp.getProjectTriggers().filter(function(t) { return t.getHandlerFunction() === 'processOwnerNotifications'; }).forEach(function(t) { ScriptApp.deleteTrigger(t); });
}
function processOwnerNotifications() {
  if (!ownerEnabled_()) return;
  // Reconcile the canonical source Sheets before delivery. A failed enqueue never loses a saved lead.
  ownerLocked_(function() {
    ['estimate', 'message'].forEach(function(kind) {
      const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(kind === 'estimate' ? ESTIMATE_SHEET_NAME : QUICK_SHEET_NAME);
      if (!sheet) return;
      const key = OWNER_PREFIX + 'CURSOR_' + kind;
      let cursor = Number(SCRIPT_PROPERTIES.getProperty(key) || 0);
      const end = Math.min(sheet.getLastRow(), cursor + 40);
      for (; cursor < end; cursor++) ownerRecord_(kind, cursor + 1, sheet.getRange(cursor + 1, 1, 1, kind === 'estimate' ? ESTIMATE_COLUMNS.length : 6).getValues()[0]);
      SCRIPT_PROPERTIES.setProperty(key, String(end));
    });
  });
  const jobs = ownerLocked_(function() {
    const sheet = ownerSheet_(), last = sheet.getLastRow(), now = Date.now(), claimed = [];
    if (last < 2) return claimed;
    const rows = sheet.getRange(2, 1, last - 1, OWNER_COLUMNS.length).getValues();
    for (let i = 0; i < rows.length && claimed.length < 5; i++) {
      const r = rows[i];
      if (['pending','retry','sending'].indexOf(r[5]) < 0 || Number(r[7]) > now || Number(r[8]) > now) continue;
      if (now - Number(r[1]) > 86400000) { sheet.getRange(i + 2, 6).setValue('expired'); continue; }
      r[5] = 'sending'; r[8] = now + 300000;
      sheet.getRange(i + 2, 6, 1, 4).setValues([[r[5],r[6],r[7],r[8]]]);
      claimed.push({ row: i + 2, values: r });
    }
    return claimed;
  });
  const devices = ownerDevices_();
  jobs.forEach(function(job) {
    const r = job.values, delivered = JSON.parse(r[9] || '[]');
    let retry = false, failure = '', gone = [];
    devices.forEach(function(device) {
      if (delivered.indexOf(device.id) >= 0) return;
      const result = ownerPush_(device, r[0]);
      if (result.success) delivered.push(device.id);
      else if (result.gone) gone.push(device.id);
      else { retry = retry || result.retry; failure = 'Push service status ' + result.status; }
    });
    if (gone.length) ownerRemoveDevices_(gone);
    const attempts = Number(r[6]) + 1;
    const state = !devices.length ? 'no-device' : retry && attempts < 6 ? 'retry' : failure ? 'failed' : delivered.length ? 'sent' : 'no-device';
    ownerLocked_(function() {
      // Update only delivery columns, never overwrite a concurrent owner's lead-status change.
      ownerSheet_().getRange(job.row, 6, 1, 6).setValues([[state, attempts, state === 'retry' ? Date.now() + Math.min(3600000, 60000 * Math.pow(3, attempts - 1)) : 0, 0, JSON.stringify(delivered), failure]]);
    });
  });
  SCRIPT_PROPERTIES.setProperty(OWNER_PREFIX + 'LAST_RUN', String(Date.now()));
}
