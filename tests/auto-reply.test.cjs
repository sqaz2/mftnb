const test = require('node:test');
const assert = require('node:assert/strict');
const modulePromise = import('../email-worker/auto-reply.mjs');

function incoming({ from = 'customer@example.com', to = 'noreply@mftnb.com', headers = {}, failReply = false } = {}) {
  const replies = [], rejections = [], logs = [];
  const message = {
    from, to,
    headers: new Headers({ 'Message-ID': '<human-message@example.com>', ...headers }),
    async reply(reply) { if (failReply) throw new Error('private sender and message data'); replies.push(reply); },
    setReject(reason) { rejections.push(reason); }
  };
  class EmailMessage { constructor(from, to, raw) { Object.assign(this, { from, to, raw }); } }
  return { message, EmailMessage, replies, rejections, logger: { error: (...args) => logs.push(args) }, logs };
}

test('a human reply gets one clear unmonitored-inbox response with Chris contact details', async () => {
  const { handleReply } = await modulePromise;
  const h = incoming({ headers: { Subject: 'private subject', 'Reply-To': 'other@example.com' } });
  await handleReply(h.message, h.EmailMessage, h.logger);
  assert.equal(h.replies.length, 1);
  const reply = h.replies[0];
  assert.equal(reply.from, 'noreply@mftnb.com');
  assert.equal(reply.to, 'customer@example.com');
  assert.match(reply.raw, /is not monitored/);
  assert.match(reply.raw, /has not been forwarded/);
  assert.match(reply.raw, /please call Chris\r\nat \(587\) 731-0695/);
  assert.match(reply.raw, /Auto-Submitted: auto-replied\r\n/);
  assert.match(reply.raw, /X-Auto-Response-Suppress: All\r\n/);
  assert.match(reply.raw, /In-Reply-To: <human-message@example.com>/);
  assert.match(reply.raw, /References: <human-message@example.com>/);
  assert.doesNotMatch(reply.raw, /private subject|other@example.com|within 24 hours/);
  assert.equal(h.logs.length, 0);
  assert.equal(h.rejections.length, 0);
});

for (const [label, options] of [
  ['different address', { to: 'info@mftnb.com' }],
  ['null envelope sender', { from: '' }],
  ['own domain', { from: 'other@mftnb.com' }],
  ['mailer daemon', { from: 'MAILER-DAEMON@example.com' }],
  ['postmaster', { from: 'postmaster@example.com' }],
  ['noreply sender', { from: 'no-reply+123@example.com' }],
  ['automatic reply', { headers: { 'Auto-Submitted': 'auto-replied' } }],
  ['generated message', { headers: { 'Auto-Submitted': 'auto-generated' } }],
  ['list message', { headers: { 'List-Id': 'mail.example.com' } }],
  ['bulk message', { headers: { Precedence: 'bulk' } }],
  ['suppressed reply', { headers: { 'X-Auto-Response-Suppress': 'OOF, AutoReply' } }],
  ['suppress all', { headers: { 'X-Auto-Response-Suppress': 'All' } }],
  ['legacy responder', { headers: { 'X-Autoreply': 'yes' } }],
  ['empty return path', { headers: { 'Return-Path': '<>' } }],
  ['delivery report', { headers: { 'Content-Type': 'multipart/report; report-type=delivery-status' } }],
  ['long reference chain', { headers: { References: Array(101).fill('<id@example.com>').join(' ') } }],
  ['malformed message id', { headers: { 'Message-ID': '<id@example.com> extra' } }],
  ['multiple senders', { from: 'a@example.com,b@example.com' }],
  ['header injection', { from: 'a@example.com\r\nBcc: other@example.com' }]
]) {
  test('automatic replies ignore ' + label, async () => {
    const { handleReply } = await modulePromise;
    const h = incoming(options);
    await handleReply(h.message, h.EmailMessage, h.logger);
    assert.equal(h.replies.length, 0);
    assert.equal(h.rejections.length, 0);
  });
}

test('human Auto-Submitted no is allowed, including no original message id', async () => {
  const { handleReply } = await modulePromise;
  const h = incoming({ headers: { 'Auto-Submitted': 'no', 'Message-ID': '' } });
  await handleReply(h.message, h.EmailMessage, h.logger);
  assert.equal(h.replies.length, 1);
  assert.doesNotMatch(h.replies[0].raw, /In-Reply-To:/);
});

test('unsafe original message-id cannot inject a reply header', async () => {
  const { handleReply } = await modulePromise;
  const h = incoming();
  h.message.headers = { get: name => name === 'message-id' ? '<id@example.com>\r\nBcc: other@example.com' : '' };
  await handleReply(h.message, h.EmailMessage, h.logger);
  assert.equal(h.replies.length, 0);
});

test('reply rejection gives a phone contact without logging private provider data', async () => {
  const { handleReply } = await modulePromise;
  const h = incoming({ failReply: true });
  await handleReply(h.message, h.EmailMessage, h.logger);
  assert.equal(h.replies.length, 0);
  assert.deepEqual(h.rejections, ['This inbox is not monitored. Please call Chris at (587) 731-0695.']);
  assert.equal(h.logs.length, 1);
  assert.doesNotMatch(JSON.stringify(h.logs), /private sender|customer@example.com/);
});
