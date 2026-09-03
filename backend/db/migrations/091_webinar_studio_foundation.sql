CREATE TABLE IF NOT EXISTS webinar_presentations (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    slug VARCHAR(190) NOT NULL,
    title VARCHAR(255) NOT NULL,
    primary_owner_user_id INT NOT NULL,
    master_html MEDIUMTEXT NOT NULL,
    master_css MEDIUMTEXT NOT NULL,
    live_version BIGINT UNSIGNED NOT NULL DEFAULT 0,
    audience_enabled TINYINT(1) NOT NULL DEFAULT 0,
    created_by_user_id INT NOT NULL,
    updated_by_user_id INT NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    archived_at DATETIME(3) NULL,
    UNIQUE KEY uq_webinar_slug (slug),
    CONSTRAINT fk_webinar_owner FOREIGN KEY (primary_owner_user_id) REFERENCES users(id),
    CONSTRAINT fk_webinar_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id),
    CONSTRAINT fk_webinar_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS webinar_slides (
    id CHAR(36) NOT NULL PRIMARY KEY,
    webinar_id BIGINT UNSIGNED NOT NULL,
    position INT UNSIGNED NULL,
    anchor VARCHAR(190) NOT NULL,
    title VARCHAR(255) NOT NULL,
    target_seconds INT UNSIGNED NOT NULL DEFAULT 0,
    speaker_notes MEDIUMTEXT NOT NULL,
    html MEDIUMTEXT NOT NULL,
    css MEDIUMTEXT NOT NULL,
    javascript MEDIUMTEXT NOT NULL,
    created_by_user_id INT NOT NULL,
    updated_by_user_id INT NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    archived_at DATETIME(3) NULL,
    UNIQUE KEY uq_webinar_slide_anchor (webinar_id, anchor),
    UNIQUE KEY uq_webinar_slide_position (webinar_id, position),
    CONSTRAINT fk_webinar_slide_webinar FOREIGN KEY (webinar_id) REFERENCES webinar_presentations(id),
    CONSTRAINT fk_webinar_slide_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id),
    CONSTRAINT fk_webinar_slide_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS webinar_revisions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    webinar_id BIGINT UNSIGNED NOT NULL,
    version BIGINT UNSIGNED NOT NULL,
    snapshot JSON NOT NULL,
    change_type VARCHAR(40) NOT NULL,
    change_summary VARCHAR(255) NOT NULL,
    created_by_user_id INT NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_webinar_revision_version (webinar_id, version),
    CONSTRAINT fk_webinar_revision_webinar FOREIGN KEY (webinar_id) REFERENCES webinar_presentations(id),
    CONSTRAINT fk_webinar_revision_user FOREIGN KEY (created_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS webinar_presenter_settings (
    user_id INT NOT NULL,
    shortcuts JSON NOT NULL,
    preferences JSON NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (user_id),
    CONSTRAINT fk_webinar_settings_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS webinar_presenter_notes (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    webinar_id BIGINT UNSIGNED NOT NULL,
    slide_id CHAR(36) NOT NULL,
    body TEXT NOT NULL,
    source_system VARCHAR(40) NULL,
    source_record_id VARCHAR(190) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    KEY idx_webinar_notes_owner_slide (user_id, webinar_id, slide_id),
    UNIQUE KEY uq_webinar_note_legacy_source (source_system, source_record_id),
    CONSTRAINT fk_webinar_note_user FOREIGN KEY (user_id) REFERENCES users(id),
    CONSTRAINT fk_webinar_note_webinar FOREIGN KEY (webinar_id) REFERENCES webinar_presentations(id),
    CONSTRAINT fk_webinar_note_slide FOREIGN KEY (slide_id) REFERENCES webinar_slides(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS webinar_audit_events (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    webinar_id BIGINT UNSIGNED NULL,
    actor_user_id INT NOT NULL,
    event_type VARCHAR(64) NOT NULL,
    target_type VARCHAR(40) NOT NULL,
    target_id VARCHAR(190) NULL,
    metadata JSON NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY idx_webinar_audit_webinar_time (webinar_id, created_at),
    CONSTRAINT fk_webinar_audit_webinar FOREIGN KEY (webinar_id) REFERENCES webinar_presentations(id),
    CONSTRAINT fk_webinar_audit_actor FOREIGN KEY (actor_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
