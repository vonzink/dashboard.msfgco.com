import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = fs.readFileSync(
  path.resolve(import.meta.dirname, '../../db/migrations/091_webinar_studio_foundation.sql'),
  'utf8'
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

  it('keeps slide identity stable and archived positions nullable', () => {
    expect(migration).toMatch(/id CHAR\(36\) NOT NULL PRIMARY KEY/);
    expect(migration).toMatch(/position INT UNSIGNED NULL/);
    expect(migration).toMatch(/UNIQUE KEY uq_webinar_slide_anchor \(webinar_id, anchor\)/);
    expect(migration).toMatch(/UNIQUE KEY uq_webinar_slide_position \(webinar_id, position\)/);
  });

  it('keys settings and notes to canonical users', () => {
    expect(migration).toMatch(/PRIMARY KEY \(user_id\)/);
    expect(migration).toMatch(/CONSTRAINT fk_webinar_settings_user FOREIGN KEY \(user_id\) REFERENCES users\(id\)/);
    expect(migration).toMatch(/CONSTRAINT fk_webinar_note_slide FOREIGN KEY \(slide_id\) REFERENCES webinar_slides\(id\)/);
  });
});
