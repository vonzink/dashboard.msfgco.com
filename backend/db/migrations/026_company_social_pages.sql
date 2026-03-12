-- ============================================================
-- Migration 026: Company Social Media Pages
-- Date: 2026-03-12
-- Stores company-level social media pages (not individual
-- employee profiles). Used for compliance monitoring and
-- linking from the dashboard.
-- ============================================================

CREATE TABLE IF NOT EXISTS company_social_pages (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    platform     VARCHAR(50)  NOT NULL,           -- facebook, instagram, linkedin, etc.
    page_name    VARCHAR(255) NOT NULL,           -- display label
    url          VARCHAR(512) NOT NULL,
    description  VARCHAR(500) NULL,              -- notes / context
    is_active    TINYINT(1)   NOT NULL DEFAULT 1,
    created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_platform (platform),
    INDEX idx_is_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
