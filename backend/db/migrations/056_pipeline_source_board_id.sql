-- Migration 056: Add source_board_id to pipeline table
-- Pipeline was missing this column, causing SQL errors in LO board-access filtering
-- and preventing board-level access control from working on pipeline items

SET @dbname = DATABASE();

SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'pipeline' AND COLUMN_NAME = 'source_board_id');
SET @sql = IF(@col_exists = 0,
    'ALTER TABLE pipeline ADD COLUMN source_board_id VARCHAR(50) NULL',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Add index for board-based filtering
SET @idx_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'pipeline' AND INDEX_NAME = 'idx_pipeline_source_board');
SET @sql = IF(@idx_exists = 0,
    'CREATE INDEX idx_pipeline_source_board ON pipeline (source_board_id)',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
