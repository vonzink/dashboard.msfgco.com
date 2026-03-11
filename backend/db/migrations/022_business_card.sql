-- Migration 022: Add business_card_s3_key to user_profiles
ALTER TABLE user_profiles
  ADD COLUMN business_card_s3_key VARCHAR(500) DEFAULT NULL AFTER avatar_s3_key;
