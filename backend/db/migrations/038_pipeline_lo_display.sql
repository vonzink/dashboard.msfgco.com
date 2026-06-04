-- Add lo_display column for multi-value "LO" column from Monday.com
-- Separate from assigned_lo_name which is the single-value "Loan Officer" dropdown
ALTER TABLE pipeline ADD COLUMN IF NOT EXISTS lo_display VARCHAR(500) DEFAULT NULL AFTER assigned_lo_name;

-- Re-map DELETE removed 2026-06-03: migrations.js re-runs every file on every boot
-- (no applied-tracking), so this DELETE wiped ALL pipeline column mappings on every
-- restart, breaking Monday status/stage write-back until a manual full sync rebuilt
-- them. The LO-vs-Loan-Officer re-map purpose is long done; the auto-mapper now
-- produces correct mappings, so this one-time clear must NOT run anymore.
