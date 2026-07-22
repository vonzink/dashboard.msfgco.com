-- 083_seed_directory_headshots.sql
-- Seed Team Directory contact-card photos (user_profiles.avatar_s3_key) from
-- headshots that already live in the msfg-media bucket (us-west-2) under
-- Assets/HEADSHOTS/. Keys are stored RAW (literal spaces) because the backend
-- resolveUrl() presigns the key and the AWS SDK URL-encodes it at request time.
--
-- SAFE BY CONSTRUCTION:
--   * Matches on users.name (case-insensitive collation).
--   * Upsert: creates the profile row if missing, else updates avatar_s3_key.
--   * A name that matches no user is a no-op -- it can never assign a photo to
--     the wrong person as long as the full name is unique.
--   * Idempotent: re-running re-applies the same keys.
--
-- VERIFY NAMES MATCH before applying (run in a SQL client, then add a trailing
-- semicolon):
--   SELECT id, name FROM users
--   WHERE name IN ('Ashley Iverson','Robert Hoff','Jeremy Cox','Jessica Haukeness',
--   'Josh Sourial','Kimberly Thomas','Kray Olson','Laura Schlour','Mike Grensteiner',
--   'Noah Youngs','Zane Krause','Tanya Long','Tracy Roberts') ORDER BY name
-- Any of the 13 missing from the result = name mismatch; that person won't get set.

INSERT INTO user_profiles (user_id, avatar_s3_key)
SELECT id, 'Assets/HEADSHOTS/Ashley.png' FROM users WHERE name = 'Ashley Iverson'
ON DUPLICATE KEY UPDATE avatar_s3_key = 'Assets/HEADSHOTS/Ashley.png';

INSERT INTO user_profiles (user_id, avatar_s3_key)
SELECT id, 'Assets/HEADSHOTS/Hoff Headshot.png' FROM users WHERE name = 'Robert Hoff'
ON DUPLICATE KEY UPDATE avatar_s3_key = 'Assets/HEADSHOTS/Hoff Headshot.png';

INSERT INTO user_profiles (user_id, avatar_s3_key)
SELECT id, 'Assets/HEADSHOTS/Jeremy Cox.png' FROM users WHERE name = 'Jeremy Cox'
ON DUPLICATE KEY UPDATE avatar_s3_key = 'Assets/HEADSHOTS/Jeremy Cox.png';

INSERT INTO user_profiles (user_id, avatar_s3_key)
SELECT id, 'Assets/HEADSHOTS/jessica.png' FROM users WHERE name = 'Jessica Haukeness'
ON DUPLICATE KEY UPDATE avatar_s3_key = 'Assets/HEADSHOTS/jessica.png';

INSERT INTO user_profiles (user_id, avatar_s3_key)
SELECT id, 'Assets/HEADSHOTS/josh.png' FROM users WHERE name = 'Josh Sourial'
ON DUPLICATE KEY UPDATE avatar_s3_key = 'Assets/HEADSHOTS/josh.png';

INSERT INTO user_profiles (user_id, avatar_s3_key)
SELECT id, 'Assets/HEADSHOTS/Kimberly.png' FROM users WHERE name = 'Kimberly Thomas'
ON DUPLICATE KEY UPDATE avatar_s3_key = 'Assets/HEADSHOTS/Kimberly.png';

INSERT INTO user_profiles (user_id, avatar_s3_key)
SELECT id, 'Assets/HEADSHOTS/Kray.png' FROM users WHERE name = 'Kray Olson'
ON DUPLICATE KEY UPDATE avatar_s3_key = 'Assets/HEADSHOTS/Kray.png';

INSERT INTO user_profiles (user_id, avatar_s3_key)
SELECT id, 'Assets/HEADSHOTS/Laura.png' FROM users WHERE name = 'Laura Schlour'
ON DUPLICATE KEY UPDATE avatar_s3_key = 'Assets/HEADSHOTS/Laura.png';

INSERT INTO user_profiles (user_id, avatar_s3_key)
SELECT id, 'Assets/HEADSHOTS/Mike G copy.png' FROM users WHERE name = 'Mike Grensteiner'
ON DUPLICATE KEY UPDATE avatar_s3_key = 'Assets/HEADSHOTS/Mike G copy.png';

INSERT INTO user_profiles (user_id, avatar_s3_key)
SELECT id, 'Assets/HEADSHOTS/noah.jpeg' FROM users WHERE name = 'Noah Youngs'
ON DUPLICATE KEY UPDATE avatar_s3_key = 'Assets/HEADSHOTS/noah.jpeg';

INSERT INTO user_profiles (user_id, avatar_s3_key)
SELECT id, 'Assets/HEADSHOTS/zane.png' FROM users WHERE name = 'Zane Krause'
ON DUPLICATE KEY UPDATE avatar_s3_key = 'Assets/HEADSHOTS/zane.png';

INSERT INTO user_profiles (user_id, avatar_s3_key)
SELECT id, 'Assets/HEADSHOTS/Tanya.png' FROM users WHERE name = 'Tanya Long'
ON DUPLICATE KEY UPDATE avatar_s3_key = 'Assets/HEADSHOTS/Tanya.png';

INSERT INTO user_profiles (user_id, avatar_s3_key)
SELECT id, 'Assets/HEADSHOTS/Tracy.png' FROM users WHERE name = 'Tracy Roberts'
ON DUPLICATE KEY UPDATE avatar_s3_key = 'Assets/HEADSHOTS/Tracy.png';
