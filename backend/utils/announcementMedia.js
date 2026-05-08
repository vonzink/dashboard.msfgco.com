function stripHtml(html) {
  if (!html || typeof html !== 'string') return '';
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeAnnouncementLinks(links) {
  if (!Array.isArray(links)) return [];

  return links
    .map((link) => ({
      label: typeof link?.label === 'string' ? link.label.trim() : '',
      url: typeof link?.url === 'string' ? link.url.trim() : '',
    }))
    .filter((link) => link.url)
    .slice(0, 10)
    .map((link, index) => ({
      label: link.label || `Link ${index + 1}`,
      url: link.url,
    }));
}

function normalizeAnnouncementAttachments(attachments) {
  if (!Array.isArray(attachments)) return [];

  return attachments
    .map((attachment) => ({
      file_s3_key: typeof attachment?.file_s3_key === 'string' ? attachment.file_s3_key.trim() : '',
      file_name: typeof attachment?.file_name === 'string' ? attachment.file_name.trim() : '',
      file_size: Number.isFinite(Number(attachment?.file_size)) ? Number(attachment.file_size) : null,
      file_type: typeof attachment?.file_type === 'string' ? attachment.file_type.trim() : null,
    }))
    .filter((attachment) => attachment.file_s3_key && attachment.file_name)
    .slice(0, 10);
}

function parseJsonArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function buildAnnouncementImagePrompt({ title, content }) {
  const cleanTitle = stripHtml(title || '').slice(0, 160);
  const cleanContent = stripHtml(content || '').slice(0, 900);

  return [
    'Create a polished 16:9 PNG hero graphic for a professional mortgage company announcement.',
    'Use a refined financial-services look with clear composition, natural lighting, and no readable text or logos.',
    cleanTitle ? `Announcement title: ${cleanTitle}` : '',
    cleanContent ? `Announcement content: ${cleanContent}` : '',
    'The graphic should feel trustworthy, modern, and suitable for an internal company dashboard news card.',
  ].filter(Boolean).join('\n');
}

function extractGeneratedImageBase64(payload) {
  if (!payload || typeof payload !== 'object') return null;

  const imageApiData = payload.data?.find?.((item) => typeof item?.b64_json === 'string' && item.b64_json);
  if (imageApiData) return imageApiData.b64_json;

  const responseToolData = payload.output?.find?.((item) => item?.type === 'image_generation_call' && typeof item.result === 'string' && item.result);
  return responseToolData?.result || null;
}

module.exports = {
  stripHtml,
  normalizeAnnouncementLinks,
  normalizeAnnouncementAttachments,
  parseJsonArray,
  buildAnnouncementImagePrompt,
  extractGeneratedImageBase64,
};
