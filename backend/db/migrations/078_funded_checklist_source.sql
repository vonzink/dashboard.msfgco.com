-- Allow checklists to attach to funded loans (archive view).

ALTER TABLE loan_checklists
  MODIFY COLUMN source_type ENUM('pipeline','pre_approval','application','funded') NOT NULL;
