CREATE TABLE IF NOT EXISTS webinar_assets (
    id CHAR(36) NOT NULL PRIMARY KEY,
    display_name VARCHAR(255) NOT NULL,
    description TEXT NULL,
    created_by_user_id INT NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    archived_at DATETIME(3) NULL,
    CONSTRAINT fk_webinar_asset_creator FOREIGN KEY (created_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS webinar_asset_versions (
    id CHAR(36) NOT NULL PRIMARY KEY,
    asset_id CHAR(36) NOT NULL,
    version_number INT UNSIGNED NOT NULL,
    original_filename VARCHAR(255) NOT NULL,
    media_type ENUM('image','svg','font','audio','video') NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    byte_size BIGINT UNSIGNED NOT NULL,
    sha256 CHAR(64) NULL,
    s3_key VARCHAR(1024) NOT NULL,
    width INT UNSIGNED NULL,
    height INT UNSIGNED NULL,
    duration_ms BIGINT UNSIGNED NULL,
    status ENUM('processing','available','rejected','archived') NOT NULL DEFAULT 'processing',
    rejection_code VARCHAR(64) NULL,
    uploaded_by_user_id INT NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    archived_at DATETIME(3) NULL,
    UNIQUE KEY uq_webinar_asset_version (asset_id, version_number),
    KEY idx_webinar_asset_hash (sha256, status),
    CONSTRAINT fk_webinar_asset_version_family FOREIGN KEY (asset_id) REFERENCES webinar_assets(id),
    CONSTRAINT fk_webinar_asset_uploader FOREIGN KEY (uploaded_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS webinar_asset_references (
    webinar_id BIGINT UNSIGNED NOT NULL,
    slide_id CHAR(36) NULL,
    asset_version_id CHAR(36) NOT NULL,
    surface ENUM('master_html','master_css','slide_html','slide_css','slide_javascript') NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_webinar_asset_reference (webinar_id, slide_id, asset_version_id, surface),
    KEY idx_webinar_asset_reference_version (asset_version_id),
    CONSTRAINT fk_webinar_asset_reference_webinar FOREIGN KEY (webinar_id) REFERENCES webinar_presentations(id),
    CONSTRAINT fk_webinar_asset_reference_slide FOREIGN KEY (slide_id) REFERENCES webinar_slides(id),
    CONSTRAINT fk_webinar_asset_reference_version FOREIGN KEY (asset_version_id) REFERENCES webinar_asset_versions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS webinar_revision_asset_references (
    revision_id BIGINT UNSIGNED NOT NULL,
    asset_version_id CHAR(36) NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (revision_id, asset_version_id),
    KEY idx_webinar_revision_asset_version (asset_version_id),
    CONSTRAINT fk_webinar_revision_asset_revision FOREIGN KEY (revision_id) REFERENCES webinar_revisions(id),
    CONSTRAINT fk_webinar_revision_asset_version FOREIGN KEY (asset_version_id) REFERENCES webinar_asset_versions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
