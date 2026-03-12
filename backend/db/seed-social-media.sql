-- ============================================================
-- Seed: Employee Social Media Data
-- Date: 2026-03-12
-- Source: MSFG Social Media Compliance Audit (03/12/2026)
-- Run AFTER migration 025_social_media_compliance.sql
--
-- Pattern: UPDATE user_profiles via JOIN on users.email
-- All URLs verified during audit. See notes for flags.
-- ============================================================


-- ----------------------------------------------------------
-- Seth Angell | Executive VP | Arvada, CO | NMLS 912881
-- Flag: Duplicate LinkedIn profile found — review/remove
--       seth-angell-653466132. Two MSFG profile pages exist.
-- ----------------------------------------------------------
UPDATE user_profiles up
  INNER JOIN users u ON u.id = up.user_id
SET
  up.linkedin_url       = 'https://www.linkedin.com/in/seth-angell-8788298/',
  up.linkedin_url_2     = 'https://www.linkedin.com/in/seth-angell-653466132/',
  up.facebook_url       = 'https://www.facebook.com/seth.angell.98',
  up.instagram_url      = 'https://www.instagram.com/sethangell2022/',
  up.nmls_number        = '912881',
  up.social_audit_date  = '2026-03-12',
  up.social_audit_notes = 'Duplicate LinkedIn profile (seth-angell-653466132) — resolve which is primary. Two MSFG profile URLs: msfg.us/seth-angell and msfg.us/sethangell. Zillow profile exists.'
WHERE u.email = 'seth.angell@msfg.us';


-- ----------------------------------------------------------
-- Tracy Roberts | LO 2 | Bismarck, ND | NMLS 1611992
-- ----------------------------------------------------------
UPDATE user_profiles up
  INNER JOIN users u ON u.id = up.user_id
SET
  up.linkedin_url          = 'https://www.linkedin.com/in/tracy-roberts-501941138',
  up.facebook_url          = 'https://www.facebook.com/TracyARoberts',
  up.facebook_business_url = 'https://www.facebook.com/msfgnd/',
  up.instagram_url         = 'https://www.instagram.com/tracyrobertshomeloans/',
  up.website               = 'https://tracyrobertshomeloans.com',
  up.nmls_number           = '1611992',
  up.social_audit_date     = '2026-03-12',
  up.social_audit_notes    = 'Nextdoor profile exists — URL requires login. Personal site tracyrobertshomeloans.com redirects to MSFG profile. Yelp and Zillow profiles exist.'
WHERE u.email = 'tracy.roberts@msfg.us';


-- ----------------------------------------------------------
-- Michael Grensteiner | LO 2 | Lincoln, ND | NMLS 1948625
-- Note: Two Facebook business pages —
--   1. facebook.com/Michael-Grensteiner-MSFG-113742783646531/
--   2. "Michael Grensteiner - Mountain State Financial Group"
--      facebook.com/profile.php?id=100057098994147
--      (identified 2026-03-12 — was initially flagged as unknown)
-- ----------------------------------------------------------
UPDATE user_profiles up
  INNER JOIN users u ON u.id = up.user_id
SET
  up.linkedin_url              = 'https://www.linkedin.com/in/michael-grensteiner-b5008b232/',
  up.facebook_business_url     = 'https://www.facebook.com/Michael-Grensteiner-MSFG-113742783646531/',
  up.facebook_business_url_2   = 'https://www.facebook.com/profile.php?id=100057098994147',
  up.instagram_url             = 'https://www.instagram.com/michaelgrensteinermsfg/',
  up.nmls_number               = '1948625',
  up.social_audit_date         = '2026-03-12',
  up.social_audit_notes        = 'Second Facebook business page: "Michael Grensteiner - Mountain State Financial Group" (profile.php?id=100057098994147) identified 2026-03-12.'
WHERE u.email = 'michael.grensteiner@msfg.us';


-- ----------------------------------------------------------
-- Laura Schloer | LO 2 | Mandan, ND | NMLS 1726218
-- ----------------------------------------------------------
UPDATE user_profiles up
  INNER JOIN users u ON u.id = up.user_id
SET
  up.linkedin_url      = 'https://www.linkedin.com/in/laura-schloer/',
  up.facebook_url      = 'https://www.facebook.com/laura.schloer',
  up.instagram_url     = 'https://www.instagram.com/lauralongschloer/',
  up.nmls_number       = '1726218',
  up.social_audit_date = '2026-03-12',
  up.social_audit_notes = NULL
WHERE u.email = 'laura.schloer@msfg.us';


-- ----------------------------------------------------------
-- Jessica Haukeness | LO I | Arvada, CO | NMLS 1275913
-- ----------------------------------------------------------
UPDATE user_profiles up
  INNER JOIN users u ON u.id = up.user_id
SET
  up.facebook_url      = 'https://www.facebook.com/jessica.haukeness',
  up.nmls_number       = '1275913',
  up.social_audit_date = '2026-03-12',
  up.social_audit_notes = 'No public social media found beyond MSFG profile and Facebook.'
WHERE u.email = 'jessica.haukeness@msfg.us';


-- ----------------------------------------------------------
-- Robert Hoff | President | Arvada, CO | NMLS 608235
-- Flag: Two Facebook personal profiles found — review which
--       is primary; consider consolidating or removing one.
--       Instagram @msfgmortgage appears to be a brand account.
-- ----------------------------------------------------------
UPDATE user_profiles up
  INNER JOIN users u ON u.id = up.user_id
SET
  up.linkedin_url      = 'https://www.linkedin.com/in/robert-hoff-cfa-b64b9a45/',
  up.facebook_url      = 'https://www.facebook.com/robert.hoff.2025',
  up.facebook_url_2    = 'https://www.facebook.com/bob.hoff.984',
  up.instagram_url     = 'https://www.instagram.com/msfgmortgage/',
  up.nmls_number       = '608235',
  up.social_audit_date = '2026-03-12',
  up.social_audit_notes = 'Two Facebook personal profiles: robert.hoff.2025 and bob.hoff.984 — confirm which is primary. @msfgmortgage Instagram is a brand/business account. Zillow profile exists.'
WHERE u.email = 'robert.hoff@msfg.us';


-- ----------------------------------------------------------
-- Ashley Iverson | Processor | Arvada, CO | Non-licensed
-- ----------------------------------------------------------
UPDATE user_profiles up
  INNER JOIN users u ON u.id = up.user_id
SET
  up.facebook_url      = 'https://www.facebook.com/ashley.iverson.3705',
  up.social_audit_date = '2026-03-12',
  up.social_audit_notes = 'Non-licensed staff (Processor). No NMLS required.'
WHERE u.email = 'ashley.iverson@msfg.us';


-- ----------------------------------------------------------
-- Mike Wilson | Office Manager | Arvada, CO | Non-licensed
-- Note: DB email is michael.wilson@msfg.us
-- ----------------------------------------------------------
UPDATE user_profiles up
  INNER JOIN users u ON u.id = up.user_id
SET
  up.instagram_url     = 'https://www.instagram.com/williewils3436/',
  up.social_audit_date = '2026-03-12',
  up.social_audit_notes = 'Non-licensed staff (Office Manager). No NMLS required.'
WHERE u.email = 'michael.wilson@msfg.us';


-- ----------------------------------------------------------
-- Tanya Long | SR LO | Bismarck, ND | NMLS 1634834
-- ----------------------------------------------------------
UPDATE user_profiles up
  INNER JOIN users u ON u.id = up.user_id
SET
  up.linkedin_url          = 'https://www.linkedin.com/in/tanya-long',
  up.facebook_url          = 'https://www.facebook.com/tanya.thomaslong',
  up.facebook_business_url = 'https://www.facebook.com/ndloans/',
  up.instagram_url         = 'https://www.instagram.com/tanyalongloans/',
  up.nmls_number           = '1634834',
  up.social_audit_date     = '2026-03-12',
  up.social_audit_notes    = 'Yelp profile exists.'
WHERE u.email = 'tanya.long@msfg.us';


-- ----------------------------------------------------------
-- Kray Olson | SR LO | Moorhead, MN | NMLS 1894087
-- ⚠️ FLAG: LinkedIn shows "Compass Home Loans" — active MSFG
--    employee. Must be corrected for regulatory compliance.
-- ----------------------------------------------------------
UPDATE user_profiles up
  INNER JOIN users u ON u.id = up.user_id
SET
  up.linkedin_url      = 'https://www.linkedin.com/in/kray-olson-2b756a1b',
  up.facebook_url      = 'https://www.facebook.com/profile.php?id=100066497812304',
  up.nmls_number       = '1894087',
  up.social_audit_date = '2026-03-12',
  up.social_audit_notes = '⚠️ COMPLIANCE FLAG: LinkedIn profile displays "Compass Home Loans" as employer — must be updated to MSFG. Partner listing at movingfargomoorhead.com/partners/kray-olson/.'
WHERE u.email = 'kray.olson@msfg.us';


-- ----------------------------------------------------------
-- Josh Sourial | LO 2 | Aurora, CO | NMLS 853931
-- Note: DB email is joshua.sourial@msfg.us
-- ----------------------------------------------------------
UPDATE user_profiles up
  INNER JOIN users u ON u.id = up.user_id
SET
  up.linkedin_url      = 'https://www.linkedin.com/in/joshua-sourial-033879a/',
  up.facebook_url      = 'https://www.facebook.com/joshua.sourial',
  up.nmls_number       = '853931',
  up.social_audit_date = '2026-03-12',
  up.social_audit_notes = NULL
WHERE u.email = 'joshua.sourial@msfg.us';


-- ----------------------------------------------------------
-- Zachary Zink | SR LO / Loan Liaison | Arvada, CO | NMLS 451924
-- ----------------------------------------------------------
UPDATE user_profiles up
  INNER JOIN users u ON u.id = up.user_id
SET
  up.facebook_url      = 'https://www.facebook.com/zachary.zink.7',
  up.nmls_number       = '451924',
  up.social_audit_date = '2026-03-12',
  up.social_audit_notes = 'No public social media found beyond MSFG profile and Facebook.'
WHERE u.email = 'zachary.zink@msfg.us';


-- ============================================================
-- NOTE: facebook.com/profile.php?id=100057098994147 has been
-- identified as Michael Grensteiner's business page and is
-- captured in his UPDATE statement above (facebook_business_url_2).
-- ============================================================
