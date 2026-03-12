-- ============================================================
-- Seed: Company Social Media Pages
-- Date: 2026-03-12
-- Run AFTER migration 026_company_social_pages.sql
-- ============================================================

-- NOTE: facebook.com/profile.php?id=100057098994147 was initially flagged as an unknown
-- company page but was identified on 2026-03-12 as Michael Grensteiner's employee business
-- page ("Michael Grensteiner - Mountain State Financial Group"). It is stored in
-- user_profiles.facebook_business_url_2 for michael.grensteiner@msfg.us — NOT here.

INSERT INTO company_social_pages (platform, page_name, url, description) VALUES
  ('facebook', 'MSFG Main', 'https://www.facebook.com/msfg.us',   'Primary Mountain State Financial Group Facebook page'),
  ('facebook', 'MSFG HL',   'https://www.facebook.com/MSFGHL',    'MSFG Home Loans Facebook page'),
  ('facebook', 'MSFG HLS',  'https://www.facebook.com/MSFGHLS/',  'MSFG Home Loan Solutions Facebook page');
