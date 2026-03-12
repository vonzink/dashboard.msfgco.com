-- ============================================================
-- Migration 025: Social Media Compliance Columns
-- Date: 2026-03-12
-- Adds extended social media tracking fields to user_profiles
-- ============================================================

-- Additional Facebook columns (business page + second personal for employees
-- who have multiple profiles, e.g. Robert Hoff)
ALTER TABLE user_profiles
  ADD COLUMN facebook_business_url  VARCHAR(512) NULL AFTER facebook_url,
  ADD COLUMN facebook_url_2         VARCHAR(512) NULL AFTER facebook_business_url;

-- Some employees have a second LinkedIn profile (e.g. Seth Angell duplicate)
ALTER TABLE user_profiles
  ADD COLUMN linkedin_url_2         VARCHAR(512) NULL AFTER linkedin_url;

-- Additional platforms surfaced during 2026-03 compliance audit
ALTER TABLE user_profiles
  ADD COLUMN nextdoor_url           VARCHAR(512) NULL AFTER tiktok_url,
  ADD COLUMN google_my_business_url VARCHAR(512) NULL AFTER nextdoor_url;

-- Compliance audit tracking fields
ALTER TABLE user_profiles
  ADD COLUMN social_audit_date      DATE         NULL AFTER google_my_business_url,
  ADD COLUMN social_audit_notes     TEXT         NULL AFTER social_audit_date;
