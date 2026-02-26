// Monday.com integration — re-exports for backward compatibility
const client = require('./client');
const mapper = require('./mapper');
const sync = require('./sync');

module.exports = {
  // Client
  mondayQuery: client.mondayQuery,
  fetchBoardItems: client.fetchBoardItems,
  // Mapper
  VALID_FIELDS_BY_SECTION: mapper.VALID_FIELDS_BY_SECTION,
  VALID_PIPELINE_FIELDS: mapper.VALID_PIPELINE_FIELDS,
  FIELD_LABELS: mapper.FIELD_LABELS,
  FIELD_LABELS_BY_SECTION: mapper.FIELD_LABELS_BY_SECTION,
  DEFAULT_TITLE_MAP: mapper.DEFAULT_TITLE_MAP,
  autoMapColumns: mapper.autoMapColumns,
  // Sync
  getActiveBoards: sync.getActiveBoards,
  getMondayToken: sync.getMondayToken,
  getBoardSection: sync.getBoardSection,
  getTableName: sync.getTableName,
  syncAllBoards: sync.syncAllBoards,
};
