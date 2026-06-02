SET @dbname = DATABASE();

SET @col_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @dbname
    AND TABLE_NAME = 'schedule_entries'
    AND COLUMN_NAME = 'details_shareable'
);
SET @sql = IF(
  @col_exists = 0,
  'ALTER TABLE schedule_entries ADD COLUMN details_shareable TINYINT DEFAULT 0 AFTER source_event_id',
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
    AND COLUMN_NAME = 'provider_sensitivity'
);
SET @sql = IF(
  @col_exists = 0,
  'ALTER TABLE schedule_entries ADD COLUMN provider_sensitivity VARCHAR(40) NULL AFTER details_shareable',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
