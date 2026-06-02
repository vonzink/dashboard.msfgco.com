-- Condition tags for checklist items:
--   category — document type   (assets / income / reo / credit / title)
--   gate     — underwriting timing gate (ptd / ptc / ptf / ctc)
-- Both single-select per item, rendered as color-coded pills in the
-- checklist Menu (two new sections) and on each item row, and usable as
-- client-side filter chips.
ALTER TABLE loan_checklist_items
  ADD COLUMN category ENUM('assets','income','reo','credit','title') NULL DEFAULT NULL AFTER assigned_to,
  ADD COLUMN gate     ENUM('ptd','ptc','ptf','ctc')                 NULL DEFAULT NULL AFTER category;

ALTER TABLE loan_checklist_items ADD INDEX idx_category (category);
ALTER TABLE loan_checklist_items ADD INDEX idx_gate (gate);
