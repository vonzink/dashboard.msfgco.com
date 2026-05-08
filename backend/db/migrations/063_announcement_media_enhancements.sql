ALTER TABLE announcements
  ADD COLUMN links_json TEXT NULL AFTER link,
  ADD COLUMN attachments_json TEXT NULL AFTER file_type,
  ADD COLUMN image_s3_key VARCHAR(500) NULL AFTER attachments_json,
  ADD COLUMN image_name VARCHAR(255) NULL AFTER image_s3_key,
  ADD COLUMN image_size INT NULL AFTER image_name,
  ADD COLUMN image_type VARCHAR(100) NULL AFTER image_size;
