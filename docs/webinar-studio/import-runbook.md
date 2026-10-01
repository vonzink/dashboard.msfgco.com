# Webinar Studio deck import runbook

Date prepared: 2026-10-01

How to bring an exported static webinar deck into Webinar Studio. The bundles
come from the Webinars repository (`tools/studio-export`); the import runs here.

Each numbered gate below needs its own approval. Approval of one gate is not
approval of the next.

## What the importer does

`backend/scripts/importWebinarBundle.js` works in two steps bound by a hash.

**Dry run.** Reads the bundle, the asset manifest and every asset file. Checks
the bundle's shape, the content against the Studio content policy, each file
against its recorded checksum, and each file against the same inspection an
upload goes through. Resolves the owner and the acting administrator by email;
each must match exactly one active user. Confirms the slug is free. Writes a
plan file and prints its SHA-256. It writes nothing else.

**Apply.** Accepts only a plan whose bytes hash to the value given. Re-checks
every input against the plan and refuses if anything changed. Uploads each asset
that is not already in the library through quarantine, the GuardDuty scan and
inspection, and waits for all of them. Then creates the webinar, all its slides
under their stable ids, and revision one in a single transaction, with the
audience switched off.

It never writes to MySQL or S3 directly. Assets go through the asset catalog and
the webinar goes through `importWebinar` in the mutation service, which runs the
same candidate validation, asset-reference checks and snapshot as a webinar
built by hand.

Refusals are specific: `IMPORT_ALREADY_APPLIED` (the slug exists; nothing is
changed), `IMPORT_PLAN_DRIFT`, `IMPORT_INPUT_DRIFT`, `IMPORT_ASSET_REJECTED`,
`IMPORT_ASSET_TIMEOUT`, `IMPORT_CONTENT_INVALID`, `IMPORT_OWNER_UNRESOLVED`,
`IMPORT_ACTOR_UNRESOLVED`, `IMPORT_ACTOR_NOT_ADMIN`.

If an apply stops while assets are being released, run it again with the same
plan. Assets that already became available are found by their hash and reused.

## Prerequisites

- Asset storage is live: bucket, GuardDuty scan plan, CloudFront, and the
  `WEBINAR_ASSET_*` and `WEBINAR_EXTERNAL_*` settings in the backend `.env`.
- The backend is deployed with this importer and with the SVG attribute
  allow-list that keeps `fill-opacity`, `stroke-opacity`, `letter-spacing`,
  `textLength`, `lengthAdjust`, `role` and `aria-label`. Without it the asset
  library strips the shading and wordmark spacing from the MSFG logo files.
- The owner and the acting administrator exist as active users.

## Gates

### 1. Deploy the backend

Merge and deploy as usual (`./deploy.sh --backend-only`). The deploy restarts
`msfg-backend`.

### 2. Copy the bundle to the server

For each deck, copy its `migration/` folder and its `deck/assets/` folder from
the Webinars repository to a working directory on the backend host. Keep the
layout so the manifest's relative paths resolve under the asset root:

```
/home/ubuntu/webinar-import/<slug>/migration/source-bundle.json
/home/ubuntu/webinar-import/<slug>/migration/asset-manifest.json
/home/ubuntu/webinar-import/<slug>/deck/assets/...
```

### 3. Dry run

On the backend host, from `backend/`:

```bash
node scripts/importWebinarBundle.js --dry-run \
  --bundle /home/ubuntu/webinar-import/<slug>/migration/source-bundle.json \
  --assets /home/ubuntu/webinar-import/<slug>/migration/asset-manifest.json \
  --asset-root /home/ubuntu/webinar-import/<slug>/deck \
  --owner-email seth.angell@msfg.us \
  --actor-email zachary.zink@msfg.us \
  --plan-out /home/ubuntu/webinar-import/<slug>/migration/runtime/deck-import-plan.json
```

Review the printed summary: slide count, asset count, how many assets upload and
how many are reused, `audienceEnabled: false`. Record the `planSha256`.

### 4. Apply

Only after the dry run is reviewed, and only with the hash it printed:

```bash
node scripts/importWebinarBundle.js --apply \
  --plan /home/ubuntu/webinar-import/<slug>/migration/runtime/deck-import-plan.json \
  --plan-sha256 <planSha256>
```

Expect it to wait a minute or two per batch of assets while GuardDuty scans. It
prints the new webinar id and the asset version each key resolved to.

### 5. Check it in Studio

Open Webinar Studio as the owner or an administrator. The webinar is listed,
hidden from audiences, at live version 1. Step through the slides in the
preview, open a popout and a calculator, and confirm the images load.

### 6. Audience access

Separate decision. The public viewer page exists only for
`first-home-without-mystery`; every other slug needs a viewer published at
`msfgmortgage.com/webinars/<slug>/studio-viewer.html` before its audience link
works. Switching `audience_enabled` on is an administrator action in Studio.

## Rollback

An imported webinar that should not exist is archived from Studio by an
administrator, which also switches its audience off. Archiving does not free the
slug or the slide ids, so re-importing the same deck afterwards needs a
deliberate decision about the archived record first. Released asset versions
stay in the library; archive any that should not be offered.

## Rehearsal evidence (2026-10-01)

All three decks were imported into a disposable local MySQL 8.0 with the real
migrations, content policy, asset inspection, `importWebinar` transaction,
reference service and public-bundle service. S3 and the GuardDuty scan were
stood in for locally.

| Deck | Slides | Assets | Revisions | Hidden after import | Re-run of the same plan |
|---|---|---|---|---|---|
| first-home-without-mystery | 15 | 4 | 1 | yes | `IMPORT_ALREADY_APPLIED` |
| homebuyers-webinar | 15 | 18 (4 reused) | 1 | yes | `IMPORT_ALREADY_APPLIED` |
| va | 17 | 5 (2 reused) | 1 | yes | `IMPORT_ALREADY_APPLIED` |

The bundles the public-bundle service then served, with assets as inspection
approved them, were rendered in the Studio slide frame and compared with the
static decks: 124 slide, popout, graphic and calculator comparisons, all within
0.01% of the pixels. The real S3 upload, GuardDuty scan and production database
have not been exercised by the importer.
