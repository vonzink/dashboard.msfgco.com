CREATE TABLE IF NOT EXISTS handbook_documents (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  slug       VARCHAR(100) NOT NULL UNIQUE,
  title      VARCHAR(255) NOT NULL,
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS handbook_sections (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  document_id INT UNSIGNED NOT NULL,
  slug        VARCHAR(200) NOT NULL,
  title       VARCHAR(500) NOT NULL,
  content     LONGTEXT     NOT NULL,
  sort_order  INT UNSIGNED NOT NULL DEFAULT 0,
  updated_by  INT          DEFAULT NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uk_doc_slug (document_id, slug),
  INDEX idx_document_id (document_id),
  FULLTEXT idx_ft_handbook (title, content),

  CONSTRAINT fk_handbook_doc FOREIGN KEY (document_id) REFERENCES handbook_documents(id) ON DELETE CASCADE,
  CONSTRAINT fk_handbook_editor FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
