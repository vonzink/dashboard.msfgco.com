-- Allow up to N (currently 3, enforced at service layer) checklists per loan.
--
-- Drops the 1:1 uniqueness, adds a name to differentiate them, and a
-- sort_order so the user can choose which badge appears leftmost in the
-- table-row icon row.

ALTER TABLE loan_checklists DROP INDEX uq_source;
ALTER TABLE loan_checklists ADD COLUMN name VARCHAR(200) NULL AFTER source_item_id;
ALTER TABLE loan_checklists ADD COLUMN sort_order INT NOT NULL DEFAULT 0 AFTER name;
