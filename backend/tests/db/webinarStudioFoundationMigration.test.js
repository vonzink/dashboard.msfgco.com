import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = fs.readFileSync(
  path.resolve(import.meta.dirname, '../../db/migrations/091_webinar_studio_foundation.sql'),
  'utf8'
);
const activeAnchorMigration = fs.readFileSync(
  path.resolve(import.meta.dirname, '../../db/migrations/092_webinar_active_slide_anchors.sql'),
  'utf8',
);

describe('091 webinar studio foundation migration', () => {
  it.each([
    'webinar_presentations',
    'webinar_slides',
    'webinar_revisions',
    'webinar_presenter_settings',
    'webinar_presenter_notes',
    'webinar_audit_events',
  ])('creates %s', table => {
    expect(migration).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  });

  it.each([
    'UNIQUE KEY uq_webinar_slug (slug)',
    'UNIQUE KEY uq_webinar_slide_anchor (webinar_id, anchor)',
    'UNIQUE KEY uq_webinar_slide_position (webinar_id, position)',
    'UNIQUE KEY uq_webinar_revision_version (webinar_id, version)',
    'UNIQUE KEY uq_webinar_note_legacy_source (source_system, source_record_id)',
  ])('declares unique key %s', uniqueKey => {
    expect(migration).toContain(uniqueKey);
  });

  it('keeps UUID identity and archived positions nullable', () => {
    expect(migration).toContain('id CHAR(36) NOT NULL PRIMARY KEY');
    expect(migration).toContain('slide_id CHAR(36) NOT NULL');
    expect(migration).toContain('position INT UNSIGNED NULL');
  });

  it.each([
    'snapshot JSON NOT NULL',
    'shortcuts JSON NOT NULL',
    'preferences JSON NOT NULL',
    'metadata JSON NOT NULL',
  ])('declares JSON column %s', column => {
    expect(migration).toContain(column);
  });

  it('keeps presentation and slide archive timestamps nullable', () => {
    expect(migration).toMatch(/archived_at DATETIME\(3\) NULL/g);
    expect(migration.match(/archived_at DATETIME\(3\) NULL/g)).toHaveLength(2);
  });

  it.each([
    'CONSTRAINT fk_webinar_owner FOREIGN KEY (primary_owner_user_id) REFERENCES users(id)',
    'CONSTRAINT fk_webinar_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id)',
    'CONSTRAINT fk_webinar_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES users(id)',
    'CONSTRAINT fk_webinar_slide_webinar FOREIGN KEY (webinar_id) REFERENCES webinar_presentations(id)',
    'CONSTRAINT fk_webinar_slide_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id)',
    'CONSTRAINT fk_webinar_slide_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES users(id)',
    'CONSTRAINT fk_webinar_revision_webinar FOREIGN KEY (webinar_id) REFERENCES webinar_presentations(id)',
    'CONSTRAINT fk_webinar_revision_user FOREIGN KEY (created_by_user_id) REFERENCES users(id)',
    'CONSTRAINT fk_webinar_settings_user FOREIGN KEY (user_id) REFERENCES users(id)',
    'CONSTRAINT fk_webinar_note_user FOREIGN KEY (user_id) REFERENCES users(id)',
    'CONSTRAINT fk_webinar_note_webinar FOREIGN KEY (webinar_id) REFERENCES webinar_presentations(id)',
    'CONSTRAINT fk_webinar_note_slide FOREIGN KEY (slide_id) REFERENCES webinar_slides(id)',
    'CONSTRAINT fk_webinar_audit_webinar FOREIGN KEY (webinar_id) REFERENCES webinar_presentations(id)',
    'CONSTRAINT fk_webinar_audit_actor FOREIGN KEY (actor_user_id) REFERENCES users(id)',
  ])('declares foreign key %s', foreignKey => {
    expect(migration).toContain(foreignKey);
  });

  it('keys presenter settings to canonical users', () => {
    expect(migration).toContain('PRIMARY KEY (user_id)');
  });
});

describe('092 active slide anchor migration', () => {
  it('preserves historical anchors while enforcing uniqueness only for active slides', () => {
    expect(activeAnchorMigration).toContain('active_anchor VARCHAR(190)');
    expect(activeAnchorMigration).toMatch(/CASE WHEN archived_at IS NULL THEN anchor ELSE NULL END/i);
    expect(activeAnchorMigration).toContain('DROP INDEX uq_webinar_slide_anchor');
    expect(activeAnchorMigration).toContain('UNIQUE KEY uq_webinar_slide_active_anchor (webinar_id, active_anchor)');
    expect(activeAnchorMigration.indexOf('UNIQUE KEY uq_webinar_slide_active_anchor'))
      .toBeLessThan(activeAnchorMigration.indexOf('DROP INDEX uq_webinar_slide_anchor'));
    expect(activeAnchorMigration).not.toMatch(/UPDATE\s+webinar_slides\s+SET\s+anchor/i);
  });
});
