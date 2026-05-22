-- Add credit providers field to investors
ALTER TABLE investors
  ADD COLUMN credit_providers TEXT AFTER adverse_action_notice;
