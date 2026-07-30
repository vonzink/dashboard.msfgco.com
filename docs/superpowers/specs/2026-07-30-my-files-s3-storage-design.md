# My Files — per-user S3 file storage, plus a Suite header button

**Date:** 2026-07-30
**Status:** Design approved; implementation not started
**Repos touched:** `dashboard.msfgco.com` (Node/Express/MySQL + vanilla-JS frontend)

## 1. Goal

Replace the header's single **Alerts** button with two buttons:

1. **Suite** — a plain external link to `https://suite.msfgco.com`.
2. **My Files** — a Dropbox-like personal file manager backed by S3, where each user gets
   their own space to upload, organize, rename, move, delete, and preview files and folders,
   with drag-and-drop.

The Suite button is a few lines. The rest of this spec is about My Files.

## 2. Decisions locked

| Decision | Choice | Why |
|---|---|---|
| Build vs. adopt | **Build into the dashboard**, extending `backend/routes/files.js` patterns and the `Calculators/File Browser/` precedent | Cognito here is User Pool only (no Identity Pool), so the browser never holds AWS credentials and every off-the-shelf manager would need its permission model rewritten. The frontend is also vanilla JS with no bundler, and every mature option (Stowage, s3kit, Filestash, s3-browser) is React/Next/Go/Java. |
| Sharing | **None in v1.** Files are visible to their owner and to admins only. | Sharing is the single largest scope multiplier (ACLs, share tokens, revocation, expiry, external-recipient audit). Deferred to a later phase. |
| NPI / borrower data | **Assume it will be stored there.** Build for GLBA from day one. | Drives KMS encryption, versioning, audit logging, malware scanning, and retention. Cheaper to build in than retrofit. |
| Admin access | **Full admin browse** into any user's files, every access audited. | Offboarding, e-discovery, and compliance review. |
| Quota / file size | **100 GB per user**, large files expected → **multipart upload required**. | Single presigned PUT caps at 5 GB and is unreliable in browsers well before that. |
| Naming | **"My Files"**, with a one-time acknowledgment on first open | With NPI allowed and full admin visibility, this is a corporate file store, not private space. Naming it "Folder" would imply a privacy guarantee that does not exist. |
| Malware scanning | **GuardDuty Malware Protection for S3** | Managed, scans on upload, tags objects with the verdict. No Lambda/ClamAV to maintain. |
| Retention | Trash purges at **30 days**; noncurrent versions expire at **90 days**. | Balances accidental-delete recovery against indefinite NPI accumulation. |
| Offboarding | On deactivation, files **auto-archive to a read-only admin area**, purged after the retention window. | No manual step to forget; no orphaned data lingering forever. |
| Metadata source of truth | **S3 itself** for the file tree. MySQL only for audit, quota counters, and jobs. | A parallel file index drifts from S3 and needs reconciliation. Listing already works via `ListObjectsV2` with a delimiter. |

## 3. Non-goals

- Any form of file sharing, share links, or collaboration.
- Real-time collaborative editing or in-browser document editing.
- Versioning exposed in the UI. S3 versioning is on for recovery and compliance, but v1
  shows only current versions. Restoring an old version is an admin/support operation.
- Full-text search inside file contents. v1 searches file and folder names only.
- Replacing the existing Forms Library or Logos browser. Those keep using
  `Calculators/File Browser/` and `/api/files` unchanged.
- Mobile (Capacitor) support. The popup will be desktop-first; mobile is a later phase.
- Dragging files *out* of the browser to the desktop. This is a Chrome-only nonstandard
  API and will not be attempted. Download is the supported path.

## 4. Current state (verified)

### Auth — Cognito User Pool only

- Hosted UI + OAuth2 authorization code + PKCE. `login.html` → `login-callback.html`.
- **No Identity Pool anywhere in the repo.** The browser never receives AWS credentials.
  All S3 access is via backend-issued presigned URLs.
- ID token (not access token) is stored as `auth_token` in `localStorage` and as a cookie
  on `.msfgco.com` — the ID token is used because only it carries the `email` claim
  (`login-callback.html:86-95`).
- Backend verification: `backend/auth/cognito.js` using `jose` + remote JWKS.
  `buildReqUser` (line 81) produces `{ sub, username, email, groups, claims }`.
- `backend/middleware/auth.js` `authenticate` adds `req.user.db` from a MySQL lookup by
  email, falling back to `cognito_sub`. `req.user.db.id` is the canonical integer user ID.
- `backend/middleware/userContext.js` provides `getUserId`, `isAdmin`, `hasRole`,
  `requireDbUser`, `requireAdmin`, and honours the `X-Active-Role` header
  (validated against JWT groups) for multi-group users.

### S3 — AWS SDK v3, presigned-URL pattern already established

- `backend/services/s3.js` — `s3East` (`us-east-1`) and `s3West` (`us-west-2`) clients, a
  `BUCKETS` registry (`forms`, `media`, `dashboard`), and helpers `getUploadUrl`,
  `getDownloadUrl`, `getObject`, `deleteObject`, `resolveUrl`, `resolveUrls`,
  `buildMediaKey`, `buildFormsKey`, `sanitizeFileName`.
- Credentials come from the default AWS credential chain — EC2 instance role or env vars.
  **Which one is live in production must be confirmed before writing the IAM policy.**
- Existing buckets: `msfg-dashboard-files` (us-east-1), `msfg-media` (us-west-2),
  `msfg-mortgage-documents-prod` (us-east-1).
- Established upload flow everywhere in the codebase: `POST …/upload-url` →
  browser `PUT`s directly to S3 → metadata saved. `multer` is used only in
  `backend/routes/checklists.js` for server-side PDF parsing, never for S3.

### The existing File Browser (the thing we are extending)

- `backend/routes/files.js` (202 lines) — `POST /upload-url`, `GET /browse`,
  `GET /download-url`. Browsing is restricted to an `ALLOWED_LIBRARIES` whitelist
  (`forms`, `logos`), with `..` and leading-`/` rejection on both `path` and `key`.
  `GET /browse` already paginates `ListObjectsV2` correctly past 1,000 objects
  (lines 112-126) and splits `CommonPrefixes` into folders.
- `Calculators/File Browser/file-browser.html` (317 lines) — read-only. Has breadcrumbs,
  folder/file rows, per-extension FontAwesome icons, size/date formatting, HTML escaping,
  and loading/empty/error states. Missing: every write operation, drag-and-drop,
  multi-select, per-user scoping.
- Mounted in `backend/server.js` as
  `app.use('/api/files', authenticate, requireNonExternal, filesRoutes)`.

### Frontend conventions

- No bundler or framework. `build.js` content-hashes only the top-level `js/` and `css/`
  trees; files under `Calculators/**` are **passthrough-copied** and carry their own
  `?v=` query strings.
- `Calculators/Company Calendar/` is the precedent for a multi-module tool: ten
  `calendar-*.js` files living beside `calendar.html` inside the tool's own directory.
- Tools open via `Utils.openPopup(...)` dispatched from `js/action-dispatcher.js`.
- Header utility buttons live in `index.html:63-84` as `.header-util-btn` elements with
  `data-action` attributes. Alerts is the `open-notifications` button at line 72-75.
- `js/api-server.js` `ServerAPI.request()` attaches `Authorization: Bearer` and
  `X-Active-Role`, refreshes tokens proactively and on 401. Base URL is
  `https://api.msfgco.com/api` from `js/config.js`.

### Backend conventions

- Express 4 on EC2 behind PM2, port 8080, MySQL RDS via `mysql2/promise`.
- Route modules: `router.use(requireDbUser)`, async handlers, `next(error)` to the global
  handler, Zod validation from `backend/validation/schemas.js`.
- Migrations: numbered SQL in `backend/db/migrations/`, applied lexicographically on boot
  by `backend/db/migrations.js`. Idempotent via swallowed "already exists" errors; there is
  no migration-tracking table. **Latest is `089_manager_lo_assignments.sql`, so the next
  is `090`.**
- Rate limits: 1,000 requests / 15 min general, 200 / 15 min for writes.
- CORS allows `dashboard.msfgco.com` with headers `Content-Type`, `Authorization`,
  `X-Active-Role`.

## 5. Architecture

### 5.1 Storage layout

A **new dedicated bucket**, `msfg-user-folders`, in `us-east-1` (matching the existing
default S3 client and the RDS region). Not a prefix inside `msfg-dashboard-files`, because
NPI requires its own KMS key, lifecycle rules, and CloudTrail data-event logging, none of
which should be imposed on the bucket serving announcement attachments.

```
users/{userId}/                        ← the user's root
users/{userId}/Loan Docs/…             ← user-created folders
users/{userId}/Loan Docs/              ← zero-byte placeholder so empty folders persist
users/{userId}/.trash/{deletedAtMs}/…  ← soft-deleted items, hidden from normal listings
archive/{userId}/…                     ← offboarded users, admin read-only
```

Keeping trash inside the user prefix means quota accounting and admin browse pick it up
for free with no extra code paths.

Bucket configuration:

- Block Public Access: all four settings on.
- Versioning: enabled.
- Default encryption: SSE-KMS with a dedicated CMK, `alias/msfg-user-folders`.
- Bucket policy: deny requests where `aws:SecureTransport` is false; deny `PutObject`
  where `s3:x-amz-server-side-encryption` is not `aws:kms`.
- Server access logging enabled; CloudTrail S3 data events enabled for this bucket.
- CORS: origin `https://dashboard.msfgco.com`, methods GET/PUT/POST/HEAD,
  and **`ExposeHeaders: ["ETag"]`** — multipart upload cannot complete without reading
  part ETags from the browser.
- Lifecycle rules:
  - Abort incomplete multipart uploads after 7 days.
  - Expire objects tagged `msfg-state=trash` 30 days after creation.
  - Expire objects under the `archive/` prefix 365 days after creation.
  - Expire noncurrent versions after 90 days.

Note that S3 lifecycle prefix filters do **not** support wildcards, so a rule cannot target
`users/*/.trash/`. Trash expiry is therefore driven by an object **tag** applied at
soft-delete time, not by the key prefix. The `.trash/` path is for UI and listing purposes;
the tag is what actually drives deletion.

The 365-day archive window is a lifecycle rule and a one-line change if compliance wants
longer. It is set deliberately rather than left open, but should be confirmed.

GuardDuty Malware Protection for S3 is enabled on the bucket. Scanned objects are tagged
with a verdict; the UI treats an unscanned or `THREATS_FOUND` object as unavailable.

### 5.2 Isolation — the single security boundary

Without an Identity Pool there is no IAM backstop between one user and another. **The API
is the only thing preventing user A from reading user B's files.** Therefore:

- The client never sends an S3 key. It sends a path relative to its own root.
- Every endpoint resolves that path through one shared helper:

```js
// backend/utils/userFileKeys.js
function resolveUserKey(userId, clientPath) {
  // reject: null bytes, backslashes, '..' segments, leading '/', any '.trash' segment
  // normalize, collapse duplicate slashes
  // return `users/${userId}/${normalized}`
}

function resolveTrashKey(userId, clientPath) {
  // same validation, but scoped under `users/${userId}/.trash/`
  // used only by the /trash, /restore, and DELETE /trash endpoints
}
```

The trash endpoints deliberately use a **separate** resolver rather than a flag on the
first one. `resolveUserKey` unconditionally rejects any `.trash` segment, so a caller
cannot reach trash through a normal path, and there is no boolean argument whose default
could be wrong.

- Admin access to another user's files goes through **separate endpoints** guarded by
  `requireAdmin`, which write an audit row *before* performing the operation. There is no
  `?userId=` parameter on the normal endpoints — an admin viewing their own files and an
  admin viewing someone else's take different code paths, so a missing check cannot
  silently widen normal access.
- Presigned URLs are bearer capabilities. A key is only ever signed after it has passed
  through `resolveUserKey`. This is the property to test hardest.

### 5.3 Backend

New `backend/routes/userFiles.js`, mounted in `server.js` as:

```js
app.use('/api/my-files', authenticate, requireNonExternal, userFilesRoutes);
```

`requireNonExternal` matches the existing `/api/files` mount — External-role users do not
get personal storage.

| Method | Path | Purpose |
|---|---|---|
| GET | `/list?path=` | Folders + files at a path (`ListObjectsV2`, `Delimiter: '/'`, paginated) |
| POST | `/folder` | Create a zero-byte `path/` placeholder |
| POST | `/upload-url` | Presigned single PUT, for files under the multipart threshold |
| POST | `/multipart/create` | Begin a multipart upload, returns `uploadId` |
| POST | `/multipart/sign-parts` | Presign a **batch** of up to 50 part URLs |
| POST | `/multipart/complete` | Finalize from the collected part ETags |
| POST | `/multipart/abort` | Cancel and clean up |
| GET | `/download-url?path=` | Presigned GET with attachment disposition |
| GET | `/preview-url?path=` | Presigned GET with inline disposition |
| POST | `/move` | Move or rename, file or folder (copy + delete) |
| DELETE | `/` | Soft-delete into `.trash/` |
| GET | `/trash` | List trash |
| POST | `/restore` | Restore from trash to its original path |
| DELETE | `/trash` | Purge permanently |
| GET | `/usage` | Bytes used, quota, file count |
| GET | `/jobs/:id` | Poll a long-running move or delete |
| GET | `/admin/users` | Admin: list users with storage usage |
| GET | `/admin/list?userId=&path=` | Admin: browse another user's files |
| GET | `/admin/download-url?userId=&path=` | Admin: download another user's file |

**Multipart threshold: 100 MB.** Below it, a single presigned PUT. At or above,
multipart with 10 MB parts (10,000-part S3 ceiling × 10 MB = 100 GB, matching the quota).

Part URLs are presigned in **batches of 50**, not one per request. The existing write rate
limiter in `server.js` allows 200 writes per 15 minutes per IP, and a 5 GB file is 500
parts — signing individually would lock the user out mid-upload. Batching turns that into
10 calls. The upload bytes themselves go browser-to-S3 and never touch the rate limiter.

**Long-running operations.** Renaming or deleting a folder means copying and deleting every
object beneath it. S3 has no rename, this is not atomic, and it is not fast. The rule:

- **Under 200 objects** — perform synchronously, with concurrency-limited `CopyObject`
  calls (8 at a time) and `DeleteObjects` batched in chunks of 1,000. Return when done.
- **200 or more** — insert a row into `user_file_jobs`, return `202` with a job ID, and
  process in an in-process worker. The UI polls `/jobs/:id` and shows progress.

Without this split, a user renaming a folder with 5,000 files gets a hung browser tab and
a gateway timeout.

**Quota.** `user_file_quota.bytes_used` is maintained incrementally: incremented when an
upload is confirmed, decremented on permanent delete. Recomputing from `ListObjectsV2` on
every operation would be unacceptable at 100 GB per user. A nightly reconciliation job
recomputes each user's true usage from S3 and corrects drift. Uploads are rejected at the
`upload-url` / `multipart/create` step when the declared size would exceed the quota.

### 5.4 Database — migration `090_user_files.sql`

Three small tables. **No file index** — S3 remains the source of truth for the tree.

- `user_file_audit` — `id`, `user_id` (whose files), `actor_user_id` (who acted),
  `action` (`list`/`upload`/`download`/`preview`/`move`/`delete`/`restore`/`purge`/
  `admin_list`/`admin_download`), `s3_key`, `bytes`, `ip`, `user_agent`, `created_at`.
  Indexed on `(user_id, created_at)` and `(actor_user_id, created_at)`.
- `user_file_quota` — `user_id` PK, `bytes_used` BIGINT, `file_count` INT,
  `reconciled_at`, `updated_at`.
- `user_file_jobs` — `id`, `user_id`, `type` (`move`/`delete`), `status`
  (`pending`/`running`/`done`/`failed`), `source_prefix`, `dest_prefix`,
  `total_objects`, `processed_objects`, `error`, `created_at`, `updated_at`.

### 5.5 Frontend

A new popup tool, `Calculators/My Files/`, following the Company Calendar multi-module
precedent (files live in the tool's own directory and are passthrough-copied by
`build.js` with their own `?v=` strings):

| File | Responsibility |
|---|---|
| `my-files.html` | Shell markup, toolbar, breadcrumb bar, list container, modals |
| `styles.css` | Tool styling |
| `files-api.js` | Typed wrapper over `/api/my-files`, token handling, 401 refresh |
| `files-state.js` | Current path, selection, sort, clipboard, in-flight jobs |
| `files-render.js` | Breadcrumbs, rows, icons, empty/loading/error states |
| `files-upload.js` | Drop handling, upload queue, multipart orchestration, progress |
| `files-actions.js` | New folder, rename, move, delete, restore, download, context menu |
| `files-preview.js` | Inline image preview; PDF via the vendored pdf.js |
| `files-main.js` | Wiring and init |

Interaction model:

- Drag from the desktop onto the window to upload, including whole folders via
  `DataTransferItem.webkitGetAsEntry()`.
- Drag selected rows onto a folder row to move.
- Click to select, shift-click for ranges, ctrl/cmd-click to toggle.
- Right-click context menu and a toolbar with the same actions.
- Breadcrumb navigation, sortable Name / Size / Modified columns.
- Name-only search within the current subtree.
- The upload queue lives in `files-upload.js` state, not in the DOM, so navigating between
  folders mid-upload does not cancel anything.
- On first open, a one-time acknowledgment modal states that contents are company records
  subject to review. Acknowledgment is persisted per user.

Header changes in `index.html` — replace the Alerts button (lines 72-75) with:

```html
<a href="https://suite.msfgco.com" target="_blank" rel="noopener"
   class="header-util-btn" title="Suite">
  <i class="fas fa-layer-group"></i>
  <span class="util-label">Suite</span>
</a>
<button type="button" class="header-util-btn" data-action="open-my-files" title="My Files">
  <i class="fas fa-folder"></i>
  <span class="util-label">My Files</span>
</button>
```

And in `js/action-dispatcher.js`:

```js
'open-my-files': () =>
  Utils.openPopup('Calculators/My Files/my-files.html', 'MSFGMyFiles', 1200, 820),
```

**Notifications are not being deleted.** Removing the Alerts button removes the only entry
point to `ModalsManager.showNotificationsModal()`. That modal moves into the user dropdown
next to Settings so the feature remains reachable.

## 6. Error handling

| Condition | Behaviour |
|---|---|
| Path fails `resolveUserKey` validation | `400`, generic message, audit row with the rejected input |
| Non-admin hits an `/admin/*` endpoint | `403`, audit row |
| Upload would exceed quota | `409` with bytes used and remaining, before any presign |
| Presigned URL expired mid-upload | Client re-requests a URL and retries the part; queue survives |
| Multipart upload abandoned | Lifecycle rule aborts it after 7 days; no orphan billing |
| Move/delete job fails partway | Job row records `error` and `processed_objects`; operation is idempotent and safe to re-run, since copy-then-delete skips already-copied keys |
| Object tagged `THREATS_FOUND` | Hidden from listing, download refused, admin notified |
| Object not yet scanned | Shown as pending; download refused until a verdict exists |
| S3 5xx | Retried with backoff by the SDK; surfaced as `503` after exhaustion |
| Token expired | Existing `ServerAPI` refresh path; the popup shares `localStorage` with the opener |

## 7. Testing

Vitest is already configured (`backend/vitest.config.js`).

**Security tests are the priority** — these are the ones that matter:

- `resolveUserKey` rejects `..`, `../`, encoded traversal, absolute paths, backslashes,
  null bytes, and `.trash` access, across a table of adversarial inputs.
- Every non-admin endpoint refuses a path resolving outside the caller's own prefix.
- Admin endpoints refuse non-admins and always write an audit row.
- No endpoint accepts a raw S3 key from the client.

**Functional:**

- Listing splits `CommonPrefixes` into folders and paginates past 1,000 objects.
- Create/rename/delete round-trips, including the empty-folder placeholder.
- Folder move under and over the 200-object threshold (sync path and job path).
- Quota increments and decrements correctly; reconciliation corrects induced drift.
- Trash → restore returns a file to its original path; purge removes it.
- Multipart create → sign → complete, and abort cleanup.

**Manual:** drag-and-drop from desktop including nested folders, drag-to-move between
folders, upload progress surviving folder navigation, preview of image and PDF, and the
admin browse flow.

## 8. Phasing

Each phase is independently shippable.

1. **Suite button + header restructure.** Replace Alerts with Suite and a placeholder
   My Files button; relocate the notifications entry point into the user dropdown.
2. **AWS groundwork.** Create the bucket, KMS key, bucket policy, CORS, lifecycle rules,
   logging, and GuardDuty. Update the backend IAM policy. Confirm whether EC2 uses an
   instance role or access keys first.
3. **Backend read path.** Migration 090, `resolveUserKey`, `/list`, `/download-url`,
   `/preview-url`, `/usage`, audit logging.
4. **Backend write path.** Folder create, single-PUT upload, soft delete, restore, purge,
   quota accounting.
5. **Frontend v1.** Popup shell, listing, breadcrumbs, upload via drag-and-drop, download,
   new folder, delete, the acknowledgment modal.
6. **Move, rename, and jobs.** Sync and async paths, plus drag-to-move in the UI.
7. **Multipart upload.** Backend endpoints and client orchestration for files ≥ 100 MB.
8. **Preview and search.** Inline image and PDF preview, name search, sortable columns.
9. **Admin and offboarding.** Admin browse UI, deactivation archive job, nightly quota
   reconciliation.

## 9. Open items

These are external dependencies, not undecided design. Each has a defined default so no
phase is blocked on discussion alone.

- **Blocking Phase 2:** confirm whether the production EC2 backend authenticates to AWS via
  an instance role or access keys in `.env`. The code uses the default credential chain, so
  both are possible, and this determines where the new S3 and KMS permissions attach.
- **Blocking Phase 1:** confirm the user-facing Suite host is `https://suite.msfgco.com`
  and that it opens in a new tab with no token hand-off. `js/config.js` references
  `los.msfgco.com` as the Suite *API* host, so the two should not be conflated.
- **Non-blocking:** compliance sign-off on the 365-day archive window for offboarded users.
  The default is set; changing it is a lifecycle-rule edit.
- **Non-blocking:** icon choice for the Suite button (`fa-layer-group` is the default).

Each phase in section 8 gets its own implementation plan under
`docs/superpowers/plans/`, following the existing convention in this repo.
