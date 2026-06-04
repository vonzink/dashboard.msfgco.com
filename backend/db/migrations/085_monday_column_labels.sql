-- 085_monday_column_labels.sql
-- Cache each status column's live Monday labels so pipeline dropdowns can be per-board.
ALTER TABLE monday_column_mappings
  ADD COLUMN labels_json TEXT NULL AFTER monday_column_title;
