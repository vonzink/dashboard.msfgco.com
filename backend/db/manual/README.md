# Manual, run-once SQL

Scripts here are **never executed automatically**. `backend/db/migrations.js`
only runs files in `backend/db/migrations/`, and it re-runs EVERY file there on
EVERY backend restart — so anything that writes data (INSERT/UPDATE/DELETE)
must live here instead and be applied once, by hand, in a SQL client.

Why this matters: `seed_directory_headshots.sql` upserts
`user_profiles.avatar_s3_key` for 13 named people. As a migration it would
re-apply those keys on every deploy, silently reverting any profile photo a
person had uploaded through the UI since. Run it once (after verifying the
name list still matches) or not at all.
