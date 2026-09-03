-- ========================================
-- 091: Plaud recordings — audio archive sync
-- One row per Plaud recording the sync job (scripts/plaud-sync.js) has seen.
-- The MP3 itself lives in S3 (PLAUD_S3_BUCKET). This table exists so the job
-- never uploads the same recording twice and so a failure is visible in the
-- database instead of buried in a cron log.
-- NOTE: never use a semicolon inside these comments. migrations.js splits the
-- file on the statement separator BEFORE stripping comments, so a semicolon in
-- a comment truncates the statement that follows and the migration fails.
-- ========================================
CREATE TABLE IF NOT EXISTS plaud_recordings (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    plaud_file_id VARCHAR(64) NOT NULL,     -- Plaud's own id for the recording
    name VARCHAR(512),                      -- Title as shown in the Plaud app
    device_serial VARCHAR(64),              -- Which recorder it came from
    recorded_at DATETIME,                   -- start_at from Plaud
    duration_ms INT,
    s3_bucket VARCHAR(128),
    s3_key VARCHAR(1024),
    bytes BIGINT,
    status VARCHAR(16) NOT NULL DEFAULT 'pending',   -- pending/synced/failed
    attempts INT NOT NULL DEFAULT 0,        -- Real failures only, not "audio not ready yet"
    last_error TEXT,
    synced_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_plaud_file (plaud_file_id),
    INDEX idx_plaud_status (status, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
