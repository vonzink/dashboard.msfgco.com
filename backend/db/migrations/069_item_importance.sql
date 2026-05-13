-- Per-item importance flag for loan checklist items.
--
-- Behavior:
--   • normal    (default) — no visual emphasis, stays where the user drags it
--   • important            — yellow border, stays where the user drags it
--   • urgent               — red border, auto-sorted to top of the list
--
-- The "urgent floats to top" rule is enforced at SELECT time:
--   ORDER BY (importance = 'urgent') DESC, sort_order ASC, id ASC
-- Multiple urgents keep their relative sort_order amongst themselves.

ALTER TABLE loan_checklist_items
  ADD COLUMN importance ENUM('normal','important','urgent') NOT NULL DEFAULT 'normal'
  AFTER status;

ALTER TABLE loan_checklist_items ADD INDEX idx_importance (importance);
