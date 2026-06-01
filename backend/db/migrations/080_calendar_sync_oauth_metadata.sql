SET @dbname = DATABASE();

SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'calendar_sync_connections' AND COLUMN_NAME = 'provider_calendar_id');
SET @sql = IF(@col_exists = 0,
    'ALTER TABLE calendar_sync_connections ADD COLUMN provider_calendar_id VARCHAR(255) NULL AFTER provider_account_email',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'calendar_sync_connections' AND COLUMN_NAME = 'access_token_expires_at');
SET @sql = IF(@col_exists = 0,
    'ALTER TABLE calendar_sync_connections ADD COLUMN access_token_expires_at TIMESTAMP NULL AFTER encrypted_access_token',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'calendar_sync_connections' AND COLUMN_NAME = 'oauth_state');
SET @sql = IF(@col_exists = 0,
    'ALTER TABLE calendar_sync_connections ADD COLUMN oauth_state VARCHAR(128) NULL AFTER scopes',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'calendar_sync_connections' AND COLUMN_NAME = 'oauth_state_expires_at');
SET @sql = IF(@col_exists = 0,
    'ALTER TABLE calendar_sync_connections ADD COLUMN oauth_state_expires_at TIMESTAMP NULL AFTER oauth_state',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @mapping_idx_exists = (SELECT COUNT(DISTINCT INDEX_NAME) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'calendar_sync_mappings' AND INDEX_NAME = 'uq_calendar_sync_mapping');
SET @mapping_idx_matches = (SELECT COUNT(*) FROM (
    SELECT INDEX_NAME
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'calendar_sync_mappings' AND INDEX_NAME = 'uq_calendar_sync_mapping'
    GROUP BY INDEX_NAME
    HAVING GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) = 'user_id,provider,provider_event_id'
        AND COUNT(*) = 3
        AND MAX(NON_UNIQUE) = 0
) AS desired_mapping_index);
SET @sql = IF(@mapping_idx_exists > 0 AND @mapping_idx_matches = 0,
    'ALTER TABLE calendar_sync_mappings DROP INDEX uq_calendar_sync_mapping',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @mapping_idx_matches = (SELECT COUNT(*) FROM (
    SELECT INDEX_NAME
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'calendar_sync_mappings' AND INDEX_NAME = 'uq_calendar_sync_mapping'
    GROUP BY INDEX_NAME
    HAVING GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) = 'user_id,provider,provider_event_id'
        AND COUNT(*) = 3
        AND MAX(NON_UNIQUE) = 0
) AS desired_mapping_index);
SET @sql = IF(@mapping_idx_matches = 0,
    'ALTER TABLE calendar_sync_mappings ADD UNIQUE KEY uq_calendar_sync_mapping (user_id, provider, provider_event_id)',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
