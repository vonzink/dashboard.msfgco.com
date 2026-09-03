-- Add the active-user flag required by authenticated route guards.
-- Existing rows remain active to preserve established employee access.
SET @webinar_users_is_active_exists = (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'users'
      AND COLUMN_NAME = 'is_active'
);

SET @webinar_users_is_active_sql = IF(
    @webinar_users_is_active_exists = 0,
    'ALTER TABLE users ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1',
    'SELECT 1'
);

PREPARE webinar_users_is_active_statement FROM @webinar_users_is_active_sql;
EXECUTE webinar_users_is_active_statement;
DEALLOCATE PREPARE webinar_users_is_active_statement;
