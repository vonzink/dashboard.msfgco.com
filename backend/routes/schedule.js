const express = require('express');
const db = require('../db/connection');
const { getUserId, requireDbUser } = require('../middleware/userContext');
const {
  scheduleEntry,
  scheduleEntryUpdate,
  scheduleEntryQuery,
  scheduleEntryVisibilityUpdate,
  validate,
  validateQuery,
} = require('../validation/schemas');
const { canManageScheduleEntry } = require('../services/schedule/permissions');
const { presentScheduleEntry } = require('../services/schedule/privacy');

const router = express.Router();

router.use(requireDbUser);

const SELECT_FIELDS = `
  se.*,
  u.name AS employee_name,
  u.initials AS employee_initials,
  u.role AS employee_role,
  p.nmls_number AS employee_nmls_number
`;

const MAX_QUERY_RANGE_DAYS = 370;

const EDITABLE_FIELDS = [
  'user_id',
  'status',
  'start_date',
  'end_date',
  'start_time',
  'end_time',
  'timezone',
  'note',
  'visibility',
  'event_color',
];

function buildListQuery(query) {
  const where = [];
  const params = [];

  if (query.start_date) {
    where.push('se.end_date >= ?');
    params.push(query.start_date);
  }

  if (query.end_date) {
    where.push('se.start_date <= ?');
    params.push(query.end_date);
  }

  if (query.user_id) {
    where.push('se.user_id = ?');
    params.push(query.user_id);
  }

  if (query.status) {
    where.push('se.status = ?');
    params.push(query.status);
  }

  if (query.source) {
    where.push('se.source = ?');
    params.push(query.source);
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  return {
    sql: `
      SELECT ${SELECT_FIELDS}
      FROM schedule_entries se
      JOIN users u ON u.id = se.user_id
      LEFT JOIN user_profiles p ON p.user_id = u.id
      ${whereClause}
      ORDER BY se.start_date ASC, se.start_time ASC, u.name ASC
    `,
    params,
  };
}

function getRows(result) {
  return Array.isArray(result?.[0]) ? result[0] : result;
}

function requireDateRange(req, res) {
  if (!req.query.start_date || !req.query.end_date) {
    res.status(400).json({
      error: 'start_date and end_date are required',
      field: undefined,
    });
    return false;
  }

  const startDate = parseDateOnly(req.query.start_date);
  const endDate = parseDateOnly(req.query.end_date);

  if (!startDate) {
    res.status(400).json({
      error: 'Expected valid YYYY-MM-DD date',
      field: 'start_date',
    });
    return false;
  }

  if (!endDate) {
    res.status(400).json({
      error: 'Expected valid YYYY-MM-DD date',
      field: 'end_date',
    });
    return false;
  }

  if (endDate < startDate) {
    res.status(400).json({
      error: 'end_date must be on or after start_date',
      field: 'end_date',
    });
    return false;
  }

  const spanDays = (endDate - startDate) / 86400000 + 1;
  if (spanDays > MAX_QUERY_RANGE_DAYS) {
    res.status(400).json({
      error: `date range must not exceed ${MAX_QUERY_RANGE_DAYS} days`,
      field: 'end_date',
    });
    return false;
  }

  return true;
}

async function fetchEntry(id) {
  const result = await db.query(
    `SELECT ${SELECT_FIELDS}
     FROM schedule_entries se
     JOIN users u ON u.id = se.user_id
     LEFT JOIN user_profiles p ON p.user_id = u.id
     WHERE se.id = ?`,
    [id]
  );
  const rows = getRows(result);
  return rows?.[0] || null;
}

function requireScheduleAccess(req, res, userId) {
  if (!canManageScheduleEntry(req, userId)) {
    res.status(403).json({ error: 'Access denied' });
    return false;
  }
  return true;
}

function isProviderOwned(entry) {
  return Boolean(entry?.source_provider && entry?.source_event_id);
}

function providerName(entry) {
  return entry.source_provider === 'google' ? 'Google' : 'Outlook';
}

function requireEditableEntry(entry, res) {
  if (!isProviderOwned(entry)) return true;
  res.status(409).json({ error: `This schedule entry is managed in ${providerName(entry)}.` });
  return false;
}

function requireProviderVisibilityOwner(entry, req, res) {
  if (Number(entry.user_id) !== Number(getUserId(req))) {
    res.status(403).json({
      error: "Only the connected calendar owner can change this event's sharing.",
    });
    return false;
  }
  return true;
}

function requireShareableProviderDetails(entry, visibility, res) {
  if (visibility !== 'shared_details') return true;
  if (entry.details_shareable) return true;

  res.status(409).json({
    error: `This ${providerName(entry)} event is private and cannot be shared.`,
  });
  return false;
}

function rejectUnsupportedEntryWriteFields(body, res) {
  if (Array.isArray(body.attendees) && body.attendees.length > 0) {
    res.status(400).json({
      error: 'Attendee invites are not supported by this endpoint yet.',
      field: 'attendees',
    });
    return true;
  }

  if (body.send_updates === true) {
    res.status(400).json({
      error: 'Sending calendar invite updates is not supported by this endpoint yet.',
      field: 'send_updates',
    });
    return true;
  }

  return false;
}

function toInsertValues(payload, userId) {
  return [
    payload.user_id,
    payload.status,
    payload.start_date,
    payload.end_date,
    payload.start_time || null,
    payload.end_time || null,
    payload.timezone || 'America/Denver',
    payload.note || null,
    payload.visibility || 'availability_only',
    payload.event_color || null,
    'manual',
    null,
    null,
    userId,
    userId,
  ];
}

function toUpdateValues(entry, userId) {
  return [
    entry.user_id,
    entry.status,
    entry.start_date,
    entry.end_date,
    entry.start_time || null,
    entry.end_time || null,
    entry.timezone || 'America/Denver',
    entry.note || null,
    entry.visibility || 'availability_only',
    entry.event_color || null,
    'manual',
    null,
    null,
    userId,
    entry.id,
  ];
}

function toDateString(value) {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return value;
}

function parseDateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
}

function schedulePayloadFromEntry(entry) {
  return {
    user_id: entry.user_id,
    status: entry.status,
    start_date: toDateString(entry.start_date),
    end_date: toDateString(entry.end_date),
    start_time: entry.start_time || null,
    end_time: entry.end_time || null,
    timezone: entry.timezone || 'America/Denver',
    note: entry.note || undefined,
    visibility: entry.visibility || 'availability_only',
    event_color: entry.event_color || null,
    source: entry.source || 'manual',
    source_provider: entry.source_provider || null,
    source_event_id: entry.source_event_id || undefined,
  };
}

function validateMergedEntry(entry, res) {
  const result = scheduleEntry.safeParse(schedulePayloadFromEntry(entry));
  if (!result.success) {
    const firstIssue = result.error.issues[0];
    res.status(400).json({
      error: firstIssue.message,
      field: firstIssue.path.join('.') || undefined,
    });
    return null;
  }
  return result.data;
}

router.get('/entries', validateQuery(scheduleEntryQuery), async (req, res, next) => {
  try {
    if (!requireDateRange(req, res)) return;

    const { sql, params } = buildListQuery(req.query);
    const result = await db.query(sql, params);
    const rows = getRows(result) || [];
    res.json(rows.map((row) => presentScheduleEntry(row, req)));
  } catch (error) {
    next(error);
  }
});

router.get('/availability', validateQuery(scheduleEntryQuery), async (req, res, next) => {
  try {
    if (!requireDateRange(req, res)) return;

    const { sql, params } = buildListQuery(req.query);
    const result = await db.query(sql, params);
    const rows = getRows(result) || [];
    const entries = rows.map((row) => presentScheduleEntry(row, req));
    res.json({ entries, count: rows.length });
  } catch (error) {
    next(error);
  }
});

router.post('/entries', validate(scheduleEntry), async (req, res, next) => {
  try {
    const payload = req.body;

    if (rejectUnsupportedEntryWriteFields(payload, res)) return;

    if (!requireScheduleAccess(req, res, payload.user_id)) return;

    const userId = getUserId(req);
    const [result] = await db.query(
      `INSERT INTO schedule_entries
        (user_id, status, start_date, end_date, start_time, end_time, timezone, note,
         visibility, event_color, source, source_provider, source_event_id, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      toInsertValues(payload, userId)
    );

    res.status(201).json({ id: result.insertId });
  } catch (error) {
    next(error);
  }
});

router.put('/entries/:id', validate(scheduleEntryUpdate), async (req, res, next) => {
  try {
    if (Object.keys(req.body).length === 0) {
      return res.status(400).json({
        error: 'At least one field is required',
        field: undefined,
      });
    }

    if (rejectUnsupportedEntryWriteFields(req.body, res)) return;

    const existing = await fetchEntry(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Schedule entry not found' });
    }

    if (!requireEditableEntry(existing, res)) return;

    if (!requireScheduleAccess(req, res, existing.user_id)) return;

    const merged = { ...existing };
    for (const field of EDITABLE_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        merged[field] = req.body[field];
      }
    }

    if (Number(merged.user_id) !== Number(existing.user_id) && !requireScheduleAccess(req, res, merged.user_id)) {
      return;
    }

    const validated = validateMergedEntry(merged, res);
    if (!validated) return;
    validated.id = existing.id;

    await db.query(
      `UPDATE schedule_entries
       SET user_id = ?, status = ?, start_date = ?, end_date = ?, start_time = ?, end_time = ?,
           timezone = ?, note = ?, visibility = ?, event_color = ?, source = ?, source_provider = ?,
           source_event_id = ?, updated_by = ?
       WHERE id = ?`,
      toUpdateValues(validated, getUserId(req))
    );

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.patch('/entries/:id/visibility', validate(scheduleEntryVisibilityUpdate), async (req, res, next) => {
  try {
    const existing = await fetchEntry(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Schedule entry not found' });
    }

    if (!isProviderOwned(existing)) {
      return res.status(409).json({ error: 'Only connected calendar events can use this sharing control.' });
    }

    if (!requireProviderVisibilityOwner(existing, req, res)) return;
    if (!requireShareableProviderDetails(existing, req.body.visibility, res)) return;

    await db.query(
      `UPDATE schedule_entries
       SET visibility = ?,
           updated_by = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [req.body.visibility, getUserId(req), req.params.id]
    );

    const updated = await fetchEntry(req.params.id);
    res.json({
      success: true,
      entry: presentScheduleEntry(updated || { ...existing, visibility: req.body.visibility }, req),
    });
  } catch (error) {
    next(error);
  }
});

router.delete('/entries/:id', async (req, res, next) => {
  try {
    const existing = await fetchEntry(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Schedule entry not found' });
    }

    if (!requireEditableEntry(existing, res)) return;

    if (!requireScheduleAccess(req, res, existing.user_id)) return;

    await db.query('DELETE FROM schedule_entries WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
