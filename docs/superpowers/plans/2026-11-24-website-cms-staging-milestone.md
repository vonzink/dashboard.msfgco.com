# Website CMS — staging milestone plan

Status: DRAFT for owner approval (2026-11-24). Nothing here authorizes production
deployment, production migrations, DNS changes or content publication.

**Milestone (done =)** the full flow — sign in → Website → edit → save draft →
website-rendered draft preview → publish → website updates → rollback (editor button) —
works against **staging S3 publication storage**, with permission denials verified, and a
release procedure that documents the RDS snapshot and migration checks.

## Findings that shape the plan

Facts (read-only inspection, 2026-11-24):

- **Staging dashboard uses the production backend** (`js/env.js` on `feat/phase2-sandbox`:
  "Owner decision 2026-09-16"). Enabling the CMS for staging through that path means
  enabling it in the production backend, which runs migrations 097–099 on
  `msfg-mortgage-db` at startup.
- `js/env.js` (hostname-based env resolver) exists only on unmerged `feat/phase2-sandbox`.
- **S3:** no bucket is intended for website publications. No IAM role can reach one.
  Best existing patterns: `msfg-user-folders` (versioning, KMS, TLS-only, lifecycle) and
  `msfg-webinar-assets` (OAC, quarantine flow).
- **EC2:** four instances, all mostly idle (CPU avg ≤ 7 %, credits full). No memory
  metrics exist. The dashboard instance (t3a.medium) also serves api, calc and compass,
  has SSH and 8080 open to 0.0.0.0/0, and its role can write borrower-document buckets
  and holds AmazonCognitoPowerUser.
- **staging.msfg.us** already has an A record to the dashboard instance (52.203.186.217).
  Its DNS is at GoDaddy. What answers there is not verified. ACM `*.msfg.us` is FAILED;
  no certificate exists for staging.msfg.us. No load balancer exists.
- **RDS** `msfg-mortgage-db`: MySQL 8.4.8, db.t3.micro, single-AZ, 7-day backups,
  publicly accessible, **no deletion protection**.
- **Website code:** no S3 code. `PublicationStore` is three read methods (`readPointer`,
  `readObject`, `readRevocations`); a file cache gives last-known-good and bootstrap.
  `src/server/publication/preview.ts` already implements a 5-minute HMAC preview token
  and `readPrivatePreview`, but nothing calls it.
- **Contract:** `manifestKey` must be `publications/<id>/snapshot.json` (no prefix), so
  each environment needs its **own bucket**, not a prefix.
- **Content:** no fully approved initial release can be built yet. Company phone,
  address, email and state license numbers are placeholders; officer data is scraped
  and unverified; several pages are pending compliance; several approved sections live
  in components, not in CMS content.
- Website process memory: ~55 MB idle locally; the runtime keeps up to 3 releases
  (≤ 128 MB each) in memory.

## Owner decisions (2026-11-24)

1. **Staging backend:** for this milestone, the dashboard backend and the website run
   locally (MySQL in Docker) against a real staging S3 bucket. No production database
   change. A hosted staging backend is decided later.
2. **Website hosting:** a new small separate instance (t3a.small proposed) with its own
   read-only role and a security group allowing 80/443 only.
3. **Credentials for local runs:** AWS profile `default`. Note: those keys have broader
   access than the staging bucket needs; the scoped writer/reader policies are still
   created for the hosted services.
4. **Staging initial content:** approved items plus unverified items (14 scraped
   officers, 40 Google reviews), staging only, noindex, marked unverified in the
   approval manifest. Never production without separate approval.

## Workstreams and order

Each step is one logical change with its own tests. AWS changes are shown as exact
commands for approval before they run.

### A. Staging configuration (small)
- Add a `website.origin` per environment: staging dashboard → `https://staging.msfg.us`;
  production stays empty until the production release (`https://msfg.us`); local → test
  site. Implemented by hostname in `js/config.js` now, moved into `js/env.js` when
  `feat/phase2-sandbox` merges.
- Done when: unit test covers hostname → origin for prod/staging/local.

### B. S3 publication store (dashboard + website)
- Infrastructure proposal (approval required, not executed by this plan):
  bucket `msfg-website-publications-staging`, us-east-1, versioning on, public access
  block on, SSE (KMS or AES256), TLS-only policy, lifecycle for `previews/` (1 day) and
  noncurrent versions. Writer policy for the dashboard backend; read-only policy for the
  website instance role. No public access; the website serves media from the release.
- **Done 2026-11-24 (owner-approved):** bucket `msfg-website-publications-staging`
  created in us-east-1: versioning on, all four public-access blocks, AES256 + bucket
  key, tags Env=Staging/Purpose=WebsitePublications, lifecycle (previews 1 day,
  noncurrent 30 days, multipart 1 day), TLS-only bucket policy (not public).
- **Verified on the real bucket (aws-cli 2.33.12):** `If-None-Match: *` refuses an
  existing key (412); `If-Match: <etag>` succeeds when current and fails when stale (412);
  five concurrent writers with the same ETag → exactly one winner, the others got
  `PreconditionFailed` (412) or `ConditionalRequestConflict` (409). The store must treat
  both 412 and 409 as "activation lost". Test objects and all their versions deleted.
- **Done 2026-11-24:** dashboard `s3Store.js` (c7175b4) and website `createS3Store`
  (msfg-website `feat/website-s3-publication`, 4e22a13).
- **Live run 2026-11-24 (owner-approved: synthetic data, then wipe):** local backend
  (fresh MySQL schema) + local website (`MSFG_PUBLICATION_SOURCE=s3`) against the staging
  bucket with profile `default`. Full flow passed: draft private, survives restart, editor
  preview, publish (website updated in 8 s), rollback to generation 3 (website restored in
  30 s), permission denials as before. Assets uploaded once (immutable skip worked).
  Afterwards all 19 object versions and the owner marker were deleted (0 remaining) and
  the test schema dropped. The bucket is empty with its settings intact.
- Key layout (matches the contract): `current.json`, `revocations.json`,
  `publications/<id>/snapshot.json`, `publications/<id>/pointer.json`, assets at their
  contract paths, private `previews/<id>/…`.
- Dashboard: `createS3PublicationStore` with the same interface as the directory store.
  Activation = read pointer (ETag) → verify generation → conditional `PutObject` with
  `If-Match` (or `If-None-Match: *` for the first pointer). **Verify S3 conditional-write
  behavior against the real staging bucket before relying on it.** Rollback stays "new
  higher generation". Retain publications (no deletion).
- Website: `createS3Store` implementing `PublicationStore`, selected by
  `MSFG_PUBLICATION_SOURCE=s3` + bucket/region env. Last-known-good cache and bootstrap
  unchanged.
- Done when: contract tests pass for both stores against a local S3-compatible fake and
  once against the staging bucket (conditional write conflict proven).

### C. Draft preview rendered by the website
- Dashboard: `POST /api/website-cms/previews` (website.edit) builds the bundle for the
  selected saved revisions over the published base, writes it to `previews/<id>/`, and
  returns a signed 5-minute token (`preview.ts` format). Key in SSM Parameter Store
  (SecureString), per environment.
- Website: route `/preview/draft?token=…` → verify token → `readPrivatePreview` from
  `previews/<id>/` → render with `private, no-store`, noindex, no analytics, never the
  public cache.
- Editor: "Preview on website" opens that URL.
- Done when: token expiry, wrong audience, tampered token and other-draft access are
  rejected in tests; draft never appears on public routes or caches.

### D. Editor completion
- Rollback button: list recent active publications (new `GET /publications`, read
  grant), confirm dialog, call existing rollback API (publish grant).
- Wording: remove "production integration pending" / local-review note; show accurate
  environment and adoption status.
- Done when: browser test covers rollback UI, wording, and edit-only user sees no
  rollback/publish success.

### E. Initial release builder (website repo)
- Script that assembles a `SiteSnapshot` only from an explicit owner **approval
  manifest** (pages, officers, testimonials, company fields). It fails on synthetic
  markers (`example.com`, `example.invalid`, `555-01`, `SYNTHETIC`, `[PLACEHOLDER]`,
  `awaiting review`, `review-officer-`, fixture IDs) and on any unapproved item.
- Output: validated release for **staging only**. Production use needs separate approval.
- Done when: builder rejects the current demo/fixture data and produces a valid staging
  release from the approved list.

### F. Website hosting on EC2 (plan only until approved)
- Separate Next.js standalone service (PM2 or systemd), versioned release directories,
  health check `/api/health`, previous release retained, noindex for staging.
- First, verify what currently answers staging.msfg.us on 52.203.186.217 (owner runs a
  read-only command on the server).
- HTTPS: no ACM certificate exists for msfg.us; plan Let's Encrypt on the instance (or a
  reverse proxy) — to be confirmed.

### G. Release procedure (documentation)
- Extend `DEPLOYMENT.md`: RDS snapshot before any backend restart with CMS code;
  pre-checks (`SHOW TABLES LIKE 'website_cms%'`, migration log review, row counts
  before/after for existing tables), post-checks, rollback (disable flag; snapshot
  restore only for corruption), and the "startup runs migrations" warning.

## Security findings to raise separately (not changed by this plan)
- SSH (22) open to 0.0.0.0/0 on dashboard and suite instances; 8080 open on dashboard.
- `msfg-mortgage-db` publicly accessible, no deletion protection.
- Dashboard instance role: broad borrower-document write + AmazonCognitoPowerUser.
- Two unattached Elastic IPs; stale Route 53 `msfgco.com` zone.
