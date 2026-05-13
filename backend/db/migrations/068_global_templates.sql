-- Global (shared, admin-curated) checklist templates.
--
-- Allows the platform to ship a curated library of templates everyone can
-- apply to a loan, without each user needing to import them. Personal
-- templates remain per-user.
--
-- Schema changes:
--   • user_id becomes nullable — global templates have no owner.
--   • is_global flag distinguishes shared templates from personal ones.
--   • Only admins should be able to insert/edit rows where is_global = TRUE;
--     this is enforced at the service layer, not the DB.

ALTER TABLE checklist_templates MODIFY COLUMN user_id INT NULL;
ALTER TABLE checklist_templates ADD COLUMN is_global BOOLEAN NOT NULL DEFAULT FALSE AFTER user_id;
ALTER TABLE checklist_templates ADD INDEX idx_is_global (is_global);
