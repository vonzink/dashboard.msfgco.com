# Local website publication slice

This is an explicitly injected, pages-only implementation checkpoint. It is **not mounted** in `backend/server.js` and does not load dashboard authentication, database configuration, migrations, AWS clients or credentials. MySQL/S3 adapters, production grants, revision-specific compliance approval, media upload, authenticated draft preview, and adoption acknowledgement remain B1–B4 work.

```js
const { createLocalCmsAdapters } = require('./services/websiteCms/local');
const { createWebsiteCmsService } = require('./services/websiteCms/service');
const { createWebsiteCmsRouter } = require('./routes/websiteCms');
const adapters = await createLocalCmsAdapters({
  editorialDirectory: '/absolute/private/local/editorial',
  publicationDirectory: '/absolute/private/local/published',
  seed: { pointer, manifest, assets }, // explicitly supplied verified fixture bundle
  grants: { 'local-publisher': ['website.edit', 'website.publish'] },
});
const service = createWebsiteCmsService(adapters);
app.use('/api/website-cms', createWebsiteCmsRouter({ service, authenticate }));
```

`seed` and `grants` are mandatory for initial local creation; reopen uses the persisted editorial state. The manifest and every declared asset are validated with the frozen contract and byte hashes. Editorial and publication directories must be separate, absolute and physically nonoverlapping. One editorial directory is bound to each local publication directory. No default fixture, actor, grant or source path is supplied by these modules.

The caller's injected `authenticate` middleware must establish `req.user.db={id,is_active}` from a trusted identity. The service reads grants from private repository state; body fields, Cognito groups, dashboard roles, `X-Active-Role` and other headers grant nothing. The coordinator's loopback-only synthetic harness is an explicit test boundary, not a new production sign-in method. That harness owns Host/Origin/CSRF controls. A production adapter must compose existing verified Cognito mapping and the active-user gate before using this router.

## Routes

- `GET /entities?kind=page` returns `{entities,publication}`. Each summary includes `kind,id,path,title,latestRevisionId,publishedRevisionId`.
- `GET /entities/page/:id` returns `{entity,published,latest,revisions,publication}`. `published` and `latest` contain `{revisionId,content}`; authorized `revisions` contain immutable content, creator ID and timestamp.
- `POST /entities/page/:id/revisions` takes exactly `{baseRevisionId,content}`. Stale base is409, undeclared/private public fields422. No latest draft changes the publication.
- `POST /publications` takes the exact frozen `PublishRequest`. Selected page revisions replace only those pages in the published base; unselected current and newer drafts remain separate. Other entity kinds are explicitly unsupported in this slice.
- `GET /publications/:id` returns candidate/active/failed pointer status, never an adopted claim.
- `POST /publications/:id/rollback` takes exactly `{requestId,expectedGeneration}`; it references a retained manifest at a higher generation. Revocation data is never rewritten.

## Local consistency and recovery

An exclusive filesystem directory lock serializes editorial operations across processes. A second lock serializes pointer activation. Candidate objects are immutable and verified before activation. Private request intent is persisted before the atomic pointer write. Retrying the same actor/request/body reconciles a lost activation response; conflicting request reuse returns409. An incomplete candidate leaves the old pointer intact.

Lock directories intentionally have **no automatic expiry**. A crashed process can leave the fixture unavailable rather than risking a second writer. A local operator must verify no writer remains, inspect the request intent and active pointer, then remove only the abandoned lock directory. Do not clear locks merely because they are old. Interrupted pending activations at the unchanged base must be retried with the exact request; unrelated activation waits with503. This is a local proof, not the production SQL/S3 outbox or emergency revocation runbook.

The local publication adapter exposes only explicit source bytes and never copies editorial state into the published directory. HTTP error responses contain safe codes, not raw filesystem or provider messages. The router sets private/no-store. The public site independently validates and caches the release; stopping this editor does not stop public reads.

## Verification

Focused tests: `npm test -- tests/services/websiteCms tests/routes/websiteCms` (loopback listener permission required for HTTP tests). Covers mapped active/granted identity, stale/immutable/private drafts, exact selected revision and retained unselected pages, same-base races including separate Node processes, failed candidate writes, response-loss idempotency, rollback without revocation restoration, corrupt media refusal, and actual HTTP impersonation denial. These tests do not establish live authentication, MySQL migration safety, S3 conditional writes, media-codec approval or editorial/compliance approval.

Latest local result:18 focused tests pass; scoped ESLint passes. Full backend suite completed with loopback permission:558 passed,5 failed in untouched baseline `tests/frontend/calendarSyncUi.test.js` (sync-health indicator and eligible bulk-controls cases) and `tests/services/plaudSync.test.js` (three timestamp/S3-key cases). Running those two files alone with `TZ=America/Denver` reproduces the same five failures. No unrelated source/test changes were made. Full log: `/private/tmp/msfg-dashboard-cms-full-tests-unrestricted.log`; baseline rerun: `/private/tmp/msfg-dashboard-cms-baseline-timezone.log`.

## Saved hero library (local integration, 2026-11-21)

The service optionally accepts an explicitly supplied `heroCatalog` containing vetted
`entries`, immutable `media` manifests and asset buffers. Call
`initializeHeroLibrary()` from trusted startup composition once the repository has
been initialized; it adds missing catalog IDs without replacing saved revisions.
No HTTP bootstrap or catalog-upload endpoint exists. The source catalogue is not
an authorization grant and no private content is published during bootstrap.

- `GET /hero-library`: authorized latest entries plus available video/artwork choices.
- `GET /hero-library/:id`: saved immutable revisions for one seeded creative.
- `POST /hero-library/:id/revisions`: exact `{baseRevisionId,content}`, with
  `content={name,category,hero}`. Names are nonempty/up to120 characters; categories
  up to60. `hero` uses the public contract, with its library ID and `active:false`.
- `POST /entities/page/:id/hero-assignments`: exact
  `{baseRevisionId,slotId,heroId,heroRevisionId,active}` copies the chosen saved
  creative into an existing slot, preserving the page slot's stable ID. This saves
  a new page draft only. Stale page/library bases return409; unknown IDs/slots404.

Editing/assigning requires `website.edit`; reading uses existing read grants;
publication remains `website.publish` and retains the exact selected page revision
and activation-intent recovery flow. Library updates never mutate previously
assigned page revisions. A publication includes the media sets referenced by its
page heroes and retains previously declared immutable assets, never unrelated
library copy or drafts. Catalog bytes are hash/size checked and conflicts fail
closed. This is prepared-media integration, not raw upload/transcoding.

Local JSON repositories add private `heroRevisions`/`heroLatest` arrays during
explicit initialization. MySQL requires additive rerunnable migrations097 **and098**;
098 creates separate append-only creative revision and latest-pointer tables.
The website runtime still has no authoritative editorial database. Existing
production composition remains disabled until its adapters are explicitly supplied.

## Structured content editing (local integration, 2026-11-22)

This checkpoint supersedes the pages-only API restriction above. The service now
supports `page`, `site`, and `officer` entities with the existing frozen public
contract and existing grants. `GET /entities` retains its page-only default;
`?kind=all`, `?kind=site`, and `?kind=officer` select the expanded inventory. Every
head/revision match is scoped by both kind and ID, including legacy page heads.

The generic get/save routes accept those kinds. `published` is `null` for a
trusted initial draft not yet included in a release. Page edits preserve ID,
path, template, officer reference, and ordered section IDs/types. Nested content
(including FAQ answers and cards) is validated by the existing semantic parser.
Site edits are limited to `contact` and `legal.address`; company identity,
navigation, legal disclosures and calculator compatibility are retained. Officer
ID/slug are fixed; supported public profile fields remain contract-validated.
Officer detail includes `photoAssets`, the declared prepared image choices.

A selected publication can replace a site/officer revision or add a prepared,
previously unpublished page/officer. Other drafts never enter that release.
There is no HTTP entity creation or non-page deletion endpoint. Authorization,
CAS conflict handling, immutable history, activation intent/retry and rollback
remain unchanged; `website.profile.self` alone still grants no general editing.

Trusted composition may pass `contentCatalog={pages,officers,media,assets}` and
call `initializeContentCatalog()`. It validates templates and byte hashes, seeds
missing private initial drafts, and never overwrites saved heads or activates a
public pointer. Existing published site/officer records initialize their private
history on first use. Catalog photo bytes are included only when referenced by
selected public content. Keep the catalog supplied on restart so unpublished
prepared assets remain available for validation and publication.

For an existing page, `hasContentImport` indicates a prepared catalog template.
`POST /entities/page/:id/content-imports` takes exactly `{baseRevisionId}` and
saves its title/description/sections into a new draft. It retains current hero
choices, fallback image, identity, SEO and officer reference. This explicit
import is the only operation that replaces the prepared section topology.
Stale base409, missing template404, and edit authorization are enforced.

MySQL requires additive migration099 after097/098. It introduces separate
site/officer history/head tables without modifying old page history. New
private page heads use the existing page tables. Current validation:67 focused
service/route tests passed; scoped ESLint passed; a fresh disposable MySQL8
schema passed9 integration checks with zero skips, including migration reruns,
kind-colliding IDs, selected site/officer publication, catalog head persistence,
immutable history and rollback. No production migration or server mounting was
performed.
