/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';
const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const schema = require('./site.schema.json');
// Draft-07 uses Ajv's default class. Never coerce, strip fields, or silently default a snapshot.
const ajv = new Ajv({ strict: true, allErrors: false, ownProperties: true, coerceTypes: false, removeAdditional: false, useDefaults: false });
addFormats(ajv, { formats: ['date', 'date-time', 'email', 'uri', 'uri-reference'], mode: 'full' });
ajv.addSchema(schema);
const validators = new Map();
class ContractValidationError extends Error {
  constructor(rule) {
    super(`Invalid public contract: ${rule}`);
    this.name = 'ContractValidationError';
    this.code = 'invalid_public_contract';
  }
}
function assert(condition, rule) { if (!condition) throw new ContractValidationError(rule); }

// Bound work before format regexes run. Accept JSON data only, never getters/prototypes/toJSON.
// This is also a defensive boundary for callers passing JS objects rather than parsed JSON.
function checkJson(value) {
  let nodes = 0; let chars = 0;
  const seen = new Set();
  function visit(v, depth) {
    assert(++nodes <= 150000 && depth <= 30, 'input bounds');
    if (typeof v === 'string') {
      chars += v.length;
      assert(v.length <= 10000 && chars <= 8000000, 'string bounds');
      assert(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v), 'control character');
      if (/^https:\/\//.test(v)) {
        let u; try { u = new URL(v); } catch { throw new ContractValidationError('URL'); }
        assert(!u.username && !u.password && !/[\\\s<>]/.test(v), 'unsafe URL');
      }
      return;
    }
    if (v === null || typeof v === 'boolean') return;
    if (typeof v === 'number') { assert(Number.isFinite(v), 'finite number'); return; }
    assert(typeof v === 'object', 'JSON value');
    assert(!seen.has(v), 'cyclic JSON'); seen.add(v);
    const array = Array.isArray(v);
    assert(array || Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null, 'plain object');
    assert(Reflect.ownKeys(v).length <= (array ? 10001 : 2001), 'container bounds');
    for (const key of Reflect.ownKeys(v)) {
      if (array && key === 'length') continue;
      assert(typeof key === 'string' && key.length <= 500 && !['__proto__', 'constructor', 'prototype'].includes(key), 'property key');
      const descriptor = Object.getOwnPropertyDescriptor(v, key);
      assert(descriptor.enumerable && 'value' in descriptor, 'JSON property');
      if (array) assert(/^(0|[1-9][0-9]*)$/.test(key), 'array property');
      visit(descriptor.value, depth + 1);
    }
    if (array) assert(Object.keys(v).length === v.length, 'sparse array');
    seen.delete(v);
  }
  visit(value, 0);
}
function validate(name, value) {
  checkJson(value);
  let validator = validators.get(name);
  if (!validator) { validator = ajv.compile({ $ref: `${schema.$id}#/definitions/${name}` }); validators.set(name, validator); }
  // Only expose the validator keyword, never attacker input, raw field values, or internal configuration.
  assert(validator(value), `${name} schema (${validator.errors?.[0]?.keyword ?? 'invalid'})`);
  return value;
}
function unique(items, key, label) {
  const keys = items.map(key); assert(new Set(keys).size === keys.length, `duplicate ${label}`); return new Set(keys);
}
function safeLink(value) {
  let decoded = value;
  for (let i = 0; i < 3; i++) {
    try { const next = decodeURIComponent(decoded); if (next === decoded) break; decoded = next; }
    catch { throw new ContractValidationError('URL encoding'); }
  }
  assert(!/[\u0000-\u0020\\<>]/.test(decoded), 'unsafe link characters');
  assert(!decoded.startsWith('//') && !/(?:^|\/)\.\.(?:\/|$|[?#])/.test(decoded), 'unsafe link path');
}
// Shared link semantics for snapshots and standalone SEO. Asset existence is checked
// only when the caller supplies a publication inventory. External SEO images are URLs.
function references(value, image, key = '') {
  if (typeof value === 'string') {
    if (['photoAsset', 'imageAsset', 'equalHousingAsset', 'horizontal', 'white', 'mark', 'desktopAsset', 'mobileAsset'].includes(key)) image?.(value);
    if (key === 'ogImage' && !value.startsWith('https://')) image?.(value);
    if (['href', 'sourceUrl', 'canonical', 'ogImage', 'nmlsConsumerAccessUrl', 'url', 'logo', 'item'].includes(key)) safeLink(value);
    return;
  }
  if (value && typeof value === 'object') for (const [childKey, child] of Object.entries(value)) references(child, image, childKey);
}
function origin(value) {
  const u = new URL(value); assert(u.origin === value && u.protocol === 'https:' && !u.username && !u.password, 'origin');
}
const divisionPaths = new Set(['/veterans', '/reverse', '/investment', '/home-equity']);
const legalPaths = new Set(['/licensing', '/privacy-notice', '/privacy-policy', '/terms', '/accessibility', '/texas-required-notice', '/nmls-consumer-access']);
const staticPaths = new Set(['/', ...divisionPaths, ...legalPaths, '/buy', '/refinance', '/loan-officers', '/contact', '/faq', '/rates', '/resources/mortgage-glossary', '/sitemap', '/about', '/careers', '/know-your-lender']);
const programs = new Set(['conventional', 'fha', 'usda', 'jumbo', 'second-home']);
function parseSiteSnapshot(value) {
  const x = validate('SiteSnapshot', value);
  origin(x.site.origin); origin(x.calculatorCompatibility.origin);
  assert(x.site.origin === x.calculatorCompatibility.origin, 'compatibility origin');
  const officers = unique(x.officers, o => o.id, 'officer ID');
  unique(x.officers, o => o.slug, 'officer slug');
  const testimonials = unique(x.testimonials, t => t.id, 'testimonial ID');
  unique(x.pages, p => p.id, 'page ID');
  const paths = unique(x.pages, p => p.path, 'page path');
  assert(paths.has('/') && [...divisionPaths].every(p => paths.has(p)), 'home and division pages');
  const mediaNames = unique(x.media, m => m.name, 'media name');
  const files = new Map(); const media = new Map(x.media.map(m => [m.name, m]));
  const mime = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml', mp4: 'video/mp4' };
  for (const m of x.media) {
    for (const f of m.files) {
      assert(!files.has(f.path), 'duplicate asset path'); files.set(f.path, f);
      assert(mime[f.path.split('.').at(-1)] === f.contentType, 'asset MIME');
      if (m.kind === 'image') assert(f.contentType.startsWith('image/'), 'image media');
    }
    if (m.kind === 'hero-video') {
      const required = ['poster.jpg', '720p.mp4', '1080p-av1.mp4', '1080p.mp4'];
      assert(m.files.length === 4 && required.every(file => m.files.some(f => f.path === `/heroes/${m.name}/${file}`)), 'complete video renditions');
    }
  }
  function image(path) { assert(files.has(path) && files.get(path).contentType.startsWith('image/'), 'image reference'); }
  function imageRef(ref) { image(ref.desktopAsset); image(ref.mobileAsset); }
  const revisions = unique(x.revisions, r => `${r.entity.kind}:${r.entity.id}`, 'entity revision');
  unique(x.revisions, r => r.revisionId, 'revision ID');
  const expected = new Set(['site:site', ...x.pages.map(p => `page:${p.id}`), ...x.officers.map(o => `officer:${o.id}`), ...x.testimonials.map(t => `testimonial:${t.id}`)]);
  assert(revisions.size === expected.size && [...revisions].every(r => expected.has(r)), 'revision coverage');
  for (const p of x.pages) {
    const validProgram = p.path.startsWith('/loans/') && programs.has(p.path.slice(7));
    const profile = x.officers.find(o => p.path === `/loan-officers/${o.slug}`);
    assert(staticPaths.has(p.path) || validProgram || profile, 'approved route');
    let template = 'standard';
    if (p.path === '/') template = 'home';
    else if (divisionPaths.has(p.path)) template = 'division';
    else if (['/buy', '/refinance'].includes(p.path)) template = 'product';
    else if (legalPaths.has(p.path)) template = 'legal';
    else if (p.path === '/loan-officers') template = 'officer-directory';
    else if (profile) template = 'officer-profile';
    else if (p.path === '/faq') template = 'faq';
    else if (p.path === '/rates') template = 'rates';
    else if (p.path === '/sitemap') template = 'sitemap';
    else if (p.path === '/resources/mortgage-glossary') template = 'glossary';
    else if (validProgram) template = 'program';
    assert(p.template === template, 'route template');
    assert(profile ? p.officerId === profile.id : !Object.hasOwn(p, 'officerId'), 'profile officer');
    if (p.path === '/') assert(p.heroVariants.length === 5, 'five home variants');
    if (divisionPaths.has(p.path)) assert(p.heroVariants.length === 3, 'three division variants');
    unique(p.heroVariants, h => h.id, 'hero ID'); unique(p.sections, s => s.id, 'section ID');
    imageRef(p.fallbackImage);
    for (const h of p.heroVariants) {
      if (h.media.kind === 'image') imageRef(h.media);
      else assert(mediaNames.has(h.media.name) && media.get(h.media.name).kind === 'hero-video', 'video reference');
    }
    for (const section of p.sections) {
      if (section.type === 'testimonials') assert(section.testimonialIds.every(id => testimonials.has(id)), 'testimonial reference');
      if (section.type === 'officer-introduction') assert(section.officerIds.every(id => officers.has(id)), 'officer reference');
      if (section.type === 'estimator-reference') assert(({ '/buy': 'purchase', '/refinance': 'refinance', '/veterans': 'va', '/investment': 'investment', '/home-equity': 'equity' })[p.path] === section.estimator, 'estimator route');
    }
  }
  references(x, image);
  for (const group of [x.site.legal.states, x.calculatorCompatibility.config.legal.states]) unique(group, s => s.code, 'company state');
  for (const value of Object.values(x.calculatorCompatibility.config.theme)) {
    if (value.startsWith('rgba(')) assert(value.slice(5).split(',').slice(0, 3).every(n => Number(n) <= 255), 'color range');
  }
  return x;
}
function parseRevocations(value) { return validate('OfficerRevocations', value); }
function parsePublishRequest(value) {
  const x = validate('PublishRequest', value);
  unique(x.selections, s => `${s.kind}:${s.id}`, 'selected entity');
  assert(x.selections.every(s => s.kind !== 'site' || (s.id === 'site' && s.action === 'replace')), 'site selection');
  return x;
}
function parseActivePointer(value) {
  const x = validate('ActivePointer', value);
  assert(x.manifestKey === `publications/${x.publicationId}/snapshot.json`, 'manifest publication');
  return x;
}
function parsePublicationResult(value) { return validate('PublicationResult', value); }
function parsePageSeo(value) {
  checkJson(value);
  assert(value !== null && typeof value === 'object' && !Array.isArray(value), 'SEO object');
  const x = validate('PageSeo', { include: true, ...value });
  references(x);
  return x;
}
module.exports = { ContractValidationError, parseSiteSnapshot, parseRevocations, parsePublishRequest, parseActivePointer, parsePublicationResult, parsePageSeo };
