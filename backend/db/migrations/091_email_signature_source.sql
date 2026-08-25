-- Migration 091: email_signature_source — how a person's email signature is
-- authored. 'template' means the MSFG generator fills it from this profile
-- (the default, and what the Generate button in Admin Settings produces).
-- 'custom' means the person supplies their own HTML and the generator is kept
-- out of the way so it can never overwrite it. NULL is treated as 'template'.
-- The signature body itself still lives in email_signature, so every consumer
-- (directory contact card, user settings) keeps reading one field.
-- Idempotent DDL only.
ALTER TABLE user_profiles
  ADD COLUMN email_signature_source VARCHAR(20) DEFAULT NULL AFTER email_signature;
