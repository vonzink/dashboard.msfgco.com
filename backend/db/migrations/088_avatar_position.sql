-- Migration 088: avatar_position — where the profile photo sits inside the
-- circular crop. Stored as a CSS object-position value ("50% 30%") so every
-- consumer (admin profile, contact card, settings) can apply it directly.
-- NULL means centered. Reset when the photo is replaced or removed.
-- Idempotent DDL only.
ALTER TABLE user_profiles
  ADD COLUMN avatar_position VARCHAR(32) DEFAULT NULL AFTER avatar_s3_key;
