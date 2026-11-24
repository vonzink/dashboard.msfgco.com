# Website CMS: production requirements and deployment

Status (2026-11-24): the complete flow passes locally against MySQL 8.0 with synthetic
data. **Production is not ready.** Items marked BLOCKER must be resolved first.

## How it is wired

- `server.js` creates the CMS only when `WEBSITE_CMS_ENABLED=1`
  (`services/websiteCms/compose.js`). Otherwise `/api/website-cms` is not mounted and
  the dashboard Website tab stays hidden.
- Authentication: existing dashboard chain (`middleware/auth` Cognito JWT → dashboard
  user lookup → `requireDbUser` → `requireActiveDbUser`).
- Authorization: explicit rows in `website_cms_grants` (`website.edit`,
  `website.publish`, `website.roles.manage`). Dashboard roles and Cognito groups grant
  nothing. Grants are managed only with `scripts/website-cms-admin.js`.
- Storage: MySQL tables from migrations 097–099 on the dashboard database, through a
  dedicated pool (`DB_*` settings, `WEBSITE_CMS_DB_POOL_LIMIT`, default 4).
- Publication: directory store at `WEBSITE_CMS_PUBLICATION_DIR` (manifests, assets,
  `current.json` pointer). The public website reads the same directory
  (`MSFG_PUBLICATION_SOURCE_DIR`) and adopts a new release on its next poll (~30 s).
- Catalogs: website-owned hero/content catalogs, exported to
  `WEBSITE_CMS_CATALOG_DIR` with `website-cms-admin.js export-catalog`.
- Editor media and "open published" links use `CONFIG.website.origin` (`js/config.js`).

## Remaining production requirements

1. **BLOCKER: shared publication storage.** Only a local directory store exists, on both
   the dashboard and the website. The dashboard backend (EC2) and the public website must
   read and write the same release store. Options: (a) build an S3 publication store with
   generation-conditional pointer writes on both sides, or (b) host the website on the
   same machine and share the directory. Decide where the website is hosted first.
2. **BLOCKER: initial publication.** The first release in the store becomes the editorial
   seed (`initialize`). It must be the content the live website shows today, not the
   synthetic demo release. Decide its source.
3. **BLOCKER: website origin.** Set `CONFIG.website.origin` in `js/config.js` to the
   production website URL. While empty, editor media previews and website links are
   blank.
4. **Startup runs migrations.** `startServer` applies all migrations on every boot. The
   first backend restart with this code creates the 097–099 tables in production. Take an
   RDS snapshot before that restart. The tables are additive (`CREATE TABLE IF NOT
   EXISTS`); no existing table changes.
5. **Grants.** Choose the first role manager (an active dashboard user) and the staff who
   may edit and publish.
6. **Editor wording.** `website-cms.html` still shows "Website editor preview — production
   integration pending" and the local-review note. Update before staff use it.
7. **Rollback UI.** Rollback works through `POST /api/website-cms/publications/:id/rollback`
   (publish permission required). The editor has no rollback button.
8. **Draft preview on the website.** Not built. The editor previews exact saved revisions
   privately; the website only shows published releases.
9. **Capacity.** The repository loads full editorial history per transaction (see
   `MYSQL.md`). Measure memory and lock time with production-sized history.
10. **Database access.** The CMS uses the dashboard database user. `MYSQL.md` recommends
    restricting out-of-band SQL writes to the CMS tables.
11. **Catalog updates.** Re-export the catalog bundle whenever the website hero/content
    catalog changes (currently 27 heroes), then restart the backend. Startup adds missing
    catalog IDs and never overwrites saved revisions.

## Deployment steps (after the blockers are resolved)

Each step changes production and needs explicit approval at that time.

1. **Snapshot the dashboard RDS database.**
2. **Export the catalog bundle** from the website release being deployed:
   `node scripts/website-cms-admin.js export-catalog <WEBSITE_REPO> <CATALOG_DIR>`
   and copy the directory to the backend server.
3. **Prepare the publication store** with the approved initial release (blocker 2), at the
   location the website also reads (blocker 1).
4. **Set backend environment** (server `.env`, not committed):
   `WEBSITE_CMS_ENABLED=1`, `WEBSITE_CMS_PUBLICATION_DIR=<DIR>`,
   `WEBSITE_CMS_CATALOG_DIR=<DIR>`; optional `WEBSITE_CMS_DB_POOL_LIMIT`,
   `WEBSITE_CMS_LOCK_TIMEOUT_SECONDS`. Existing `DB_*` settings are reused.
5. **Deploy the backend** (`./deploy.sh --backend-only` after merge to `main`). The restart
   applies migrations 097–099 (requirement 4). With the editorial history not yet
   initialized, the CMS logs "Website CMS failed to start" and answers 503; the dashboard
   keeps working.
6. **Initialize and grant** on the backend server, from the backend folder, with the
   server environment loaded:
   - `node scripts/website-cms-admin.js initialize`
   - `node scripts/website-cms-admin.js bootstrap-manager <MANAGER_EMAIL>`
   - `node scripts/website-cms-admin.js grant <MANAGER_EMAIL> <USER_EMAIL> website.edit,website.publish`
   - `node scripts/website-cms-admin.js show-grants`
7. **Restart the backend** (`pm2 restart msfg-backend`) and confirm the log shows
   "Website CMS ready".
8. **Deploy the frontend** (`./deploy.sh`) with `CONFIG.website.origin` set.
9. **Verify** with a granted account: Website tab visible, draft save, preview, publish,
   website update, rollback. Verify an ungranted account sees no tab and gets 403.

To disable: set `WEBSITE_CMS_ENABLED=0` (or remove it) and restart. The tables, history and
releases stay; the public website keeps serving its current release.
