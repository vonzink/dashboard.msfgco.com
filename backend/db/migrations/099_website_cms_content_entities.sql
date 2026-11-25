-- Add site/officer editorial history without altering existing page revision tables.
CREATE TABLE IF NOT EXISTS website_cms_content_revisions (
  sequence_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  revision_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
  entity_kind ENUM('site','officer') NOT NULL,
  entity_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  payload JSON NOT NULL,
  UNIQUE KEY website_cms_content_revision (entity_kind, entity_id, revision_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS website_cms_content_latest (
  entity_kind ENUM('site','officer') NOT NULL,
  entity_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  revision_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (entity_kind, entity_id),
  FOREIGN KEY (entity_kind, entity_id, revision_id) REFERENCES website_cms_content_revisions(entity_kind, entity_id, revision_id)
) ENGINE=InnoDB;
