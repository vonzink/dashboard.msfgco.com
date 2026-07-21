-- Migration 087: two-sided business cards + brand choice.
--
-- All business cards now have a front AND a back (compliance: company logo +
-- company NMLS on the back). business_card_html keeps the front;
-- business_card_back_html stores the back. business_card_brand records which
-- brand the card was generated for ('msfg' or 'compass') so the tab reopens
-- with the right selection. Idempotent DDL only.
ALTER TABLE user_profiles
  ADD COLUMN business_card_back_html MEDIUMTEXT DEFAULT NULL AFTER business_card_html;

ALTER TABLE user_profiles
  ADD COLUMN business_card_brand VARCHAR(20) DEFAULT NULL AFTER business_card_back_html;
