-- Add 'submitted' and 'incomplete' statuses; add 'borrower' and 'processor' assignments.

ALTER TABLE loan_checklist_items
  MODIFY COLUMN status ENUM('not_started','in_progress','submitted','done','incomplete','issue','na') DEFAULT 'not_started';

ALTER TABLE loan_checklist_subitems
  MODIFY COLUMN status ENUM('not_started','in_progress','submitted','done','incomplete','issue','na') DEFAULT 'not_started';

ALTER TABLE loan_checklist_items
  MODIFY COLUMN assigned_to ENUM('underwriter','investor','title','borrower','processor') NULL DEFAULT NULL;

-- Template tables keep the old ENUM since templates only use default_status
-- and rarely need the new values, but expand for completeness.
ALTER TABLE checklist_template_items
  MODIFY COLUMN default_status ENUM('not_started','in_progress','submitted','done','incomplete','issue','na') DEFAULT 'not_started';

ALTER TABLE checklist_template_subitems
  MODIFY COLUMN default_status ENUM('not_started','in_progress','submitted','done','incomplete','issue','na') DEFAULT 'not_started';
