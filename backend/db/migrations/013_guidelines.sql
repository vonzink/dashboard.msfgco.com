-- 013_guidelines.sql
-- Guideline file + chunk tables for searchable lending guidelines

CREATE TABLE IF NOT EXISTS guideline_files (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  file_name     VARCHAR(500)  NOT NULL,
  s3_key        VARCHAR(1000) NOT NULL,
  product_type  VARCHAR(50)   NOT NULL,
  version_label VARCHAR(100)  DEFAULT NULL,
  total_pages   INT UNSIGNED  DEFAULT NULL,
  total_sections INT UNSIGNED DEFAULT NULL,
  file_size     BIGINT UNSIGNED DEFAULT NULL,
  status        ENUM('processing','ready','error') NOT NULL DEFAULT 'processing',
  error_message TEXT          DEFAULT NULL,
  uploaded_by   INT UNSIGNED  DEFAULT NULL,
  created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_product_type (product_type),
  INDEX idx_status       (status),
  CONSTRAINT fk_guideline_uploader FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS guideline_chunks (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  file_id       INT UNSIGNED  NOT NULL,
  section_id    VARCHAR(50)   DEFAULT NULL,
  section_title VARCHAR(500)  DEFAULT NULL,
  page_number   INT UNSIGNED  DEFAULT NULL,
  chunk_index   INT UNSIGNED  NOT NULL DEFAULT 0,
  content       LONGTEXT      NOT NULL,
  product_type  VARCHAR(50)   NOT NULL,
  created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_file_id      (file_id),
  INDEX idx_product_type (product_type),
  INDEX idx_section_id   (section_id),
  FULLTEXT idx_ft_search (section_title, content),

  CONSTRAINT fk_chunk_file FOREIGN KEY (file_id) REFERENCES guideline_files(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
