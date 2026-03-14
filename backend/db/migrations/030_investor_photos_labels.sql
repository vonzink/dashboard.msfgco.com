-- Add AE photo to investors
ALTER TABLE investors ADD COLUMN account_executive_photo_url TEXT AFTER account_executive_address;

-- Add photo to investor team members
ALTER TABLE investor_team ADD COLUMN photo_url TEXT AFTER email;

-- Add label to mortgagee clauses
ALTER TABLE investor_mortgagee_clauses ADD COLUMN label VARCHAR(255) AFTER investor_id;
