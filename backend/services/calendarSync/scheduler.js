const db = require('../../db/connection');
const logger = require('../../lib/logger');
const { runSyncForConnection } = require('./syncEngine');
const outlookProvider = require('./providers/outlook');

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;
const running = new Set();

function getRows(result) {
  return Array.isArray(result?.[0]) ? result[0] : result;
}

function adapterFor(provider) {
  if (provider === 'outlook') return outlookProvider;
  return null;
}

async function loadDueConnections() {
  const result = await db.query(
    `SELECT *
     FROM calendar_sync_connections
     WHERE sync_enabled = 1
       AND encrypted_refresh_token IS NOT NULL
       AND sync_status IN ('connected','error')`
  );
  return getRows(result) || [];
}

async function runScheduledSyncOnce() {
  const connections = await loadDueConnections();

  for (const connection of connections) {
    if (running.has(connection.id)) continue;

    const adapter = adapterFor(connection.provider);
    if (!adapter) continue;

    running.add(connection.id);
    try {
      await runSyncForConnection(connection, adapter);
    } catch (error) {
      logger.warn({ err: error, connectionId: connection.id }, 'Scheduled calendar sync failed');
    } finally {
      running.delete(connection.id);
    }
  }
}

function startCalendarSyncScheduler(intervalMs = DEFAULT_INTERVAL_MS) {
  if (process.env.CALENDAR_SYNC_SCHEDULER_ENABLED === 'false') return null;

  const timer = setInterval(() => {
    runScheduledSyncOnce().catch((error) => {
      logger.warn({ err: error }, 'Calendar sync scheduler tick failed');
    });
  }, intervalMs);
  if (timer.unref) timer.unref();
  return timer;
}

module.exports = {
  loadDueConnections,
  runScheduledSyncOnce,
  startCalendarSyncScheduler,
};
