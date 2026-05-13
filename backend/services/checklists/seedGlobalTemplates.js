// One-time seed for "general" checklist templates shipped with the platform.
//
// Reads every .md file in /checklist-templates/ at the project root and inserts
// them into checklist_templates with is_global = TRUE — but ONLY if a global
// template with the same name doesn't already exist. Safe to call on every
// server boot.

const fs = require('fs');
const path = require('path');
const db = require('../../db/connection');
const logger = require('../../lib/logger');

const TEMPLATES_DIR = path.resolve(__dirname, '../../../checklist-templates');

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

async function seedGlobalTemplates() {
  let files;
  try {
    files = fs.readdirSync(TEMPLATES_DIR).filter(f => f.endsWith('.md'));
  } catch (err) {
    logger.warn({ err: err.message, dir: TEMPLATES_DIR }, 'Global templates directory not found; skipping seed');
    return;
  }

  if (!files.length) {
    logger.info({ dir: TEMPLATES_DIR }, 'No global template .md files found; skipping seed');
    return;
  }

  let inserted = 0;
  let skipped = 0;

  for (const file of files) {
    const md = fs.readFileSync(path.join(TEMPLATES_DIR, file), 'utf-8');
    const parsed = parseTemplateMarkdown(md);
    if (!parsed.name || !parsed.items.length) {
      logger.warn({ file }, 'Could not parse template — skipping');
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
      logger.info({ file, name: parsed.name, items: parsed.items.length }, 'Seeded global template');
    } catch (err) {
      await conn.rollback();
      logger.error({ err, file }, 'Failed to seed global template');
    } finally {
      conn.release();
    }
  }

  logger.info({ inserted, skipped }, 'Global template seed complete');
}

module.exports = { seedGlobalTemplates, parseTemplateMarkdown };
