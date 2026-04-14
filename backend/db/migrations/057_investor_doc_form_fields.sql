-- Migration 057: Add document form-fill fields to investors table
-- Stores 4506-C, mailing address, SSA-89, and other data per investor
-- for auto-populating forms in future features

SET @dbname = DATABASE();

SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'investors' AND COLUMN_NAME = 'doc_4506c');
SET @sql = IF(@col_exists = 0,
    'ALTER TABLE investors ADD COLUMN doc_4506c TEXT NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'investors' AND COLUMN_NAME = 'doc_mailing_address');
SET @sql = IF(@col_exists = 0,
    'ALTER TABLE investors ADD COLUMN doc_mailing_address TEXT NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'investors' AND COLUMN_NAME = 'doc_ssa');
SET @sql = IF(@col_exists = 0,
    'ALTER TABLE investors ADD COLUMN doc_ssa TEXT NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'investors' AND COLUMN_NAME = 'doc_other');
SET @sql = IF(@col_exists = 0,
    'ALTER TABLE investors ADD COLUMN doc_other TEXT NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
