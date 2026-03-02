ALTER TABLE announcements
  ADD COLUMN status ENUM('active', 'archived') NOT NULL DEFAULT 'active' AFTER file_type,
  ADD COLUMN archived_at TIMESTAMP NULL DEFAULT NULL AFTER status,
  ADD INDEX idx_status (status);

UPDATE announcements SET status = 'active' WHERE status = 'active';
