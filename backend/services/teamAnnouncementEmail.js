const { SESv2Client, SendEmailCommand } = require('@aws-sdk/client-sesv2');

const DEFAULT_FROM = 'MSFG Team <info@msfginfo.com>';
const DEFAULT_DASHBOARD_URL = 'https://dashboard.msfgco.com/';
const MAX_RECIPIENTS_PER_MESSAGE = 50;

const ses = new SESv2Client({ region: process.env.SES_REGION || process.env.AWS_REGION || 'us-east-1' });

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>|<\/div>|<\/li>|<\/h[1-6]>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeRecipients(recipients) {
  const unique = new Set();
  for (const value of recipients || []) {
    const email = String(value || '').trim().toLowerCase();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) unique.add(email);
  }
  return [...unique];
}

function chunk(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

function buildEmail({ title, content, links = [], authorName }) {
  const dashboardUrl = process.env.DASHBOARD_URL || DEFAULT_DASHBOARD_URL;
  const safeTitle = escapeHtml(title);
  const safeAuthor = escapeHtml(authorName || 'MSFG Team');
  // Inline announcement images use short-lived S3 URLs, so email links back to
  // the dashboard instead of embedding media that will later expire.
  const emailContent = String(content || '').replace(/<img\b[^>]*>/gi, '');
  const safeLinks = (links || [])
    .filter(link => link?.url)
    .map((link, index) => ({
      label: escapeHtml(link.label || `Link ${index + 1}`),
      url: escapeHtml(link.url),
    }));
  const linksHtml = safeLinks.length
    ? `<div style="margin-top:24px">${safeLinks.map(link => `<p style="margin:8px 0"><a href="${link.url}" style="color:#167a55;font-weight:600">${link.label}</a></p>`).join('')}</div>`
    : '';
  const linksText = safeLinks.length
    ? `\n\n${safeLinks.map(link => `${stripHtml(link.label)}: ${link.url}`).join('\n')}`
    : '';

  return {
    subject: `[MSFG Team] ${title}`,
    html: `<!doctype html><html><body style="margin:0;background:#f4f6f5;font-family:Arial,sans-serif;color:#21302c"><div style="max-width:680px;margin:0 auto;padding:28px 18px"><div style="background:#fff;border:1px solid #dfe6e3;border-top:5px solid #8cc63e;padding:28px"><p style="margin:0 0 8px;color:#5f716a;font-size:13px;text-transform:uppercase">MSFG Team Announcement</p><h1 style="margin:0 0 20px;font-size:26px">${safeTitle}</h1><div style="font-size:16px;line-height:1.6">${emailContent}</div>${linksHtml}<p style="margin:28px 0 0"><a href="${escapeHtml(dashboardUrl)}" style="display:inline-block;background:#104547;color:#fff;text-decoration:none;padding:11px 18px;border-radius:4px;font-weight:600">Open Dashboard</a></p><p style="margin:24px 0 0;color:#71817b;font-size:13px">Posted by ${safeAuthor}</p></div></div></body></html>`,
    text: `MSFG TEAM ANNOUNCEMENT\n\n${title}\n\n${stripHtml(emailContent)}${linksText}\n\nOpen Dashboard: ${dashboardUrl}\n\nPosted by ${authorName || 'MSFG Team'}`,
  };
}

async function sendAnnouncementEmail({ title, content, links, authorName, recipients }, client = ses) {
  const normalized = normalizeRecipients(recipients);
  if (normalized.length === 0) {
    return { sent: false, recipientCount: 0, messageCount: 0, message: 'No active team email addresses were found.' };
  }

  const email = buildEmail({ title, content, links, authorName });
  const batches = chunk(normalized, MAX_RECIPIENTS_PER_MESSAGE);
  const messageIds = [];

  for (const batch of batches) {
    const result = await client.send(new SendEmailCommand({
      FromEmailAddress: process.env.ANNOUNCEMENT_FROM_EMAIL || DEFAULT_FROM,
      Destination: { BccAddresses: batch },
      ReplyToAddresses: [process.env.ANNOUNCEMENT_REPLY_TO || 'info@msfginfo.com'],
      Content: {
        Simple: {
          Subject: { Data: email.subject, Charset: 'UTF-8' },
          Body: {
            Html: { Data: email.html, Charset: 'UTF-8' },
            Text: { Data: email.text, Charset: 'UTF-8' },
          },
        },
      },
    }));
    if (result.MessageId) messageIds.push(result.MessageId);
  }

  return { sent: true, recipientCount: normalized.length, messageCount: batches.length, messageIds };
}

module.exports = {
  MAX_RECIPIENTS_PER_MESSAGE,
  buildEmail,
  normalizeRecipients,
  sendAnnouncementEmail,
};
