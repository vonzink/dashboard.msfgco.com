-- Assignment category for checklist items: underwriter, investor, title.
-- Color-coded in the UI (two shades of blue + neutral).
ALTER TABLE loan_checklist_items
  ADD COLUMN assigned_to ENUM('underwriter','investor','title') NULL DEFAULT NULL
  AFTER importance;

ALTER TABLE loan_checklist_items ADD INDEX idx_assigned_to (assigned_to);
