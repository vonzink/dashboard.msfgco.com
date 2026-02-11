-- Migration 006: Add max_comp and website_url columns to investors table
-- Also ensure all fields from the investor management form exist

ALTER TABLE investors ADD COLUMN IF NOT EXISTS max_comp DECIMAL(10,2) DEFAULT NULL;
ALTER TABLE investors ADD COLUMN IF NOT EXISTS website_url TEXT DEFAULT NULL;

-- Ensure the existing fields exist (safe idempotent adds)
ALTER TABLE investors ADD COLUMN IF NOT EXISTS states TEXT DEFAULT NULL;
ALTER TABLE investors ADD COLUMN IF NOT EXISTS best_programs TEXT DEFAULT NULL;
ALTER TABLE investors ADD COLUMN IF NOT EXISTS minimum_fico VARCHAR(64) DEFAULT NULL;
ALTER TABLE investors ADD COLUMN IF NOT EXISTS in_house_dpa VARCHAR(64) DEFAULT NULL;
ALTER TABLE investors ADD COLUMN IF NOT EXISTS epo VARCHAR(128) DEFAULT NULL;
ALTER TABLE investors ADD COLUMN IF NOT EXISTS doc_review_wire VARCHAR(64) DEFAULT NULL;
ALTER TABLE investors ADD COLUMN IF NOT EXISTS remote_closing_review VARCHAR(64) DEFAULT NULL;
