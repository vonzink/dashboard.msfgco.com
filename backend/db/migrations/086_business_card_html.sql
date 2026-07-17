-- Migration 086: Store generated/edited business-card HTML on the profile.
--
-- The admin Business Card generator (Admin Settings ▸ employee profile ▸
-- Business Card tab) produces a self-contained HTML document. Persisting it
-- here lets the finished card render in the Business Card slot on Basic Info
-- and survive reloads. Distinct from business_card_s3_key, which is a manually
-- uploaded card IMAGE. MEDIUMTEXT so large cards never truncate.
ALTER TABLE user_profiles
  ADD COLUMN business_card_html MEDIUMTEXT DEFAULT NULL AFTER business_card_s3_key;
