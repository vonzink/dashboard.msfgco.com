CREATE TABLE IF NOT EXISTS website_cms_authority (
  singleton TINYINT PRIMARY KEY,
  seed_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  roles_bootstrapped BOOLEAN NOT NULL DEFAULT FALSE,
  CHECK (singleton = 1)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS website_cms_grants (
  user_id INT NOT NULL,
  capability VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (user_id, capability),
  FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS website_cms_revisions (
  sequence_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  revision_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
  page_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  payload JSON NOT NULL,
  UNIQUE KEY website_cms_revision_page (page_id, revision_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS website_cms_latest (
  page_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  revision_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  FOREIGN KEY (page_id, revision_id) REFERENCES website_cms_revisions(page_id, revision_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS website_cms_requests (
  sequence_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  request_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
  phase ENUM('pending','active','conflict') NOT NULL,
  intent LONGTEXT CHARACTER SET utf8mb4 NOT NULL CHECK (JSON_VALID(intent)),
  result JSON NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS website_cms_audit (
  sequence_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  payload JSON NOT NULL
) ENGINE=InnoDB;
