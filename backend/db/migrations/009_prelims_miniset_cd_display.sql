-- ============================================================
-- MSFG Dashboard - Migration 009
-- Add Prelims, Mini Set, CD columns to pipeline table
-- Formalize display config columns on monday_column_mappings
-- ============================================================

-- ========================================
-- 1. PRELIMS STATUS
-- ========================================
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pipeline' AND COLUMN_NAME = 'prelims_status');
SET @sql = IF(@col = 0,
    'ALTER TABLE pipeline ADD COLUMN prelims_status VARCHAR(150) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ========================================
-- 2. MINI SET STATUS
-- ========================================
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pipeline' AND COLUMN_NAME = 'mini_set_status');
SET @sql = IF(@col = 0,
    'ALTER TABLE pipeline ADD COLUMN mini_set_status VARCHAR(150) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ========================================
-- 3. CD STATUS
-- ========================================
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pipeline' AND COLUMN_NAME = 'cd_status');
SET @sql = IF(@col = 0,
    'ALTER TABLE pipeline ADD COLUMN cd_status VARCHAR(150) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ========================================
-- 4. DISPLAY_LABEL on monday_column_mappings
-- ========================================
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'monday_column_mappings' AND COLUMN_NAME = 'display_label');
SET @sql = IF(@col = 0,
    'ALTER TABLE monday_column_mappings ADD COLUMN display_label VARCHAR(255) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ========================================
-- 5. DISPLAY_ORDER on monday_column_mappings
-- ========================================
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'monday_column_mappings' AND COLUMN_NAME = 'display_order');
SET @sql = IF(@col = 0,
    'ALTER TABLE monday_column_mappings ADD COLUMN display_order INT DEFAULT 99',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ========================================
-- 6. VISIBLE on monday_column_mappings
-- ========================================
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'monday_column_mappings' AND COLUMN_NAME = 'visible');
SET @sql = IF(@col = 0,
    'ALTER TABLE monday_column_mappings ADD COLUMN visible TINYINT(1) DEFAULT 1',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
