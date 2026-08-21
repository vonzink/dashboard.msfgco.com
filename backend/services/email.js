/**
 * services/email.js
 *
 * Transactional email via Amazon SES (SESv2).
 *
 * Auth: like the S3/Cognito clients, this relies on the EC2 instance's IAM
 * role — no credentials are stored in the app. The role needs `ses:SendEmail`.
 *
 * Sender: info@msfginfo.com. The From domain (msfginfo.com) — or at least that
 * exact address — must be a *verified identity* in SES for the configured
 * region, and the SES account must be out of the sandbox to reach arbitrary
 * recipients. See docs/EMAIL_SETUP.md.
 *
 * Config (all optional, sensible defaults):
 *   SES_REGION                — SES region            (default: AWS_REGION or us-east-1)
 *   ANNOUNCEMENT_FROM_EMAIL   — From address          (default: info@msfginfo.com)
 *   ANNOUNCEMENT_FROM_NAME    — From display name     (default: MSFG News & Announcements)
 *   ANNOUNCEMENT_REPLY_TO     — Reply-To address      (default: the From address)
 *   DASHBOARD_URL             — link target in emails  (default: https://dashboard.msfgco.com)
 */

const { SESv2Client, SendEmailCommand } = require('@aws-sdk/client-sesv2');
const logger = require('../lib/logger');

const REGION = process.env.SES_REGION || process.env.AWS_REGION || 'us-east-1';
const FROM_EMAIL = process.env.ANNOUNCEMENT_FROM_EMAIL || 'info@msfginfo.com';
const FROM_NAME = process.env.ANNOUNCEMENT_FROM_NAME || 'MSFG News & Announcements';
const REPLY_TO = process.env.ANNOUNCEMENT_REPLY_TO || FROM_EMAIL;
const DASHBOARD_URL = process.env.DASHBOARD_URL || 'https://dashboard.msfgco.com';

// SES caps a single SendEmail at 50 recipients across To+Cc+Bcc. We add one
// To (the sender) plus a batch of Bcc, so keep batches comfortably under that.
const BCC_BATCH_SIZE = 45;

// Brand tokens (mirrors the dashboard / calculator palette).
const FOREST = '#104547';
const GREEN = '#8cc63E';

let client = null;
function sesClient() {
  if (!client) client = new SESv2Client({ region: REGION });
  return client;
}

const FROM_HEADER = FROM_NAME ? `${FROM_NAME} <${FROM_EMAIL}>` : FROM_EMAIL;

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function isValidEmail(value) {
  return typeof value === 'string' && EMAIL_RE.test(value.trim());
}

function escapeHtml(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Collapse HTML markup to a short plain-text snippet. */
function htmlToSnippet(html, maxLen = 280) {
  const text = String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|br)>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,!?;:])/g, '$1')   // inline tags can leave a space before punctuation
    .trim();
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1).trimEnd()}…`;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function buildAnnouncementBodies({ title, authorName, snippet }) {
  const safeTitle = escapeHtml(title || 'New announcement');
  const safeAuthor = authorName ? escapeHtml(authorName) : '';
  const safeSnippet = snippet ? escapeHtml(snippet) : '';
  const byline = safeAuthor ? `Posted by ${safeAuthor}` : 'A new item was just posted';

  const html = `<!doctype html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f4f2;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f4f2;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;font-family:'Open Sans',Segoe UI,Helvetica,Arial,sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.08);">
        <tr>
          <td style="background:${FOREST};padding:22px 28px;">
            <div style="color:${GREEN};font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;">MSFG Dashboard</div>
            <div style="color:#ffffff;font-size:20px;font-weight:700;margin-top:2px;">News &amp; Announcements</div>
          </td>
        </tr>
        <tr>
          <td style="padding:28px;">
            <p style="margin:0 0 6px;color:#6b7a72;font-size:13px;">${byline}</p>
            <h1 style="margin:0 0 14px;color:${FOREST};font-size:22px;line-height:1.25;">${safeTitle}</h1>
            ${safeSnippet ? `<p style="margin:0 0 22px;color:#404041;font-size:15px;line-height:1.5;">${safeSnippet}</p>` : ''}
            <a href="${escapeHtml(DASHBOARD_URL)}" style="display:inline-block;background:${GREEN};color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;padding:12px 22px;border-radius:999px;">View on the Dashboard →</a>
          </td>
        </tr>
        <tr>
          <td style="padding:18px 28px;border-top:1px solid #edf1ee;color:#9aa8a0;font-size:12px;line-height:1.5;">
            You're receiving this because you're a member of the MSFG team.<br>
            Mountain State Financial Group, LLC · NMLS# 1314257
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const textLines = [
    'MSFG Dashboard — News & Announcements',
    '',
    byline.replace(/&amp;/g, '&'),
    (title || 'New announcement'),
  ];
  if (snippet) textLines.push('', snippet);
  textLines.push('', `View it on the dashboard: ${DASHBOARD_URL}`, '',
    "You're receiving this because you're a member of the MSFG team.",
    'Mountain State Financial Group, LLC · NMLS# 1314257');

  return { html, text: textLines.join('\n'), subject: `New announcement: ${title || 'MSFG News & Announcements'}` };
}

/**
 * Broadcast a "new announcement" email to the whole team via BCC.
 *
 * @param {object}   opts
 * @param {Array<string|{email:string}>} opts.recipients  — team email addresses
 * @param {string}   opts.title       — announcement title
 * @param {string}  [opts.authorName] — who posted it
 * @param {string}  [opts.content]    — announcement HTML (turned into a snippet)
 * @returns {Promise<{ requested:number, sent:number, failed:number, batches:number, skipped:number }>}
 */
async function sendAnnouncementNotification({ recipients = [], title, authorName, content }) {
  const emails = [...new Set(
    recipients
      .map((r) => (typeof r === 'string' ? r : r && r.email))
      .map((e) => (e ? String(e).trim().toLowerCase() : ''))
      .filter(isValidEmail)
  )];

  const requested = recipients.length;
  const skipped = requested - emails.length;

  if (emails.length === 0) {
    logger.warn({ requested }, 'announcement email: no valid recipients, nothing sent');
    return { requested, sent: 0, failed: 0, batches: 0, skipped };
  }

  const { html, text, subject } = buildAnnouncementBodies({
    title,
    authorName,
    snippet: htmlToSnippet(content),
  });

  const batches = chunk(emails, BCC_BATCH_SIZE);
  let sent = 0;
  let failed = 0;

  for (const batch of batches) {
    const command = new SendEmailCommand({
      FromEmailAddress: FROM_HEADER,
      Destination: {
        ToAddresses: [FROM_EMAIL],   // visible To; real recipients are Bcc'd
        BccAddresses: batch,
      },
      ReplyToAddresses: [REPLY_TO],
      Content: {
        Simple: {
          Subject: { Data: subject, Charset: 'UTF-8' },
          Body: {
            Html: { Data: html, Charset: 'UTF-8' },
            Text: { Data: text, Charset: 'UTF-8' },
          },
        },
      },
    });

    try {
      await sesClient().send(command);
      sent += batch.length;
    } catch (err) {
      failed += batch.length;
      logger.error({ err, batchSize: batch.length, region: REGION, from: FROM_EMAIL }, 'announcement email batch failed');
    }
  }

  logger.info({ requested, sent, failed, batches: batches.length, skipped }, 'announcement email broadcast complete');
  return { requested, sent, failed, batches: batches.length, skipped };
}

module.exports = {
  sendAnnouncementNotification,
  // exported for tests
  htmlToSnippet,
  buildAnnouncementBodies,
  isValidEmail,
  FROM_EMAIL,
};
