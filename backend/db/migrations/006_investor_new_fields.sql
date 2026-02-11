-- Migration 006: Add max_comp, website_url, and detail columns to investors table
-- Note: "Duplicate column" errors are silently ignored by the migration runner

ALTER TABLE investors ADD COLUMN max_comp DECIMAL(10,2) DEFAULT NULL;
ALTER TABLE investors ADD COLUMN website_url TEXT DEFAULT NULL;
ALTER TABLE investors ADD COLUMN states TEXT DEFAULT NULL;
ALTER TABLE investors ADD COLUMN best_programs TEXT DEFAULT NULL;
ALTER TABLE investors ADD COLUMN minimum_fico VARCHAR(64) DEFAULT NULL;
ALTER TABLE investors ADD COLUMN in_house_dpa VARCHAR(64) DEFAULT NULL;
ALTER TABLE investors ADD COLUMN epo VARCHAR(128) DEFAULT NULL;
ALTER TABLE investors ADD COLUMN doc_review_wire VARCHAR(64) DEFAULT NULL;
ALTER TABLE investors ADD COLUMN remote_closing_review VARCHAR(64) DEFAULT NULL;
