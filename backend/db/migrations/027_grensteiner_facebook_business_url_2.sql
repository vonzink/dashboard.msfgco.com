-- ============================================================
-- Migration 027: Add facebook_business_url_2 to user_profiles
-- Date: 2026-03-12
-- Reason: Michael Grensteiner has two Facebook business pages —
--   1. facebook.com/Michael-Grensteiner-MSFG-113742783646531/
--   2. facebook.com/profile.php?id=100057098994147
--         ("Michael Grensteiner - Mountain State Financial Group")
-- ============================================================

ALTER TABLE user_profiles
  ADD COLUMN facebook_business_url_2 VARCHAR(512) NULL AFTER facebook_business_url;
