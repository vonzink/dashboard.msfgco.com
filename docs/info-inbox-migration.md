# MSFG info inbox migration — 2026-09-25

## Running system

- SES receipt rule `ReceiveInfo/StoreInfoToS3` receives **info@msfginfo.com** into `s3://msfginfo-emails/info_emails/`. The receipt rule and DNS were not changed.
- Dashboard page: `https://dashboard.msfgco.com/info-inbox.html`.
- The existing `https://email.msfginfo.com` bookmark redirects to that page.
- Backend: `/api/info-inbox` and `/api/info-inbox/message`, hosted by the existing dashboard backend on `msfg-main` (`i-009758ffb4622ba02`). Active, mapped, non-external dashboard users are required. Mail responses use `Cache-Control: no-store`.
- S3 access uses EC2 role `msfg-dashboard-ec2-role`, inline policy `MSFGInfoInbox`. No IAM-user key is used by the new component.
- `msfg-info-email-cleaner.timer` runs every half hour. The oneshot service calls `backend/scripts/info-email-cleaner.js` and logs counts only to journald.
- Originals remain in S3. Text copies are created at `cleaned/info_emails/<original-name>` only when absent. Processing follows every S3 page; it never processes `viewer/` and never deletes objects.
- The viewer combines raw and legacy copies, preferring the original when both exist. It pages through 100 messages at a time and isolates HTML email in a sandboxed frame. Historical cleaned messages have only their surviving text; previously deleted formatting and attachments cannot be reconstructed.

## Cutover

- Local copies of the old cleaner, dependency lock, viewer HTML, crontab, SES receipt configuration, and bucket/guest-role policies are in `/Users/zacharyzink/Documents/ChatGPT/AWS/migration-backup/` (not committed).
- The destination backend was backed up at `/home/ubuntu/deploy-backups/email-migration-20260925/backend-before.tgz`; its `.env` and uploads were left in place.
- A full Lightsail snapshot was requested: `n8n-before-email-migration-20260925`. Check that its state is `available` before deleting the source instance.
- A separate consistent PostgreSQL dump and n8n configuration/data archive were saved under the local backup's `n8n/` directory with restrictive permissions. They include recovery-sensitive material; do not commit or share them.
- The source database had 28 saved workflows, none active.
- Only the `emailCleaner.js` entry was removed from the source Ubuntu user's crontab. The original was saved on the source too.
- The `lightsail-cleaner` IAM key was confirmed as the source script's credential and set **Inactive** after destination verification. The user remains available for rollback.
- Public list/read permissions for `info_emails/` were removed from the bucket policy. `MSFGEmailViewerS3Access` was removed from the legacy unauthenticated Cognito role `MSFGEmail`. The attached managed policy `Cognito-unauthenticated-1761853156621` was also detached: its active version v2 independently granted mailbox access (v1 did not). No Cognito pool configuration was changed. A fresh guest session was tested and denied S3 listing; IAM simulation also denies object reads.
- The old S3 viewer object is now a redirect. Its CloudFront invalidation completed.
- The frontend deployment added only the new page and its hashed dependencies. Existing published dashboard files were preserved. `js/config.js` points future builds' Rate Sheet link directly at the new page; the currently published menu works through the legacy redirect.

## Verification

- 17 new tests pass: preservation, pagination, idempotency, failed uploads, dry-run, old/new deduplication, invalid keys, authentication/authorization, and private error responses.
- Full backend suite: 934 pass, 5 fail. The unchanged baseline has the same five failures (917 pass):
  - `calendarSyncUi`: connected sync-health indicator; eligible Outlook bulk controls.
  - `plaudSync`: start-time key, fallback timestamp key, and uploaded-recording key (local timezone expectations).
- Changed production modules pass ESLint. Existing lint configuration treats test files as CommonJS, while the tests run as ESM under Vitest.
- Frontend build passes. Browser fixture checks confirmed list/read and no horizontal page overflow at desktop and 390-pixel width.
- Live EC2-role read confirmed **541** archived messages and a readable archived body; no message contents were emitted to logs.
- An isolated synthetic S3 email was processed by the actual systemd service. Its original ETag remained unchanged; the cleaned copy existed; anonymous reads of both returned 403. Both synthetic objects were then removed.
- The service ran successfully again with the old key inactive; timer is enabled.
- The public API returns 401 without authentication. The user confirmed live signed-in emails load and open.
- SES delivery configuration is unchanged. A new external email delivery has not been independently tested during this migration.

## Operations

```sh
sudo systemctl status msfg-info-email-cleaner.timer
sudo systemctl start msfg-info-email-cleaner.service
sudo journalctl -u msfg-info-email-cleaner.service --since today
cd /home/ubuntu/msfg-backend/backend
NODE_ENV=production node scripts/info-email-cleaner.js --dry-run
```

The destination had 3.9 GB free disk and roughly 1.7 GB available memory at migration time. Emails stay in S3. Keep the service's memory cap and serialized processing.

## Rollback and retirement

Prefer fixing the destination while keeping SES and S3 in place. The historical job deletes originals and must not be casually re-enabled.

If a complete rollback is required, disable the destination timer first, restore the backed-up application and access policies as needed, and deliberately decide whether the old destructive behavior is acceptable before restoring its crontab or key. Do not run both schedules together.

The remaining Lightsail source is `n8n`, with static IP allocation `StaticIp-n8n`. Its bundle is $12/month; a stopped instance is still billed. Deletion of the instance and release of that static IP end those resource charges. A retained snapshot continues to incur storage charges. Instance deletion/IP release are separate from this migration's deployment; record their completion below when performed.

The user explicitly approved deleting that server and releasing its IP once the snapshot finishes. Snapshot creation was still pending at handoff. Thread heartbeat `finish-n8n-lightsail-retirement` checks every five minutes, verifies the original instance ARN, completes the authorized deletion/IP release only after snapshot availability, records `migration-backup/retirement-status.json`, and then disables itself. It stays quiet while the snapshot is pending.

Instance name `msfg-main` has not been changed as part of this migration.

GoDaddy's authoritative DNS (`ns53.domaincontrol.com`) still has an A record for `automations.msfg.us` pointing to the old IP `3.94.137.116`. Remove this obsolete record in GoDaddy after retirement. A similarly named Lightsail zone is not authoritative for the live record; editing that zone alone will not remove the GoDaddy record.
