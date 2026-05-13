-- Performance + documentation follow-up to 065_checklists.sql.
--
-- Adds an index for the status batch query (GET /api/checklists/status/:type),
-- which scans by source_type then groups by source_item_id. Without this index
-- the query falls back to a full-table scan as loan_checklists grows.
--
-- NOTE on schema design (kept here for future reviewers; no DDL):
--   • loan_checklists.client_name is a SNAPSHOT captured at insert-time and is
--     intentionally NOT synced if the originating pipeline/pre-approvals row's
--     client_name is later edited. The Read API resolves the *current* client
--     name from the parent table for table badges; this column is kept only
--     for export filename suggestions and audit trails.
--   • The status ENUM ('not_started','in_progress','done','issue','na') is
--     repeated across 4 tables. If a new status is added later it requires
--     4 ALTER TABLE statements — acceptable for now given the stable set.

ALTER TABLE loan_checklists ADD INDEX idx_source_type (source_type);
