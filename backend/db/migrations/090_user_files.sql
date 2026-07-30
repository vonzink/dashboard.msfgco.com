-- ========================================
-- 090: My Files — per-user S3 storage
-- Backs the msfg-user-folders bucket. S3 stays the source of truth for the
-- file tree itself, so there is deliberately no file index here. These tables
-- cover only what S3 cannot answer cheaply: who did what, how much space a
-- user is using, and the state of long-running folder operations.
-- NOTE: never use a semicolon inside these comments. migrations.js splits the
-- file on the statement separator BEFORE stripping comments, so a semicolon in
-- a comment truncates the statement that follows and the migration fails.
-- ========================================
CREATE TABLE IF NOT EXISTS user_file_audit (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,              -- Whose files were touched
    actor_user_id INT,                 -- Who performed it (differs on admin access)
    action VARCHAR(24) NOT NULL,       -- list/upload/download/preview/move/delete/restore/purge/admin_list/admin_download
    s3_key VARCHAR(1024),
    bytes BIGINT,
    ip VARCHAR(45),                    -- 45 chars covers IPv6
    user_agent VARCHAR(512),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_ufa_user (user_id, created_at),
    INDEX idx_ufa_actor (actor_user_id, created_at)

    -- No foreign keys here on purpose. An audit trail has to outlive the
    -- accounts it describes - cascading the delete would erase exactly the
    -- record you need when someone asks what a departed employee accessed,
    -- and nulling the actor would erase who did it. Orphaned ids are the
    -- correct outcome for this table, unlike the quota and job tables below.
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Maintained incrementally on upload and permanent delete. Recomputing from
-- ListObjectsV2 on every request does not scale, so a nightly job reconciles
-- bytes_used against S3 and records when it last did so.
CREATE TABLE IF NOT EXISTS user_file_quota (
    user_id INT PRIMARY KEY,
    bytes_used BIGINT NOT NULL DEFAULT 0,
    file_count INT NOT NULL DEFAULT 0,
    -- NULL means "use the system default" (USER_FILES_QUOTA_BYTES). Set a value
    -- here only to grant one user a different allowance.
    quota_bytes BIGINT NULL,
    reconciled_at TIMESTAMP NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- S3 has no folder rename. Moving or deleting a folder means copying and
-- deleting every object beneath it, which is neither atomic nor fast. Small
-- operations run synchronously - large ones become a row here and are polled.
CREATE TABLE IF NOT EXISTS user_file_jobs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    type VARCHAR(16) NOT NULL,         -- move/delete
    status VARCHAR(16) NOT NULL DEFAULT 'pending',  -- pending/running/done/failed
    source_prefix VARCHAR(1024),
    dest_prefix VARCHAR(1024),
    total_objects INT NOT NULL DEFAULT 0,
    processed_objects INT NOT NULL DEFAULT 0,
    error TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_ufj_user (user_id, created_at),
    INDEX idx_ufj_status (status),

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
