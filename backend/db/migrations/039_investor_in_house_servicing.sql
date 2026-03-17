-- Add in_house_servicing text field to investors (separate from servicing toggle)
ALTER TABLE investors ADD COLUMN IF NOT EXISTS in_house_servicing VARCHAR(255) DEFAULT NULL AFTER epo;
