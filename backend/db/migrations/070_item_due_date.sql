-- Separate "due date" alongside the existing "date" (completion date) on
-- loan_checklist_items. The frontend renders the due-date pill in red when
-- today > due_date AND status != 'done'.

ALTER TABLE loan_checklist_items ADD COLUMN due_date DATE NULL AFTER date;
ALTER TABLE loan_checklist_items ADD INDEX idx_due_date (due_date);
