# Webinar Studio shared-assets release runbook

Date prepared: 2026-09-04

This runbook is an approval-gated production-readiness checklist. The current
asset implementation and evidence are local only. Preparing this document did
not access or change an AWS account, database, deployment, DNS record, or public
endpoint.

## Current status

| Gate | Current status |
| --- | --- |
| Local asset schema, media inspection, catalog, revision binding, and authenticated API | Implemented and locally tested through `6181bb829046278cdc936bc6feffb9d6c22033e2` |
| Disposable S3 lifecycle integration | Deliberately skipped because its exact disposable configuration was absent |
| Production migration `095_webinar_studio_assets.sql` | **NOT PERFORMED — separate approval required** |
| Production S3 bucket/prefix and policies | **UNVERIFIED / NOT PROVISIONED BY THIS PACKAGE** |
| Production GuardDuty Malware Protection for S3 plan | **UNVERIFIED / NOT PROVISIONED BY THIS PACKAGE** |
| Production CloudFront distribution and OAC | **UNVERIFIED / NOT PROVISIONED BY THIS PACKAGE** |
| Production IAM changes | **UNVERIFIED / NOT PERFORMED BY THIS PACKAGE** |
| Application asset environment variables and asset upload routes | **NOT ENABLED IN PRODUCTION BY THIS PACKAGE** |

Migration `095` is the additive shared-assets migration. References to migration
`092` in the original asset plan are stale: `092` through `094` belong to the
deployed Webinar Studio foundation and must not be renamed or edited.

## Approval boundary

Before running any command against production, an operator must independently
resolve and review every bracketed identifier below against the intended AWS
account and region. Use an authenticated read-only role for verification. Do not
copy identifiers from shell globs, broad environment variables, command output
from another account, or an unreviewed deployment note.

Provisioning, policy changes, migration `095`, setting application environment
variables, backend deployment, public-bundle changes, and cutover each require
separate authorization. None is implied by passing local tests.

## Required infrastructure gates

All gates below are mandatory. Keep the application asset configuration absent
and upload mutations unavailable until every gate passes.

### 1. Private quarantine before first upload

- Confirm the reviewed bucket is dedicated to the intended environment, has all
  four S3 Block Public Access settings enabled, has no public ACL, and cannot be
  listed by the application role.
- Confirm quarantine is a private prefix. A browser may receive only a
  short-lived presigned PUT for its one exact quarantine object. It must not
  receive S3 credentials, list access, a read URL, or a presign for `approved/`.
- Confirm an active GuardDuty Malware Protection for S3 plan protects this exact
  bucket before the first upload. The plan must publish the managed scan-result
  object tag.
- Confirm the tag key is exactly `GuardDutyMalwareScanStatus`. Missing tags,
  unknown values, scanner errors, and every value other than exact
  `NO_THREATS_FOUND` remain unavailable.

Read-only verification commands:

```sh
aws guardduty list-malware-protection-plans \
  --region '<REVIEWED_AWS_REGION>'

aws guardduty get-malware-protection-plan \
  --region '<REVIEWED_AWS_REGION>' \
  --malware-protection-plan-id '<REVIEWED_MALWARE_PROTECTION_PLAN_ID>'

aws s3api get-public-access-block \
  --bucket '<REVIEWED_WEBINAR_ASSET_BUCKET>'

aws s3api get-bucket-policy \
  --bucket '<REVIEWED_WEBINAR_ASSET_BUCKET>'

aws s3api get-object-tagging \
  --bucket '<REVIEWED_WEBINAR_ASSET_BUCKET>' \
  --key '<REVIEWED_QUARANTINE_OBJECT_KEY>'
```

### 2. Fail-closed bucket policy

Inspect the returned bucket policy and confirm all of these behaviors with
explicit allowed and denied principals:

- only the reviewed GuardDuty protection-plan role/service path can write or
  overwrite `GuardDutyMalwareScanStatus` on quarantine objects;
- the application role cannot set, replace, or delete that tag;
- quarantine reads are denied unless the existing object tag is exactly
  `GuardDutyMalwareScanStatus=NO_THREATS_FOUND`;
- browser/public principals cannot read quarantine objects;
- the application role can write the canonical immutable approved path but
  cannot overwrite an existing object; and
- the CloudFront service principal can read only `approved/*`, conditioned on
  the one reviewed distribution ARN.

An allowed request is not sufficient evidence. Exercise policy simulation or a
disposable canary to prove tag overwrite and non-clean quarantine reads are
denied. That mutation test requires its own approval and is not performed by the
read-only commands in this runbook.

### 3. Approved delivery through CloudFront only

- Confirm the origin is the reviewed private bucket using Origin Access Control,
  not a public S3 website endpoint or legacy public ACL.
- Confirm the bucket policy and distribution behavior expose only `approved/`.
- Confirm approved keys have exactly this opaque content-addressed shape:
  `approved/sha256/<64-lowercase-hex>/asset`. Original filenames must never
  appear in the approved path or CDN URL.
- Confirm `Cache-Control: public, max-age=31536000, immutable` is preserved.
- Confirm byte-range requests work for audio and video.
- Confirm the origin MIME type is preserved for every supported image, SVG,
  font, audio, and video type.
- Confirm the response-headers policy supplies the exact approved CORS origins.
  Image/audio/video use the approved renderer origins; fonts must also return
  valid font CORS headers. Do not use credentialed wildcard CORS.

Read-only verification commands:

```sh
aws cloudfront get-distribution-config \
  --id '<REVIEWED_CLOUDFRONT_DISTRIBUTION_ID>'

curl -I \
  'https://<REVIEWED_ASSET_CDN_HOST>/approved/sha256/<REVIEWED_64_LOWERCASE_HEX_SHA256>/asset'

curl -I \
  -H 'Origin: https://<REVIEWED_ALLOWED_RENDERER_ORIGIN>' \
  'https://<REVIEWED_ASSET_CDN_HOST>/approved/sha256/<REVIEWED_64_LOWERCASE_HEX_SHA256>/asset'

curl --range 0-1023 \
  --output /dev/null \
  --dump-header - \
  'https://<REVIEWED_ASSET_CDN_HOST>/approved/sha256/<REVIEWED_64_LOWERCASE_HEX_SHA256>/asset'
```

For the first command, verify the reviewed distribution ARN, OAC ID, bucket
origin, cache behavior, response-headers policy, and any origin path together.
For the HTTP checks, verify `200` for HEAD, `206` plus a valid `Content-Range`
for the range request, the exact `Content-Type`, immutable cache control, and the
expected `Access-Control-Allow-Origin`. Also verify a reviewed quarantine URL
and an arbitrary non-approved path cannot be served.

### 4. Minimum backend IAM

The backend role must be limited to the reviewed bucket and prefixes. Its asset
permissions are:

- `s3:PutObject` on `quarantine/*`, used only to sign constrained uploads;
- `s3:GetObjectTagging` on `quarantine/*`;
- `s3:GetObject` on `quarantine/*`, effective only for exactly clean objects;
  and
- `s3:PutObject` on `approved/*`, with overwrite prevented by application and
  bucket controls.

Do not grant bucket listing, bucket-policy mutation, object deletion, public ACL
mutation, GuardDuty plan mutation, CloudFront mutation, or unrestricted S3
access. The application role must not be able to add or overwrite the GuardDuty
scan-result tag. Verify the effective role policy and permission boundary using
the independently reviewed role identifier before enabling the application.

### 5. Application enablement

Only after gates 1–4 pass:

1. apply additive migration `095_webinar_studio_assets.sql` through the reviewed
   production migration procedure and verify its four tables and constraints;
2. configure `WEBINAR_ASSET_BUCKET` with the reviewed bucket;
3. configure `WEBINAR_ASSET_CDN_BASE_URL` with the reviewed HTTPS CDN base URL;
4. configure `WEBINAR_ASSET_QUARANTINE_PREFIX` only if the reviewed prefix is not
   the default `quarantine/`;
5. restart through the normal backend deployment procedure; and
6. enable the authenticated asset upload controls only for the approved users.

Absence or invalidity of the bucket/CDN configuration is intentionally fatal to
asset operations. Do not work around that fail-closed behavior with a default
AWS profile, a shared bucket, a public object URL, or an unscanned direct upload.

## Disposable lifecycle integration

The integration test never discovers credentials or resources from the AWS
default chain. Asset services and the AWS SDK are dynamically loaded only after
the complete disposable configuration and acknowledgement pass validation; an
unset gate does not load the asset catalog or construct an S3 client. The
resource lifecycle remains skipped unless all of these values are explicitly
set:

- `WEBINAR_ASSET_TEST_ACK_DISPOSABLE=I_UNDERSTAND_THIS_IS_DISPOSABLE`
- `WEBINAR_ASSET_TEST_BUCKET` matching `webinar-studio-it-...`
- `WEBINAR_ASSET_TEST_CDN_BASE_URL` using HTTPS
- `WEBINAR_ASSET_TEST_S3_ENDPOINT`
- `WEBINAR_ASSET_TEST_REGION`
- `WEBINAR_ASSET_TEST_ACCESS_KEY_ID`
- `WEBINAR_ASSET_TEST_SECRET_ACCESS_KEY`

The test uses only uniquely generated exact object keys in that explicitly
acknowledged disposable bucket. It uploads two fixtures, proves a missing tag
remains `processing`, manually applies the test-only clean and malicious tags,
releases only exact `NO_THREATS_FOUND`, verifies the canonical opaque approved
path and safe catalog response, proves the malicious result has no approved
object, and deletes only its enumerated keys during cleanup. Cleanup treats any
per-object S3 deletion error as a test failure and performs a HEAD absence check
for every enumerated quarantine and approved key before it can pass.

From `backend/`, the inert check is:

```sh
env -u WEBINAR_ASSET_TEST_ACK_DISPOSABLE \
  -u WEBINAR_ASSET_TEST_BUCKET \
  -u WEBINAR_ASSET_TEST_CDN_BASE_URL \
  -u WEBINAR_ASSET_TEST_S3_ENDPOINT \
  -u WEBINAR_ASSET_TEST_REGION \
  -u WEBINAR_ASSET_TEST_ACCESS_KEY_ID \
  -u WEBINAR_ASSET_TEST_SECRET_ACCESS_KEY \
  npx vitest run --config vitest.webinar-integration.config.js \
  tests/integration/webinarAssets.integration.test.js
```

Expected without configuration: one file, three inert safety tests passed, and
two resource lifecycle tests deliberately skipped, exit zero, with no asset/AWS
dependency load, S3 client construction, or request.

Running the mutation lifecycle requires an independently reviewed disposable
configuration supplied directly to the process. Do not save its credentials in
this repository, shell history, a shared profile, or this runbook. A passing
disposable run does not verify production GuardDuty, policies, IAM, or CDN.

## Rollback without data deletion

Rollback is additive and reversible:

1. disable the Studio asset upload controls;
2. deny or remove routing for authenticated asset mutation methods
   (`POST`/`PATCH`) while preserving read-only diagnostic access as approved;
3. remove asset references from the audience/public-bundle feature path or
   return the public viewer to the retained static deployment;
4. remove `WEBINAR_ASSET_BUCKET` and `WEBINAR_ASSET_CDN_BASE_URL` from the
   application runtime and restart so asset operations fail closed;
5. if needed, restore the prior complete frontend bundle and backend release;
   and
6. retain migration `095` tables, asset rows, revision references, quarantine
   evidence, approved versions, and audit events for investigation and replay.

Do not delete or rewrite asset versions, revision references, migration history,
S3 objects, or source records during rollback. Permanent binary deletion and
schema cleanup are separate administrator maintenance actions requiring a new
review and approval.

## Local evidence recorded 2026-09-04

Asset implementation commits are based on deployed Foundation commit
`79e7354fb86fd7f6dfa685cef5c08d89f2aad488` and currently end at
`6181bb829046278cdc936bc6feffb9d6c22033e2`. The principal package commits are:

- `c4d7bf5cf7f6411053b8b6de1f9c844154839025` — immutable asset schema;
- `4147b88e5545f8fbb231816b7a8fab78ca421ea1` — quarantine upload storage;
- `c653078d4cc9960d5293367f944feefa608adc7e` — media inspection;
- `caeb61bc7a8361a66ef2eecf33159209bd728117` — shared asset catalog;
- `bec5bbdedb709ffa30f52127b09ee4e12c876328` — live/revision reference binding;
  and
- `0f24adddf299b88e3a9a5358a522c4e10ecce371` — authenticated asset API.

Security and correctness fixes through `6181bb8` are part of the reviewed local
state; the abbreviated principal list does not replace the complete Git history.

Executed from `backend/` with asset-test environment removed:

```sh
npx vitest run --config vitest.webinar-integration.config.js \
  tests/integration/webinarAssets.integration.test.js
```

Result: 1 integration file, 3 inert safety tests passed and 2 resource lifecycle
tests deliberately skipped, exit 0. No asset/AWS dependency was loaded and no S3
client, request, or resource mutation occurred. The passing guards also prove a
mocked mixed-success deletion response fails cleanup after every enumerated key
is checked for absence. A configured disposable integration pass is still
**UNPERFORMED**.

Executed from `backend/`:

```sh
TZ=UTC npm test -- --reporter=dot
```

Result: 57 test files, 1,147 tests total: 1,145 passed and exactly the two
accepted pre-existing Calendar UI tests failed. The failures remain:

- `calendar sync health and privacy labels > renders sync health indicators for synced calendar filter chips`;
- `calendar side panels > renders bulk controls only for eligible synced Outlook entries`.

No asset test failed. Production infrastructure, production migration `095`,
deployment, and production lifecycle verification remain unperformed pending
separate approval.

The required repository-wide lint command was also executed:

```sh
npm run lint
```

Result: the command exited 1 with the existing repository-wide baseline of 120
findings (69 errors and 51 warnings), including CommonJS/ES-module parser
configuration failures across the pre-existing test suite and unrelated source
errors. The new integration file has the same repository parser failure as every
other ESM Vitest file. A narrow syntax/global lint of the new file using the
Foundation runbook convention completed with zero findings. No lint baseline
file was changed and none of the unrelated findings was suppressed or repaired
in this package.

## Package exit decision

Local tests establish that accepted/rejected media and permissions pass; unsafe
or absent scan state cannot become available; catalog/API responses do not leak
S3 keys or quarantine details; saves and restores resolve only immutable
available tokens; and live or historical references prevent archival.

The shared-assets package is therefore eligible to proceed to the renderer as a
local implementation dependency. It is **not production-ready** until the
unverified infrastructure gates above pass, the disposable lifecycle integration
passes against reviewed resources, migration `095` is separately approved and
applied, and the production behavior is verified.
