const db = require('../../db/connection');
const { getSyncWindow } = require('./window');

function getRows(result) {
  return Array.isArray(result?.[0]) ? result[0] : result;
}

function getResultInfo(result) {
  return Array.isArray(result) ? result[0] : result;
}

async function updateConnectionStatus(connection, status, errorMessage = null) {
  await db.query(
    `UPDATE calendar_sync_connections
     SET sync_status = ?,
         sync_error = ?,
         last_sync_at = CASE WHEN ? = 'connected' THEN UTC_TIMESTAMP() ELSE last_sync_at END,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [status, errorMessage, status, connection.id]
  );
}

async function persistRefreshedTokens(connection, refreshed) {
  await db.query(
    `UPDATE calendar_sync_connections
     SET encrypted_access_token = ?,
         encrypted_refresh_token = ?,
         access_token_expires_at = ?,
         scopes = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [
      refreshed.encrypted_access_token,
      refreshed.encrypted_refresh_token,
      refreshed.access_token_expires_at,
      refreshed.scopes || null,
      connection.id,
    ]
  );
}

async function startRun(connection) {
  const result = await db.query(
    `INSERT INTO calendar_sync_runs (connection_id, provider, status)
     VALUES (?, ?, 'running')`,
    [connection.id, connection.provider]
  );
  return getResultInfo(result)?.insertId || null;
}

async function finishRun(runId, status, imported, exported, errorMessage = null) {
  if (!runId) return;
  await db.query(
    `UPDATE calendar_sync_runs
     SET status = ?,
         finished_at = UTC_TIMESTAMP(),
         entries_imported = ?,
         entries_exported = ?,
         error_message = ?
     WHERE id = ?`,
    [status, imported, exported, errorMessage, runId]
  );
}

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
      entry.start_time || null,
      entry.end_time || null,
      entry.timezone || 'America/Denver',
      entry.note || null,
      entry.visibility || 'availability_only',
      entry.source || entry.source_provider,
      entry.source_provider,
      entry.source_event_id,
    ]
  );
}

async function fetchMappedProviderIds(connection) {
  const result = await db.query(
    `SELECT provider_event_id
     FROM calendar_sync_mappings
     WHERE user_id = ? AND provider = ?`,
    [connection.user_id, connection.provider]
  );
  return new Set((getRows(result) || []).map((row) => String(row.provider_event_id)));
}

async function deleteStaleImportedEntries(connection, syncWindow, importedIds) {
  const baseParams = [connection.user_id, connection.provider, syncWindow.endDate, syncWindow.startDate];
  const uniqueImportedIds = Array.from(new Set(importedIds.map(String).filter(Boolean)));

  if (!uniqueImportedIds.length) {
    await db.query(
      `DELETE FROM schedule_entries
       WHERE user_id = ? AND source_provider = ? AND source_event_id IS NOT NULL
         AND start_date <= ? AND end_date >= ?`,
      baseParams
    );
    return;
  }

  const placeholders = uniqueImportedIds.map(() => '?').join(', ');
  await db.query(
    `DELETE FROM schedule_entries
     WHERE user_id = ? AND source_provider = ? AND source_event_id IS NOT NULL
       AND start_date <= ? AND end_date >= ?
       AND source_event_id NOT IN (${placeholders})`,
    [...baseParams, ...uniqueImportedIds]
  );
}

async function fetchManualEntriesForExport(connection, syncWindow) {
  const result = await db.query(
    `SELECT se.*, csm.provider_event_id, csm.provider_etag
     FROM schedule_entries se
     LEFT JOIN calendar_sync_mappings csm
       ON csm.schedule_entry_id = se.id AND csm.provider = ?
     WHERE se.user_id = ?
       AND se.source = 'manual'
       AND se.start_date <= ?
       AND se.end_date >= ?
     ORDER BY se.start_date ASC, se.start_time ASC`,
    [connection.provider, connection.user_id, syncWindow.endDate, syncWindow.startDate]
  );
  return getRows(result) || [];
}

async function upsertMapping(connection, entry, providerResult) {
  await db.query(
    `INSERT INTO calendar_sync_mappings
     (user_id, schedule_entry_id, provider, provider_event_id, provider_etag, last_synced_at)
     VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP())
     ON DUPLICATE KEY UPDATE
       provider_event_id = VALUES(provider_event_id),
       provider_etag = VALUES(provider_etag),
       last_synced_at = UTC_TIMESTAMP(),
       updated_at = CURRENT_TIMESTAMP`,
    [
      connection.user_id,
      entry.id,
      connection.provider,
      providerResult.provider_event_id,
      providerResult.provider_etag || null,
    ]
  );
}

async function exportManualEntries(connection, adapter, syncWindow) {
  if (!adapter.createEvent) return 0;

  const entries = await fetchManualEntriesForExport(connection, syncWindow);
  let exported = 0;

  for (const entry of entries) {
    const providerResult = entry.provider_event_id && adapter.updateEvent
      ? await adapter.updateEvent(connection, entry.provider_event_id, entry)
      : await adapter.createEvent(connection, entry);

    if (providerResult?.provider_event_id) {
      await upsertMapping(connection, entry, providerResult);
      exported += 1;
    }
  }

  return exported;
}

async function importProviderEntries(connection, adapter, syncWindow) {
  const mappedIds = await fetchMappedProviderIds(connection);
  const providerEntries = await adapter.listEvents(connection, syncWindow);
  const providerSeenIds = [];
  let imported = 0;

  for (const entry of providerEntries) {
    if (!entry.source_event_id) continue;

    providerSeenIds.push(entry.source_event_id);
    if (mappedIds.has(String(entry.source_event_id))) continue;

    await upsertImportedEntry(entry);
    imported += 1;
  }

  await deleteStaleImportedEntries(connection, syncWindow, providerSeenIds);
  return imported;
}

function prepareConnection(connection) {
  return {
    ...connection,
    persistRefreshedTokens: async (refreshed) => {
      Object.assign(connection, refreshed);
      await persistRefreshedTokens(connection, refreshed);
    },
  };
}

async function runSyncForConnection(connection, adapter, syncWindow = getSyncWindow()) {
  let imported = 0;
  let exported = 0;
  let runId = null;
  const syncConnection = prepareConnection(connection);

  try {
    runId = await startRun(syncConnection);
    await updateConnectionStatus(syncConnection, 'syncing');

    exported = await exportManualEntries(syncConnection, adapter, syncWindow);
    imported = await importProviderEntries(syncConnection, adapter, syncWindow);

    await updateConnectionStatus(syncConnection, 'connected');
    await finishRun(runId, 'success', imported, exported);
    return { imported, exported };
  } catch (error) {
    const message = error.message || 'Calendar sync failed';
    await updateConnectionStatus(syncConnection, 'error', message);
    await finishRun(runId, 'error', imported, exported, message);
    return { imported, exported, error: message };
  }
}

module.exports = {
  deleteStaleImportedEntries,
  exportManualEntries,
  importProviderEntries,
  runSyncForConnection,
  upsertImportedEntry,
};
