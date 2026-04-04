-- Add underwriting fee field to investors
ALTER TABLE investors ADD COLUMN underwriting_fee VARCHAR(200) NULL AFTER max_comp;
