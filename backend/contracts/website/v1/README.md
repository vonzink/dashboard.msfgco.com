# Public website contract v1

Canonical package: `@msfg/website-contracts`, CommonJS `require(...)` with TypeScript declarations. Both dashboard producer and public consumer MUST call `parseSiteSnapshot`; JSON Schema alone does not enforce reference/count/revision semantics. No CMS API or loader is included.

## Distribution and integrity

Vendor this entire directory into `backend/contracts/website/v1`. Backend dependency: `"@msfg/website-contracts": "file:contracts/website/v1"`. Runtime dependencies are exactly `ajv@8.20.0` and `ajv-formats@3.0.1`; producer lockfile is coordinator-owned. Library minimum Node 20 is a compatibility floor, not an instruction to upgrade a host. Verify deployed producer Node and package installation before release. Public repository retains its separate Node 24.13.0 requirement.

`contract-version.json` records SHA-256 of every distributed file except itself. Its aggregate hashes sorted `path + NUL + fileSha256 + LF` entries. Root public `contract-version.json` is an identical copy. Run `node scripts/check-contracts.mjs <dashboard-worktree>` from the public repository. Omit the argument for explicitly local-only checks. Checks reject untracked package files, symlinks, byte drift, manifest drift, and schema/type drift, then validate synthetic fixtures. `node_modules` is excluded; consumers should install via the parent dependency, not inside the vendored directory. Digests detect drift, not malicious rewriting or signature authenticity. Review and coordinate all manifest changes.

`types.d.ts` is generated exclusively from `site.schema.json` with `typegen.cjs`; the checker regenerates in memory and compares. After an approved schema change, regenerate declarations before reviewing hashes. The generator rejects unsupported schema keywords even alongside recognized types, compositions mixed with other structural keywords, open objects, mixed fixed/pattern properties and multiple patternProperties entries; it never silently selects a first pattern. Schema is draft-07 using the default Ajv class with strict validation, no coercion/field stripping, and no snapshot defaults. Format strings and input traversal are bounded before format checks. Official references: https://ajv.js.org/json-schema.html and https://ajv.js.org/guide/formats.html.

## Public shapes and semantics

All objects are closed. Legal prose is a finite tree of paragraphs/headings/lists and text/strong/emphasis/link inline nodes; never executable HTML or CSS. JSON-LD is a closed union of organization, FAQ and breadcrumb data, including closed nested addresses/answers/items. Strings are plain text; render as text nodes. Even approved JSON-LD must be safely serialized (escape `<` when embedding); contract validation does not authorize unsafe rendering or establish claim accuracy.

Links permit literal root-relative paths, fragments, HTTPS, mailto, tel and sms. Protocol-relative paths, encoded traversal, credentials, controls and backslashes are rejected. URL validation does not establish that destinations are live/approved: application routing verification remains F0/P2 work.

Pages have frozen route/template associations. Homepage `/` has exactly five variants. `/veterans`, `/reverse`, `/investment`, `/home-equity` each have exactly three. `/buy` and `/refinance` are product pages with zero through five variants, not additional divisions. Every page carries a permanent image fallback, and zero active variants is valid. Home and the four other division pages must be present in a complete snapshot. Hero IDs and section IDs are unique within a page; page IDs/routes, officer IDs/slugs, testimonials, media names, asset paths and revisions are unique in their respective namespaces.

Media image refs are asset paths; video refs are media-set names. Each video set contains exactly `/heroes/{name}/{poster.jpg,720p.mp4,1080p-av1.mp4,1080p.mp4}`. All named images, including portraits, logos, local SEO images and permanent fallbacks, must resolve to image files. MIME/extension consistency and positive bounded bytes/hash syntax are checked. Upload byte hashes, actual codecs, dimensions, fast start, SVG sanitization, rights and accessibility are producer/media acceptance gates, not proven by this manifest.

Revision coverage is a bijection over the public entities: one `site:site`, every page, every officer and every testimonial. No revision author/audit/staff/Suite mapping fields are public. The selected-draft fixture is the fully assembled prospective public snapshot; the separate publish-request fixture identifies the one selected page replacement. Unselected pages/officers/revisions stay identical. Never serve preview snapshots publicly simply because they validate.

`revoked-officer.json` is `OfficerRevocations`, NOT a SiteSnapshot. `rollback.json` retains the revoked officer to prove that a historical content rollback must not clear independent revocations. These parsers validate payloads; monotonic store writes, 60-second freshness, authorization, and fail-closed routing belong to later producer/runtime work.

## Calculator projection and C1 adapter

Read-only provenance: `WebProjects/msfg.us/src/server/tenant/config.ts` imports `src/content/site.ts` (`TenantConfigSchema`); SEO shape comes from `src/server/cms/seo.ts`; calculator slugs come from `src/calculators/registry.ts`. No source code/config values were copied. Fixtures are synthetic, not publication-approved content.

`calculatorCompatibility.config` retains source nested `brand`, `theme`, `contact`, `legal`, `seo`, optional `marketing`, `features`, `applyOffRamp`, and `calculators`. These include print company identity, disabled calculator slugs, example rate, disclaimers and metadata defaults. Source `ai` (provider/model/baseUrl/brain) is deliberately absent. AI/CRM feature flags are literal false. Theme has every source token name but permits only bounded hex/RGBA colors, pixel radii, and the fixed Hanken font expression; arbitrary CSS and URLs are rejected. Public origin is HTTPS and must agree with compatibility origin. Source SEO fields remain optional except materialized `include`; standalone `parsePageSeo({})` returns `{include:true}` without mutating its input. Canonical values allow safe relative references (including root-relative and dot-relative paths) or HTTPS overrides, with no requirement to match the current route or origin. Page and global SEO images accept local asset paths or external HTTPS URLs; only local assets require manifest membership. Robots remains a bounded raw directive string, preserving empty values, case, spaces/tabs, independent index/follow choices and additional directive tokens rather than normalizing to an enum. Script markup, control injection, unsafe schemes, protocol-relative URLs, credentials and parent-directory traversal remain rejected. The same recursive URL checks apply to standalone SEO and snapshots, including JSON-LD url/logo/item fields. The closed JSON-LD union intentionally remains stricter than the original arbitrary record, to prevent private fields and executable content; this safety projection does not alter metadata precedence. Source evidence also includes `src/lib/seo/buildMetadata.ts`, where page overrides take precedence over route defaults and global config, robots index/follow are independent substring checks, and staging forces noindex/nofollow.

C1 must implement its typed adapter OUTSIDE protected calculator files. Its return type can remain the original TenantConfig, restoring only inert server-side AI compatibility fields, for example:

```ts
function toTenantConfig(publicConfig: PublicTenantConfig): TenantConfig {
  return {
    ...publicConfig,
    ai: { provider: 'openai-compatible', model: '', brain: { enabled: false, baseUrl: '' } },
  };
}
```

The example imports types from their respective public/source-compatible modules in C1; those modules are not created here. No live service settings or secrets enter this projection. C1 still verifies actual imported type assignability, source fallback/default behavior and metadata merge precedence against its frozen dependency inventory. Public validation rejects malformed snapshots instead of substituting source defaults. Do not silently drop fields from a raw private config: construct the public allowlist explicitly before validation.

Synthetic fixtures use example.com, reserved example phone numbers, fictitious identities and all-zero asset hashes. They are contract tests, not bootstrap production data. Syntactic validation does not prove licensing, content approval, asset availability, or legal compliance.

Version 1.0.1 permits an empty testimonialIds list so a reserved placement does not require an invented endorsement. Existing 1.0.0 snapshots remain valid.

Version 1.1.0 adds optional hero artworkAsset, primary and secondary public links. Artwork must resolve to a declared image file; link safety rules apply. Older snapshots remain valid. Private library IDs, revisions and audit data do not enter the public hero. Publishing a page copies an exact library revision; later library edits never mutate that page.
