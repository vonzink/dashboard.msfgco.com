CREATE TABLE IF NOT EXISTS calendar_sync_connections (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    provider ENUM('outlook','google') NOT NULL,
    provider_account_email VARCHAR(255) NULL,
    encrypted_access_token TEXT NULL,
    encrypted_refresh_token TEXT NULL,
    scopes TEXT NULL,
    sync_enabled TINYINT DEFAULT 1,
    privacy_default ENUM('availability_only','shared_details') DEFAULT 'availability_only',
    last_sync_at TIMESTAMP NULL,
    sync_status ENUM('not_connected','connected','syncing','error') DEFAULT 'not_connected',
    sync_error TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY uq_calendar_sync_user_provider (user_id, provider),
    INDEX idx_calendar_sync_status (sync_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS calendar_sync_mappings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    schedule_entry_id INT NOT NULL,
    provider ENUM('outlook','google') NOT NULL,
    provider_calendar_id VARCHAR(255) NULL,
    provider_event_id VARCHAR(255) NOT NULL,
    provider_etag VARCHAR(255) NULL,
    provider_change_token VARCHAR(500) NULL,
    last_synced_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (schedule_entry_id) REFERENCES schedule_entries(id) ON DELETE CASCADE,
    UNIQUE KEY uq_calendar_sync_mapping (provider, provider_event_id),
    INDEX idx_calendar_sync_entry (schedule_entry_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS calendar_sync_runs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    connection_id INT NOT NULL,
    provider ENUM('outlook','google') NOT NULL,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    finished_at TIMESTAMP NULL,
    status ENUM('running','success','error') DEFAULT 'running',
    entries_imported INT DEFAULT 0,
    entries_exported INT DEFAULT 0,
    error_message TEXT NULL,
    FOREIGN KEY (connection_id) REFERENCES calendar_sync_connections(id) ON DELETE CASCADE,
    INDEX idx_calendar_sync_runs_connection (connection_id, started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
