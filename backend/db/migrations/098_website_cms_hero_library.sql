-- Immutable private creative revisions. Page assignments copy exact revisions.
-- these tables are never projected wholesale into a public snapshot.
CREATE TABLE IF NOT EXISTS website_cms_hero_revisions (
  sequence_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  revision_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
  hero_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  payload JSON NOT NULL,
  UNIQUE KEY website_cms_hero_revision (hero_id, revision_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS website_cms_hero_latest (
  hero_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  revision_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  FOREIGN KEY (hero_id, revision_id) REFERENCES website_cms_hero_revisions(hero_id, revision_id)
) ENGINE=InnoDB;
