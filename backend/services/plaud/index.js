/**
 * services/plaud
 *
 * Plaud voice-recorder integration: pulls new recordings into our S3 archive.
 * Entry point for cron is scripts/plaud-sync.js. Setup lives in
 * docs/PLAUD_SYNC.md.
 */

const { PlaudClient, PlaudAuthError, PlaudApiError } = require('./client');
const { runPlaudSync, buildS3Key, AudioNotReadyError, STATUS } = require('./sync');

module.exports = {
  PlaudClient,
  PlaudAuthError,
  PlaudApiError,
  AudioNotReadyError,
  STATUS,
  runPlaudSync,
  buildS3Key,
};
