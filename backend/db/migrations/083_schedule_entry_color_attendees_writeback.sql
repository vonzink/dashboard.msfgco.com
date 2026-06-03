SET @dbname = DATABASE();

SET @col_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @dbname
    AND TABLE_NAME = 'schedule_entries'
    AND COLUMN_NAME = 'event_color'
);
SET @sql = IF(
  @col_exists = 0,
  'ALTER TABLE schedule_entries ADD COLUMN event_color VARCHAR(20) NULL AFTER provider_sensitivity',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @dbname
    AND TABLE_NAME = 'schedule_entries'
    AND COLUMN_NAME = 'sync_write_status'
);
SET @sql = IF(
  @col_exists = 0,
  'ALTER TABLE schedule_entries ADD COLUMN sync_write_status ENUM(''idle'',''pending'',''synced'',''error'') DEFAULT ''idle'' AFTER event_color',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @dbname
    AND TABLE_NAME = 'schedule_entries'
    AND COLUMN_NAME = 'sync_write_error'
);
SET @sql = IF(
  @col_exists = 0,
  'ALTER TABLE schedule_entries ADD COLUMN sync_write_error TEXT NULL AFTER sync_write_status',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @dbname
    AND TABLE_NAME = 'schedule_entries'
    AND COLUMN_NAME = 'sync_write_attempted_at'
);
SET @sql = IF(
  @col_exists = 0,
  'ALTER TABLE schedule_entries ADD COLUMN sync_write_attempted_at TIMESTAMP NULL AFTER sync_write_error',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS schedule_entry_attendees (
  id INT AUTO_INCREMENT PRIMARY KEY,
  schedule_entry_id INT NOT NULL,
  user_id INT NULL,
  email VARCHAR(255) NOT NULL,
  name VARCHAR(255) NULL,
  response_status VARCHAR(40) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (schedule_entry_id) REFERENCES schedule_entries(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY uq_schedule_entry_attendee_email (schedule_entry_id, email),
  INDEX idx_schedule_entry_attendees_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
