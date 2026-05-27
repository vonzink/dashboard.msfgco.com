ALTER TABLE calendar_sync_connections
    ADD COLUMN provider_calendar_id VARCHAR(255) NULL AFTER provider_account_email,
    ADD COLUMN access_token_expires_at TIMESTAMP NULL AFTER encrypted_access_token,
    ADD COLUMN oauth_state VARCHAR(128) NULL AFTER scopes,
    ADD COLUMN oauth_state_expires_at TIMESTAMP NULL AFTER oauth_state;

ALTER TABLE calendar_sync_mappings
    DROP INDEX uq_calendar_sync_mapping,
    ADD UNIQUE KEY uq_calendar_sync_mapping (user_id, provider, provider_event_id);
