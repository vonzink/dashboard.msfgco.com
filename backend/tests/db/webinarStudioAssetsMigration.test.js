import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDirectory = path.resolve(import.meta.dirname, '../../db/migrations');
const migrationFile = '095_webinar_studio_assets.sql';
const migrationPath = path.join(migrationsDirectory, migrationFile);
const migration = fs.existsSync(migrationPath) ? fs.readFileSync(migrationPath, 'utf8') : '';

describe('095 webinar studio assets migration', () => {
  it('uses the next immutable migration ordinal', () => {
    const migrationFiles = fs.readdirSync(migrationsDirectory).filter(file => file.endsWith('.sql'));

    expect(migrationFiles.filter(file => file.startsWith('095_'))).toEqual([migrationFile]);
  });

  it.each([
    'webinar_assets',
    'webinar_asset_versions',
    'webinar_asset_references',
    'webinar_revision_asset_references',
  ])('creates %s', table => {
    expect(migration).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  });

  it('keeps asset versions unique within their immutable family', () => {
    expect(migration).toContain('UNIQUE KEY uq_webinar_asset_version (asset_id, version_number)');
  });

  it('uses exactly the asset-version lifecycle statuses', () => {
    expect(migration).toContain(
      "status ENUM('processing','available','rejected','archived') NOT NULL DEFAULT 'processing'",
    );
  });

  it('limits live references to the five executable content surfaces', () => {
    const match = migration.match(/surface ENUM\(([^)]+)\) NOT NULL/);

    expect(match?.[1].split(',')).toEqual([
      "'master_html'",
      "'master_css'",
      "'slide_html'",
      "'slide_css'",
      "'slide_javascript'",
    ]);
  });

  it('keys live and revision references to the canonical versioned records', () => {
    expect(migration).toContain(
      'CONSTRAINT fk_webinar_asset_reference_webinar FOREIGN KEY (webinar_id) REFERENCES webinar_presentations(id)',
    );
    expect(migration).toContain(
      'CONSTRAINT fk_webinar_asset_reference_slide FOREIGN KEY (slide_id) REFERENCES webinar_slides(id)',
    );
    expect(migration).toContain(
      'CONSTRAINT fk_webinar_asset_reference_version FOREIGN KEY (asset_version_id) REFERENCES webinar_asset_versions(id)',
    );
    expect(migration).toContain(
      'CONSTRAINT fk_webinar_revision_asset_revision FOREIGN KEY (revision_id) REFERENCES webinar_revisions(id)',
    );
    expect(migration).toContain(
      'CONSTRAINT fk_webinar_revision_asset_version FOREIGN KEY (asset_version_id) REFERENCES webinar_asset_versions(id)',
    );
  });

  it('prevents duplicate historical dependencies and duplicate live surface references', () => {
    expect(migration).toContain('PRIMARY KEY (revision_id, asset_version_id)');
    expect(migration).toContain(
      'UNIQUE KEY uq_webinar_asset_reference (webinar_id, slide_id, asset_version_id, surface)',
    );
  });
});
