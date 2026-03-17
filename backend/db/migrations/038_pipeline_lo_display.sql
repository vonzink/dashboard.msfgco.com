-- Add lo_display column for multi-value "LO" column from Monday.com
-- Separate from assigned_lo_name which is the single-value "Loan Officer" dropdown
ALTER TABLE pipeline ADD COLUMN IF NOT EXISTS lo_display VARCHAR(500) DEFAULT NULL AFTER assigned_lo_name;

-- Clear saved column mappings for pipeline boards so auto-mapper
-- re-runs with correct LO vs Loan Officer distinction on next sync
DELETE mcm FROM monday_column_mappings mcm
JOIN monday_boards mb ON mcm.board_id = mb.board_id
WHERE mb.target_section = 'pipeline';
