import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDirectory = path.resolve(import.meta.dirname, '../../db/migrations');
const migrationFiles = fs.readdirSync(migrationsDirectory).filter(file => file.endsWith('.sql'));
const studioMigrationFiles = [
  '092_webinar_studio_foundation.sql',
  '093_webinar_active_slide_anchors.sql',
  '094_users_is_active.sql',
];
const obsoleteStudioMigrationFiles = [
  '091_webinar_studio_foundation.sql',
  '092_webinar_active_slide_anchors.sql',
  '093_users_is_active.sql',
];
function readMigration(file) {
  const migrationPath = path.join(migrationsDirectory, file);
  return fs.existsSync(migrationPath) ? fs.readFileSync(migrationPath, 'utf8') : '';
}
const migration = readMigration(studioMigrationFiles[0]);
const activeAnchorMigration = readMigration(studioMigrationFiles[1]);
const usersActiveMigration = readMigration(studioMigrationFiles[2]);
const canonicalSchema = fs.readFileSync(
  path.resolve(import.meta.dirname, '../../DATABASE_SCHEMA.sql'),
  'utf8',
);

describe('Webinar Studio migration ordinals', () => {
  it('uses the exact collision-free 092 through 094 Studio sequence', () => {
    for (const studioFile of studioMigrationFiles) {
      const ordinal = studioFile.slice(0, 3);
      expect(migrationFiles.filter(file => file.startsWith(`${ordinal}_`))).toEqual([studioFile]);
    }
    for (const obsoleteFile of obsoleteStudioMigrationFiles) {
      expect(migrationFiles).not.toContain(obsoleteFile);
    }
  });
});

describe('092 webinar studio foundation migration', () => {
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

describe('093 active slide anchor migration', () => {
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

describe('users.is_active schema compatibility', () => {
  it('includes an active flag in the canonical fresh-install users table', () => {
    const usersTable = canonicalSchema.match(/CREATE TABLE IF NOT EXISTS users \([\s\S]*?\n\)/)?.[0];

    expect(usersTable).toContain('is_active TINYINT(1) NOT NULL DEFAULT 1');
  });

  it('adds the active flag to existing users tables through an idempotent numbered migration', () => {
    expect(usersActiveMigration).toMatch(/INFORMATION_SCHEMA\.COLUMNS/i);
    expect(usersActiveMigration).toMatch(/TABLE_NAME\s*=\s*'users'/i);
    expect(usersActiveMigration).toMatch(/COLUMN_NAME\s*=\s*'is_active'/i);
    expect(usersActiveMigration).toContain(
      'ALTER TABLE users ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1',
    );
    expect(usersActiveMigration).toMatch(/IF\s*\(\s*@\w+\s*=\s*0/i);
  });
});

describe('canonical user preferences schema', () => {
  it('matches the migrated key-value shape and seeds both former defaults as keys', () => {
    const preferencesTable = canonicalSchema.match(
      /CREATE TABLE IF NOT EXISTS user_preferences \([\s\S]*?\n\)/,
    )?.[0];

    expect(preferencesTable).toContain('preference_key VARCHAR(100) NOT NULL');
    expect(preferencesTable).toContain('preference_value TEXT');
    expect(preferencesTable).toContain('UNIQUE KEY uq_user_pref (user_id, preference_key)');
    expect(preferencesTable).not.toMatch(/\btheme\b|\bdefault_goal_period\b/);
    expect(canonicalSchema).toMatch(
      /INSERT INTO user_preferences \(user_id, preference_key, preference_value\)[\s\S]*?'theme', 'light'/,
    );
    expect(canonicalSchema).toMatch(
      /INSERT INTO user_preferences \(user_id, preference_key, preference_value\)[\s\S]*?'default_goal_period', 'monthly'/,
    );
    expect(canonicalSchema).not.toContain(
      'INSERT INTO user_preferences (user_id, theme, default_goal_period)',
    );
  });
});
