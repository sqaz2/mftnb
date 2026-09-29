export const NOREPLY_ADDRESS = 'noreply@mftnb.com';
const CONTACT_NOTICE = 'This inbox is not monitored. Please call Chris at (587) 731-0695.';

function safeMailbox(value) {
  return typeof value === 'string' && value.length <= 254 &&
    /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i.test(value);
}

export function replyDetails(message) {
  if (message.to?.toLowerCase() !== NOREPLY_ADDRESS || !safeMailbox(message.from)) return null;
  const sender = message.from.toLowerCase();
  const [local, domain] = sender.split('@');
  if (domain === 'mftnb.com' || /^(?:mailer-daemon|postmaster|no[._-]?reply|donotreply)(?:[+._-]|$)/.test(local)) return null;
  const header = name => (message.headers.get(name) || '').trim();
  const submitted = header('auto-submitted').toLowerCase();
  if (submitted && submitted !== 'no') return null;
  if (/\b(?:bulk|list|junk)\b/i.test(header('precedence')) || header('list-id')) return null;
  if (/\b(?:all|autoreply|oof)\b/i.test(header('x-auto-response-suppress'))) return null;
  if (header('x-autoreply') || header('x-autorespond') || header('return-path') === '<>') return null;
  if (/multipart\/report|message\/delivery-status|message\/disposition-notification/i.test(header('content-type'))) return null;
  const references = header('references');
  if (references.length > 8000 || (references.match(/</g) || []).length > 90) return null;
  const messageId = header('message-id');
  // Only copy a single bounded identifier into the MIME headers, never subject or body.
  if (messageId && (messageId.length > 500 || /[^\x20-\x7e]/.test(messageId) || !/^<[^\s<>@]+@[^\s<>@]+>$/.test(messageId))) return null;
  return { to: message.from, messageId };
}

export function buildReply(details, { now = new Date(), id = crypto.randomUUID() } = {}) {
  const lines = [
    'From: Moving Forward to New Beginnings <' + NOREPLY_ADDRESS + '>',
    'To: <' + details.to + '>',
    'Subject: Please call Chris - Moving Forward to New Beginnings',
    'Date: ' + now.toUTCString(),
    'Message-ID: <' + id + '@mftnb.com>',
    'Auto-Submitted: auto-replied',
    'X-Auto-Response-Suppress: All',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 7bit'
  ];
  if (details.messageId) {
    lines.push('In-Reply-To: ' + details.messageId, 'References: ' + details.messageId);
  }
  lines.push('',
    'Thanks for contacting Moving Forward to New Beginnings.', '',
    'This address sends automated confirmations and is not monitored.',
    'Your reply has not been forwarded to our team.', '',
    'For questions or changes to your estimate request, please call Chris',
    'at (587) 731-0695.', '',
    'Please do not reply to this automated message.', '',
    'Chris Ehret & the MFTNB team', '');
  return lines.join('\r\n');
}

export async function handleReply(message, EmailMessage, logger = console) {
  const details = replyDetails(message);
  if (!details) return;
  try {
    // Cloudflare enforces valid inbound DMARC, matching sender/recipient, and one reply.
    await message.reply(new EmailMessage(NOREPLY_ADDRESS, details.to, buildReply(details)));
  } catch (err) {
    // Do not record the sender, subject, body, or provider exception in logs.
    logger.error('MFTNB automatic reply was not accepted');
    message.setReject(CONTACT_NOTICE);
  }
}
