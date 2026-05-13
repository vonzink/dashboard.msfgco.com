// Sync "general" checklist templates from S3 into the database on each boot.
//
// Source of truth: s3://<TEMPLATES_BUCKET>/<TEMPLATES_PREFIX>*.md
//
// For every .md found, we parse it and INSERT a global template row if one
// with the same name doesn't already exist. Removing a file from S3 does NOT
// delete the DB row (intentional — old loans may still reference it). To
// retire a template, delete it via the future admin UI or in the DB directly.

const { S3Client, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');
const db = require('../../db/connection');
const logger = require('../../lib/logger');

// dashboard.msfgco.com lives in us-west-1; AWS_REGION may be us-east-1 for
// other services on this server, so we hard-default to the bucket's region.
const TEMPLATES_BUCKET = process.env.CHECKLIST_TEMPLATES_BUCKET || 'dashboard.msfgco.com';
const TEMPLATES_PREFIX = process.env.CHECKLIST_TEMPLATES_PREFIX || 'checklist-templates/';
const TEMPLATES_REGION = process.env.CHECKLIST_TEMPLATES_REGION || 'us-west-1';

const s3 = new S3Client({ region: TEMPLATES_REGION });

/**
 * Parse the small markdown subset our checklist .md files use:
 *   ---
 *   name: <name>
 *   description: <desc>
 *   ---
 *   # Title
 *   | Name | Status | Date |
 *   |---|---|---|
 *   | <item> | Not Started | |
 *   ...
 *
 * Returns { name, description, items: [{ name, default_status }] }.
 */
function parseTemplateMarkdown(md) {
  const out = { name: '', description: '', items: [] };

  const fmMatch = md.match(/^---\n([\s\S]*?)\n---/);
  if (fmMatch) {
    const fm = fmMatch[1];
    const nameLine = fm.match(/name:\s*(.+)/);
    const descLine = fm.match(/description:\s*(.+)/);
    if (nameLine) out.name = nameLine[1].trim();
    if (descLine) out.description = descLine[1].trim();
  }

  const lines = md.split('\n');
  let inTable = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('| Name') || trimmed.startsWith('|---')) {
      inTable = true;
      continue;
    }
    if (inTable && trimmed.startsWith('|') && trimmed.endsWith('|')) {
      const cells = trimmed.split('|').filter((_, i, arr) => i > 0 && i < arr.length - 1).map(c => c.trim());
      const name = cells[0]?.replace(/\\\|/g, '|');
      if (name && name !== 'Name' && !name.match(/^-+$/)) {
        const statusRaw = (cells[1] || 'Not Started').toLowerCase();
        const status = statusRaw.includes('done') ? 'done'
          : statusRaw.includes('progress') ? 'in_progress'
          : statusRaw.includes('issue') ? 'issue'
          : statusRaw.includes('n/a') || statusRaw === 'na' ? 'na'
          : 'not_started';
        out.items.push({ name, default_status: status });
      }
      continue;
    }
    if (inTable && !trimmed) inTable = false;
  }

  return out;
}

async function _listTemplateKeys() {
  const cmd = new ListObjectsV2Command({
    Bucket: TEMPLATES_BUCKET,
    Prefix: TEMPLATES_PREFIX,
  });
  const resp = await s3.send(cmd);
  return (resp.Contents || [])
    .filter(obj => obj.Key && obj.Key.endsWith('.md') && obj.Size > 0)
    .map(obj => obj.Key);
}

async function _readTemplate(key) {
  const cmd = new GetObjectCommand({ Bucket: TEMPLATES_BUCKET, Key: key });
  const resp = await s3.send(cmd);
  // Node's GetObjectCommand returns a stream; transformToString() requires the helper
  // bundled with the SDK v3 client. Fall back to manual stream collection if absent.
  if (typeof resp.Body.transformToString === 'function') {
    return resp.Body.transformToString('utf-8');
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    resp.Body.on('data', (c) => chunks.push(c));
    resp.Body.on('error', reject);
    resp.Body.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
  });
}

async function seedGlobalTemplates() {
  let keys;
  try {
    keys = await _listTemplateKeys();
  } catch (err) {
    logger.warn({ err: err.message, bucket: TEMPLATES_BUCKET, prefix: TEMPLATES_PREFIX },
      'Cannot list S3 templates bucket — skipping seed (likely permissions or wrong bucket name)');
    return;
  }

  if (!keys.length) {
    logger.info({ bucket: TEMPLATES_BUCKET, prefix: TEMPLATES_PREFIX },
      'No global template .md files found in S3; skipping seed');
    return;
  }

  let inserted = 0;
  let skipped = 0;

  for (const key of keys) {
    let md;
    try {
      md = await _readTemplate(key);
    } catch (err) {
      logger.warn({ err: err.message, key }, 'Failed to read template from S3');
      continue;
    }

    const parsed = parseTemplateMarkdown(md);
    if (!parsed.name || !parsed.items.length) {
      logger.warn({ key }, 'Could not parse template — skipping');
      continue;
    }

    const [existing] = await db.query(
      'SELECT id FROM checklist_templates WHERE is_global = TRUE AND name = ?',
      [parsed.name],
    );
    if (existing.length) {
      skipped++;
      continue;
    }

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const [r] = await conn.query(
        'INSERT INTO checklist_templates (user_id, is_global, name, description) VALUES (NULL, TRUE, ?, ?)',
        [parsed.name, parsed.description || null],
      );
      const templateId = r.insertId;
      for (let i = 0; i < parsed.items.length; i++) {
        await conn.query(
          'INSERT INTO checklist_template_items (template_id, name, default_status, sort_order) VALUES (?, ?, ?, ?)',
          [templateId, parsed.items[i].name, parsed.items[i].default_status, i],
        );
      }
      await conn.commit();
      inserted++;
      logger.info({ key, name: parsed.name, items: parsed.items.length }, 'Seeded global template');
    } catch (err) {
      await conn.rollback();
      logger.error({ err, key }, 'Failed to seed global template');
    } finally {
      conn.release();
    }
  }

  logger.info({ inserted, skipped, bucket: TEMPLATES_BUCKET, prefix: TEMPLATES_PREFIX },
    'Global template seed complete');
}

module.exports = {
  seedGlobalTemplates,
  parseTemplateMarkdown,
  // Exported for future admin upload endpoint
  TEMPLATES_BUCKET,
  TEMPLATES_PREFIX,
};
