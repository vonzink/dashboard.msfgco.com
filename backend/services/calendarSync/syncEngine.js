const db = require('../../db/connection');

async function upsertImportedEntry(entry) {
  await db.query(
    `INSERT INTO schedule_entries
     (user_id, status, start_date, end_date, start_time, end_time, timezone, note, visibility, source, source_provider, source_event_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       status=VALUES(status),
       start_date=VALUES(start_date),
       end_date=VALUES(end_date),
       start_time=VALUES(start_time),
       end_time=VALUES(end_time),
       timezone=VALUES(timezone),
       note=VALUES(note),
       visibility=VALUES(visibility),
       updated_at=CURRENT_TIMESTAMP`,
    [
      entry.user_id,
      entry.status,
      entry.start_date,
      entry.end_date,
      entry.start_time,
      entry.end_time,
      entry.timezone,
      entry.note,
      entry.visibility,
      entry.source,
      entry.source_provider,
      entry.source_event_id,
    ]
  );
}

async function runSyncForConnection(connection, adapter) {
  const importedEvents = await adapter.listEvents(connection);
  let imported = 0;

  for (const entry of importedEvents) {
    await upsertImportedEntry(entry);
    imported += 1;
  }

  return { imported, exported: 0 };
}

module.exports = {
  runSyncForConnection,
  upsertImportedEntry,
};
