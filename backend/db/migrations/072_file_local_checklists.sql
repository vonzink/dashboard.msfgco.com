-- File-local (PDF-derived) checklists.
--
-- When a user converts a loan-specific PDF (e.g. underwriter conditions) into
-- a checklist, that checklist is INTENTIONALLY scoped to the loan/file it was
-- created in — not promoted to the user's global template library. This flag
-- lets the UI tint the badge in a distinct color so the user can tell at a
-- glance which checklists are file-derived vs. template-derived.

ALTER TABLE loan_checklists ADD COLUMN is_file_local BOOLEAN NOT NULL DEFAULT FALSE AFTER source_template_id;
