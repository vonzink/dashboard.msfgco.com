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

| Bucket used by `msfg-backend` | Covered by the role today? |
|---|---|
| `msfg-dashboard-files` | Yes — `msfg-dashboard-s3-policy` |
| `msfg-media` | **No** |
| `msfg-mortgage-documents-prod` | **No** |

(The initial scan also flagged `msfg-content-engine` and `msfg-internal`. Task 1 established
that neither is a bucket — see below.)

Note the near-miss: the inline policy `mortgage-app-prod-s3-access` grants access to
`msfg-mortgage-app-documents-prod`, which is **not** the same bucket as the
`msfg-mortgage-documents-prod` the Forms Library and guidelines actually use. The extra `app-`
segment means that grant does nothing for the dashboard.

Cognito is already covered by `AmazonCognitoPowerUser`. RDS uses username/password, not IAM
auth, so it is unaffected.

---

## Task 1: Confirm bucket usage — **COMPLETE (2026-07-30)**

Two of the four "uncovered buckets" from the initial scan turned out not to be buckets at all.

| Candidate | Verdict |
|---|---|
| `msfg-media` | **Real bucket**, heavily used — avatars, business cards, QR codes, chat attachments, investor logos/photos/documents, employee documents |
| `msfg-mortgage-documents-prod` | **Real bucket** — Forms Library browse/upload, lending guideline PDFs |
| `msfg-content-engine` | **Not a bucket.** A string literal used as a `source:` field value in `routes/contentPublish.js` |
| `msfg-internal` | **Not a bucket.** A RAG brain slug in `backend/.env` as `RAG_BRAIN_OPEN_SLUG`, consumed over HTTP by `services/askAi/askAi.service.js`, which contains no S3 code at all |

`msfg-web` needs **no grant**. `/home/ubuntu/apps/msfg.us` has no `S3Client` construction, no
bucket env var, and no S3 call sites. The `@aws-sdk/client-s3` string found in the first scan
was a bundled webpack chunk name (`@aws-sdk/client-s3-ecbef8e33fd0b8f0`), not live usage.

### Operations actually used

From `backend/services/s3.js`, which is the only place S3 commands are constructed
(`PutObjectCommand`, `GetObjectCommand`, `DeleteObjectCommand`), plus `ListObjectsV2Command`
in `backend/routes/files.js`:

| Bucket | Region | Object actions | Bucket actions |
|---|---|---|---|
| `msfg-dashboard-files` | us-east-1 | PutObject, GetObject, DeleteObject | ListBucket |
| `msfg-media` | us-west-2 | PutObject, GetObject, DeleteObject | ListBucket |
| `msfg-mortgage-documents-prod` | us-east-1 | PutObject, GetObject, DeleteObject | ListBucket |

Two things to remove rather than carry forward:

- **`s3:PutObjectAcl`** in the current `msfg-dashboard-s3-policy` is unused. No code sets an
  ACL; uploads go through presigned PUTs with only `ContentType`. Drop it.
- **The inline `mortgage-app-prod-s3-access` policy** grants
  `msfg-mortgage-app-documents-prod`, which nothing on this host references. Delete it unless
  an owner is identified.

**One caveat to check during Task 3 smoke-testing:** `backend/routes/chat.js:237` calls
`deleteObject(att.s3_bucket, att.s3_key)` using a bucket name read from the
`chat_attachments` table rather than the `BUCKETS` registry. Confirm that column only ever
contains `msfg-media`:

```sql
SELECT DISTINCT s3_bucket FROM chat_attachments;
```

If it returns anything else, that bucket needs a grant too.

---

## Task 2: Extend the instance role — **COMPLETE (2026-07-30), except Step 4**

Applied as version `v2`, now default. **Rollback: `aws iam set-default-policy-version --policy-arn
$ARN --version-id v1`.** Before the change the policy had only `v1` and was attached to nothing
but `msfg-dashboard-ec2-role`, so the blast radius was limited to that role — which at the time
was fully shadowed by the admin credentials, meaning the change had no runtime effect at all.

- [x] **Step 1: Apply this policy document**

Task 1 is complete, so the policy is fully determined. Replace `msfg-dashboard-s3-policy`
with:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DashboardBucketObjects",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": [
        "arn:aws:s3:::msfg-dashboard-files/*",
        "arn:aws:s3:::msfg-media/*",
        "arn:aws:s3:::msfg-mortgage-documents-prod/*"
      ]
    },
    {
      "Sid": "DashboardBucketList",
      "Effect": "Allow",
      "Action": ["s3:ListBucket", "s3:GetBucketLocation"],
      "Resource": [
        "arn:aws:s3:::msfg-dashboard-files",
        "arn:aws:s3:::msfg-media",
        "arn:aws:s3:::msfg-mortgage-documents-prod"
      ]
    }
  ]
}
```

Note this drops `s3:PutObjectAcl`, which nothing uses. No `"Resource": "*"`, no `s3:*`.

- [x] **Step 2: Apply it as a new policy version**

Create a new version rather than editing in place, so rollback is a single command. Record the
current default version ID first:

```bash
ARN=arn:aws:iam::116981808374:policy/msfg-dashboard-s3-policy
aws iam get-policy --policy-arn $ARN --query 'Policy.DefaultVersionId' --output text   # note this
aws iam create-policy-version --policy-arn $ARN --policy-document file://policy.json --set-as-default
```

Rollback: `aws iam set-default-policy-version --policy-arn $ARN --version-id <recorded-id>`.

A managed policy holds at most five versions. If creation fails on that limit, delete the
oldest non-default version first.

- [x] **Step 3: Verify the role works — while the admin keys still do**

This is the whole point of ordering the plan this way. Test the role's permissions *before*
removing the credentials that are currently masking it, so a mistake costs nothing.

On the EC2 box, pull the instance-role credentials from IMDS explicitly and use them in a
subshell, leaving the shared credentials file untouched:

```bash
TOKEN=$(curl -s -X PUT "http://169.254.169.254/latest/api/token" \
  -H "X-aws-ec2-metadata-token-ttl-seconds: 300")
CREDS=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" \
  http://169.254.169.254/latest/meta-data/iam/security-credentials/msfg-dashboard-ec2-role)

(
  export AWS_ACCESS_KEY_ID=$(echo "$CREDS" | python3 -c 'import sys,json;print(json.load(sys.stdin)["AccessKeyId"])')
  export AWS_SECRET_ACCESS_KEY=$(echo "$CREDS" | python3 -c 'import sys,json;print(json.load(sys.stdin)["SecretAccessKey"])')
  export AWS_SESSION_TOKEN=$(echo "$CREDS" | python3 -c 'import sys,json;print(json.load(sys.stdin)["Token"])')

  aws sts get-caller-identity          # must show assumed-role/msfg-dashboard-ec2-role

  # Use s3api, not `aws s3 ls`. The high-level `aws s3 ls` does NOT accept --max-items and
  # exits non-zero with "Unknown options", which looks exactly like a permissions failure.
  aws s3api list-objects-v2 --bucket msfg-dashboard-files --max-keys 1 --region us-east-1
  aws s3api list-objects-v2 --bucket msfg-mortgage-documents-prod --max-keys 1 --region us-east-1
  aws s3api list-objects-v2 --bucket msfg-media --max-keys 1 --region us-west-2

  # Negative control: an ungranted bucket must fail, and must fail with AccessDenied
  # specifically. A NoSuchBucket or region-redirect error would prove nothing.
  aws s3api list-objects-v2 --bucket msfg.us --max-keys 1 --region us-west-1
)
```

Environment variables take precedence over the shared credentials file, so the subshell uses
the role while everything outside it keeps working. Any `AccessDenied` on a granted bucket means
the policy is wrong — fix it here, not during the cutover.

**Results (2026-07-30).** Identity inside the subshell resolved to
`assumed-role/msfg-dashboard-ec2-role/i-009758ffb4622ba02`, and outside it remained
`user/vonzink@gmail.com`, confirming the subshell isolation held. Per bucket:

| Bucket | ListBucket | GetObject | PutObject | DeleteObject |
|---|---|---|---|---|
| `msfg-dashboard-files` | OK | OK | OK | OK |
| `msfg-mortgage-documents-prod` | OK | OK | OK | OK |
| `msfg-media` | OK | OK | OK | OK |

The negative control on `msfg.us` returned `AccessDenied ... because no identity-based policy
allows the s3:ListBucket action` — denied for the correct reason. Write testing used a scratch
key under `_roleverify/` in each bucket, deleted immediately after.

Also confirm the chat-attachment caveat from Task 1:

```sql
SELECT DISTINCT s3_bucket FROM chat_attachments;
```

If that returns any bucket other than `msfg-media`, add it to the policy before proceeding.

**Result:** `chat_attachments` holds zero rows, so no historical bucket values exist outside the
three already granted. Caveat closed.

- [ ] **Step 4: Delete the dead inline policy**

```bash
aws iam delete-role-policy --role-name msfg-dashboard-ec2-role --policy-name mortgage-app-prod-s3-access
```

Task 1 confirmed nothing on this host references `msfg-mortgage-app-documents-prod`. This
grants access nothing uses either way, so deferring it until after Task 3 soaks is also fine.

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
