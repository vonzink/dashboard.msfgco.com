-- Add adverse action notice field to investors
ALTER TABLE investors
  ADD COLUMN adverse_action_notice TEXT AFTER in_house_servicing;
