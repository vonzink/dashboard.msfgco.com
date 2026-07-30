# EC2 AWS Credential Remediation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to work through this task-by-task. Steps use checkbox (`- [ ]`) syntax. **This plan touches production IAM and a running production host. Do not batch steps. Do not skip a verification. Stop and report on any unexpected output.**

**Goal:** Make the production EC2 host authenticate to AWS via its scoped instance role instead of long-lived `AdministratorAccess` access keys, without breaking the eight PM2 apps running on it.

**Source spec:** `docs/superpowers/specs/2026-07-30-my-files-s3-storage-design.md` §4.1

---

## The problem

`ubuntu@52.203.186.217` has the instance role `msfg-dashboard-ec2-role` attached, but also has
`/home/ubuntu/.aws/credentials` on disk. The AWS SDK and CLI credential chain resolves the
shared credentials file **before** instance metadata, so the role is never used.

Those credentials belong to IAM user `vonzink@gmail.com`, which holds `AdministratorAccess`
directly plus membership in a `FullAccess` group. Two access keys are active, created
2025-08-11 and 2025-09-23, never rotated.

All eight PM2 processes run as `ubuntu` with `HOME=/home/ubuntu`, so all eight inherit full
AWS account administrator rights. Blast radius on compromise of any one of them includes RDS,
Cognito, and every S3 bucket in the account.

This also blocks the My Files feature: its NPI controls assume a bounded backend identity, and
a KMS key policy or CloudTrail data-event trail does not constrain a principal that can
rewrite either.

---

## What the inventory found (verified 2026-07-30)

**Only two of the eight apps use the AWS SDK at all.**

| App | Working directory | AWS SDK clients |
|---|---|---|
| `msfg-backend` | `/home/ubuntu/msfg-backend/backend` | `client-s3`, `client-cognito-identity-provider` |
| `msfg-web` | `/home/ubuntu/apps/msfg.us` | `client-s3` |
| `keyword-explorer` | `/home/ubuntu/keyword-explorer` | none |
| `msfg-calc` | `/home/ubuntu/msfg-calc` | none |
| `msfg-lite-compass` | `/home/ubuntu/msfg-calc-lite-compass` | none |
| `msfg-lite-msfg` | `/home/ubuntu/msfg-calc-lite-msfg` | none |
| `msfg-docs` | `/home/ubuntu/msfg-docs` | none |
| `lendingpad-dashboard` | `/home/ubuntu/apps/lendingpad-dashboard` | none |

The six apps with no SDK usage cannot be affected by this change. Verified that no
`require('aws-sdk')` (v2) exists outside `node_modules`, and that no Bedrock/SES/SNS client is
imported anywhere — Ask AI reaches its model over plain HTTP, not IAM.

**The role's S3 grants do not cover what the backend actually uses.** This is the gap that
would have caused an outage had the keys simply been deleted.

| Bucket referenced by `msfg-backend` | Covered by the role today? |
|---|---|
| `msfg-dashboard-files` | Yes — `msfg-dashboard-s3-policy` |
| `msfg-media` | **No** |
| `msfg-mortgage-documents-prod` | **No** |
| `msfg-content-engine` | **No** |
| `msfg-internal` | **No** |

Note the near-miss: the inline policy `mortgage-app-prod-s3-access` grants access to
`msfg-mortgage-app-documents-prod`, which is **not** the same bucket as the
`msfg-mortgage-documents-prod` the Forms Library and guidelines actually use. The extra `app-`
segment means that grant does nothing for the dashboard.

Cognito is already covered by `AmazonCognitoPowerUser`. RDS uses username/password, not IAM
auth, so it is unaffected.

---

## Task 1: Confirm bucket usage before granting anything

Do not widen the role based on a `grep` alone. Two of the four uncovered buckets
(`msfg-content-engine`, `msfg-internal`) may be dead references in unused code, and granting
access to buckets nothing reads is exactly the sprawl this plan exists to reverse.

- [ ] **Step 1: Trace each uncovered bucket to a live code path**

For `msfg-media`, `msfg-mortgage-documents-prod`, `msfg-content-engine`, and `msfg-internal`,
find the referencing file and determine whether a reachable route uses it, and which
operations (`GetObject`, `PutObject`, `DeleteObject`, `ListBucket`, tagging).

Start from `backend/services/s3.js`, which defines the `BUCKETS` registry, then follow to
`backend/routes/`. Record findings in a table: bucket, file, route, operations needed.

- [ ] **Step 2: Confirm `msfg-web`'s S3 usage**

`/home/ubuntu/apps/msfg.us` imports `@aws-sdk/client-s3` but no bucket name appeared in the
scan — only static asset filenames. Determine whether it reads a bucket from an env var, or
whether the import is vestigial. If vestigial, it needs no grant.

- [ ] **Step 3: Report before proceeding**

Produce the operations-per-bucket table and stop. Task 2 is written from that table, not from
assumptions. Do not begin Task 2 without it.

---

## Task 2: Extend the instance role

- [ ] **Step 1: Draft the policy**

Write a replacement for `msfg-dashboard-s3-policy` covering every bucket confirmed in Task 1,
scoped to the operations actually used. One statement pair per bucket — object-level actions
on `arn:aws:s3:::<bucket>/*`, and `ListBucket`/`GetBucketLocation` on `arn:aws:s3:::<bucket>`.

Do not use `"Resource": "*"`. Do not use `s3:*`.

Delete the inline `mortgage-app-prod-s3-access` policy if Task 1 confirms
`msfg-mortgage-app-documents-prod` is unused by anything on this host. If it is used by
something, keep it and correct any name mismatch.

- [ ] **Step 2: Apply as a new policy version**

Create a new version of the managed policy rather than editing in place, so rollback is
`aws iam set-default-policy-version` back to the prior version ID. Record the prior version ID
in the task notes before applying.

- [ ] **Step 3: Verify the role can do the work, before removing anything**

From the EC2 box, assume the role explicitly and exercise a read against each bucket:

```bash
aws sts get-caller-identity   # still the IAM user at this point — expected
# then, per bucket:
aws s3 ls s3://<bucket>/ --profile <role-profile-or-instance-creds> --max-items 1
```

Every bucket in the table must succeed. Any failure means the policy is wrong; fix it here,
while the admin keys are still working and there is no outage.

---

## Task 3: Cut over to the instance role

This is the step with production impact. Have a rollback ready and do it outside business
hours.

- [ ] **Step 1: Back up, then move the credentials file aside**

```bash
sudo cp -a /home/ubuntu/.aws /root/aws-creds-backup-$(date +%F)
mv /home/ubuntu/.aws/credentials /home/ubuntu/.aws/credentials.disabled
```

Move, do not delete. Rollback is a single `mv` back.

Check `/home/ubuntu/.aws/config` too — if it names a `[profile ...]` or sets
`credential_source`, it may also need adjusting. Leave it in place unless it breaks something.

- [ ] **Step 2: Restart the apps and confirm the identity flipped**

```bash
pm2 restart all
aws sts get-caller-identity
```

The ARN must now read `arn:aws:sts::116981808374:assumed-role/msfg-dashboard-ec2-role/...`
rather than `user/vonzink@gmail.com`. If it still shows the user, something else is supplying
credentials — stop and investigate rather than continuing.

- [ ] **Step 3: Smoke-test every AWS-touching path**

Exercise the real features, not just the CLI:

- Dashboard loads and `/api/me` returns a user (Cognito JWT verification).
- Forms Library opens and lists files (`msfg-mortgage-documents-prod`).
- Logos browser opens and lists files (`msfg-media`).
- Upload an announcement attachment and re-download it (`msfg-dashboard-files`).
- An avatar or investor logo renders (`msfg-media` presigned GET).
- Admin user management loads (Cognito admin API).
- `pm2 logs --lines 100` shows no `AccessDenied` or `CredentialsProviderError`.

Any `AccessDenied` means a missing grant. Add it to the policy — do not restore the keys
unless the site is down.

- [ ] **Step 4: Rollback procedure, if needed**

```bash
mv /home/ubuntu/.aws/credentials.disabled /home/ubuntu/.aws/credentials
pm2 restart all
```

Then fix the policy gap and retry. Rollback should take under a minute.

---

## Task 4: Retire the admin keys

Only after Task 3 has soaked without `AccessDenied` errors.

- [ ] **Step 1: Deactivate, do not delete**

```bash
aws iam update-access-key --user-name "vonzink@gmail.com" --access-key-id AKIARWPFIXT3EP46BCOB --status Inactive
aws iam update-access-key --user-name "vonzink@gmail.com" --access-key-id AKIARWPFIXT3KFHOG3CI --status Inactive
```

Deactivation is instantly reversible; deletion is not. Before running this, confirm neither
key is used by anything **off** this host — a laptop, a CI job, a Lambda, a Zapier connection.
Check CloudTrail for recent use by these key IDs from source IPs other than the EC2 host.

- [ ] **Step 2: Soak for one week**

Watch CloudTrail for authentication failures attributable to these keys. One week covers
weekly batch jobs.

- [ ] **Step 3: Delete the keys**

```bash
aws iam delete-access-key --user-name "vonzink@gmail.com" --access-key-id <id>
```

- [ ] **Step 4: Remove standing admin from the day-to-day user**

Detach `AdministratorAccess` from `vonzink@gmail.com` and review the `FullAccess` group.
Console administration should go through an assumed role with MFA rather than a permanently
privileged user. This is a separate decision from the host remediation and can be scheduled
independently — but leaving it undone means the next credentials file recreates the problem.

- [ ] **Step 5: Prevent recurrence**

Delete `/home/ubuntu/.aws/credentials.disabled` and the `/root` backup once the keys are gone.
Note in `backend/DEPLOY_TO_EC2.md` that this host authenticates by instance role and that
`~/.aws/credentials` must not be created on it.

---

## Done when

- `aws sts get-caller-identity` on the host returns the assumed role, not an IAM user.
- Every bucket the apps use is reachable, and no bucket they do not use is granted.
- Both access keys are deleted.
- `AdministratorAccess` is no longer attached to the day-to-day user.
- `backend/DEPLOY_TO_EC2.md` documents the instance-role expectation.

## Notes

- The role already carries `AmazonSSMManagedInstanceCore`, so Session Manager works and the
  `.pem` in `/Users/zacharyzink/MSFG/Security/` is not the only way onto the box. Useful if a
  step goes wrong.
- `deploy.sh --backend` does `git pull && npm install && pm2 restart`. It does not touch
  credentials, so it is safe to run during this work.
- This plan deliberately does not add the My Files S3 and KMS permissions. Those attach to the
  same role in Phase 2 of the My Files spec, after this cutover is stable.
