-- ============================================================
-- Migration 005 - Add cognito_sub to users table
-- Allows user lookup by Cognito sub (UUID) for access tokens
-- that don't include the email claim.
-- ============================================================

SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'cognito_sub');
SET @sql = IF(@col = 0,
    'ALTER TABLE users ADD COLUMN cognito_sub VARCHAR(255) NULL AFTER role',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND INDEX_NAME = 'idx_cognito_sub');
SET @sql = IF(@idx = 0,
    'ALTER TABLE users ADD UNIQUE INDEX idx_cognito_sub (cognito_sub)',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
