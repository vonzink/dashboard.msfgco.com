/* Bounded website editor. Existing dashboard auth may supply ServerAPI; the
 * explicit local harness supplies same-origin CSRF protection instead. */
(function () {
  'use strict';
  const byId = id => document.getElementById(id);
  const state = { entities: [], detail: null, publication: null, selected: null, dirty: false, busy: false, pending: null, recovering: false, media: [], library: [], libraryMedia: [], artwork: [], libraryDetail: null, libraryDirty: false, libraryRevision: null, previewHeroes: [], previewDefaults: null };
  const form = byId('draft-form');
  const dialog = byId('publish-confirmation');
  const clone = value => JSON.parse(JSON.stringify(value));

  function node(tag, text, className) {
    const result = document.createElement(tag);
    if (text !== undefined) result.textContent = text;
    if (className) result.className = className;
    return result;
  }
  function message(text) { byId('status').textContent = text; }
  function clearError() { byId('error').hidden = true; byId('error').textContent = ''; }
  function showError(error) {
    const messages = {
      400: 'Some fields could not be accepted. Check the content and try again.',
      401: 'Your staff session is no longer available. Sign in through the dashboard before continuing.',
      403: 'Your account is not permitted to make this website change.',
      404: 'This page or revision is no longer available. Refresh the revision list.',
      409: 'Another revision or publication changed first. Your input is still here. Review the latest version before saving or publishing again.',
      422: 'The selected content did not pass publication validation. Check the fields and media references before trying again.',
      503: 'The publishing service is temporarily unavailable. Your input is still here.',
    };
    byId('error').textContent = messages[error.status] || 'The result could not be confirmed. Your input is still here. Refresh revisions to check the result before trying again.';
    if (state.recovering) byId('error').textContent += ' Retry this publication before editing or choosing another revision.';
    byId('error').hidden = false;
  }
  function updateControls() {
    const hasDetail = !!state.detail;
    byId('draft-fields').disabled = state.busy || state.recovering || !hasDetail;
    byId('save-draft').disabled = state.busy || state.recovering || !hasDetail;
    byId('refresh').disabled = state.busy;
    byId('page-picker').disabled = state.busy || state.recovering || !state.entities.length;
    byId('revision-picker').disabled = state.busy || state.recovering || !hasDetail;
    byId('review-publish').textContent = state.recovering ? 'Retry publication' : 'Review publication';
    byId('review-publish').disabled = state.busy || !state.selected || state.selected.revisionId === state.detail?.published?.revisionId;
    byId('confirm-publish').disabled = state.busy || !state.pending;
    byId('cancel-publish').disabled = state.busy;
    byId('draft-state').textContent = state.dirty ? 'Unsaved changes' : hasDetail ? 'Saved version loaded' : 'Not loaded';
    const libraryLocked = state.busy || state.recovering || !state.libraryDetail;
    byId('library-fields').disabled = libraryLocked;
    for (const id of ['save-library-hero', 'reload-library-hero', 'library-revision-picker', 'preview-library-hero']) byId(id).disabled = libraryLocked;
    for (const card of document.querySelectorAll('.library-card')) card.disabled = state.busy || state.recovering;
    for (const button of document.querySelectorAll('[data-assign-hero]')) button.disabled = state.busy || state.recovering || state.dirty || !state.library.length;
    for (const note of document.querySelectorAll('.assignment-note')) note.textContent = state.dirty ? 'Save or refresh your page edits before assigning a library hero.' : 'Assignment saves a new page revision. It does not publish or alter the library.';
    byId('library-draft-state').textContent = state.libraryDirty ? 'Unsaved changes' : state.libraryDetail ? 'Saved version loaded' : 'Not loaded';
    byId('preview-page-revision').disabled = state.busy || !state.selected;
    byId('content-import').hidden = state.detail?.entity.kind !== 'page' || !state.detail?.hasContentImport;
    byId('load-website-copy').hidden = byId('content-import').hidden;
    byId('load-website-copy').disabled = state.busy || state.recovering;
  }
  async function task(operation) {
    if (state.busy) return;
    clearError(); state.busy = true; updateControls();
    try { await operation(); } catch (error) { showError(error); }
    finally { state.busy = false; updateControls(); }
  }
  async function request(path, options = {}) {
    const headers = { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}) };
    const optionsWithHeaders = { ...options, headers, cache: 'no-store' };
    const api = window.API && typeof window.API.request === 'function' ? window.API : window.ServerAPI;
    if (api && typeof api.request === 'function') return api.request(`/website-cms${path}`, optionsWithHeaders);
    const csrf = document.querySelector('meta[name="website-cms-csrf"]')?.content;
    if (!csrf) { const error = new Error('local_session_missing'); error.status = 403; throw error; }
    headers['X-CSRF-Token'] = csrf;
    const response = await fetch(`/api/website-cms${path}`, { ...optionsWithHeaders, credentials: 'same-origin' });
    if (!response.ok) { const error = new Error('website_request_failed'); error.status = response.status; throw error; }
    return response.status === 204 ? null : response.json();
  }
  function field(labelText, id, value, options = {}) {
    const wrapper = node('div', undefined, 'cms-field');
    const label = node('label', labelText);
    label.htmlFor = id;
    let input;
    if (options.choices) {
      input = node('select');
      for (const choice of options.choices) {
        const option = node('option', choice.label ?? choice);
        option.value = choice.value ?? choice; input.append(option);
      }
    } else input = node(options.multiline ? 'textarea' : 'input');
    input.id = id;
    if (options.multiline) input.rows = 3;
    if (!options.choices) {
      if (!options.multiline) input.type = options.number ? 'number' : 'text';
      if (options.number) { input.min = '0'; input.max = '1'; input.step = 'any'; }
      else input.maxLength = options.maxLength || 10000;
      input.required = !options.optional;
    }
    input.value = String(value ?? '');
    wrapper.append(label, input);
    return wrapper;
  }
  const entityKey = entity => entity.kind === 'page' ? entity.id : JSON.stringify([entity.kind, entity.id]);
  const contentTitle = (content, kind) => kind === 'site' ? 'Company contact details' : kind === 'officer' ? content.name : content.path === '/' ? 'Homepage' : content.title;
  let contentEditor;
  function mediaLabel(media) {
    return media.kind === 'video' ? `Video — ${media.name}` : `Image — ${media.desktopAsset}`;
  }
  function renderEditor() {
    const content = state.detail.latest.content;
    const kind = state.detail.entity.kind;
    byId('editor-title').textContent = `${contentTitle(content, kind)} draft`;
    byId('page-only-fields').hidden = kind !== 'page';
    byId('page-title').disabled = kind !== 'page';
    byId('page-description').disabled = kind !== 'page';
    byId('content-fields-title').textContent = kind === 'page' ? 'Page sections' : kind === 'officer' ? 'Officer profile' : 'Company contact';
    byId('content-fields-note').textContent = kind === 'page' ? 'Edit content within the approved layout. Page URLs and section types stay fixed.' : 'Save a draft, review its exact content, and publish when ready.';
    contentEditor = window.WebsiteContentFields.create(byId('section-fields'), kind, content, { photoAssets: state.detail.photoAssets, entities: state.entities });
    byId('base-revision').textContent = `Based on ${state.detail.latest.revisionId}`;
    if (kind !== 'page') { byId('hero-fields').replaceChildren(); return; }
    byId('page-title').value = content.title;
    byId('page-description').value = content.description;
    byId('base-revision').textContent = `Based on ${state.detail.latest.revisionId}`;
    state.media = clone(state.libraryMedia);
    for (const variant of content.heroVariants) {
      if (!state.media.some(media => JSON.stringify(media) === JSON.stringify(variant.media))) state.media.push(clone(variant.media));
    }
    if (!state.media.some(media => JSON.stringify(media) === JSON.stringify(content.fallbackImage))) state.media.push(clone(content.fallbackImage));
    const heroes = byId('hero-fields'); heroes.replaceChildren();
    content.heroVariants.forEach((hero, index) => {
      const details = node('details', undefined, 'hero-editor');
      details.open = index === 0;
      details.dataset.heroId = hero.id;
      details.append(node('summary', `Hero ${index + 1} · ${hero.active ? 'Active' : 'Inactive'}`));
      details.append(node('p', hero.id, 'hero-id'));
      const activeLabel = node('label', undefined, 'checkbox-label');
      const active = node('input'); active.type = 'checkbox'; active.checked = hero.active; active.id = `hero-${index}-active`;
      activeLabel.htmlFor = active.id; activeLabel.append(active, document.createTextNode(`Hero ${index + 1} active`)); details.append(activeLabel);
      details.append(field(`Hero ${index + 1} headline`, `hero-${index}-headline`, hero.headline));
      details.append(field(`Hero ${index + 1} description`, `hero-${index}-description`, hero.description, { multiline: true }));
      const alignments = node('div', undefined, 'field-row');
      alignments.append(field(`Hero ${index + 1} desktop alignment`, `hero-${index}-desktopAlign`, hero.desktopAlign, { choices: ['left', 'center', 'right'] }));
      alignments.append(field(`Hero ${index + 1} mobile alignment`, `hero-${index}-mobileAlign`, hero.mobileAlign, { choices: ['left', 'center', 'right'] })); details.append(alignments);
      details.append(field(`Hero ${index + 1} overlay darkness`, `hero-${index}-overlayOpacity`, hero.overlayOpacity, { number: true }));
      details.append(field(`Hero ${index + 1} background`, `hero-${index}-media`, state.media.findIndex(media => JSON.stringify(media) === JSON.stringify(hero.media)), { choices: state.media.map((media, i) => ({ value: String(i), label: mediaLabel(media) })) }));
      details.append(node('p', 'Choose from media already available to this page. Uploading new media is not connected in this review.', 'muted'));
      heroes.append(details);
    });
    renderAssignments();
  }
  function readEditor() {
    const content = contentEditor.read();
    if (state.detail.entity.kind !== 'page') return content;
    content.title = byId('page-title').value;
    content.description = byId('page-description').value;
    content.heroVariants.forEach((hero, index) => {
      hero.active = byId(`hero-${index}-active`).checked;
      ['headline', 'description', 'desktopAlign', 'mobileAlign'].forEach(key => { hero[key] = byId(`hero-${index}-${key}`).value; });
      hero.overlayOpacity = Number(byId(`hero-${index}-overlayOpacity`).value);
      hero.media = clone(state.media[Number(byId(`hero-${index}-media`).value)]);
    });
    return content;
  }
  function renderRevision(target, revision) {
    target.replaceChildren();
    if (!revision?.content) { target.append(node('p', 'No saved revision selected.', 'muted')); return; }
    const content = revision.content;
    if (state.detail.entity.kind !== 'page') { target.append(node('p', revision.revisionId, 'revision-code')); window.WebsiteContentFields.preview(target, state.detail.entity.kind, content); return; }
    target.append(node('p', revision.revisionId, 'revision-code'), node('h3', content.title), node('p', content.description));
    target.append(node('h3', `${content.heroVariants.filter(hero => hero.active).length} active heroes`));
    const list = node('ul');
    for (const hero of content.heroVariants) {
      const item = node('li');
      item.append(node('strong', `${hero.active ? 'Active' : 'Inactive'} · ${hero.headline}`), node('p', hero.description), node('p', mediaLabel(hero.media), 'muted'));
      list.append(item);
    }
    target.append(list);
    window.WebsiteContentFields.preview(target, 'page', content);
  }
  function renderRevisions(selectedId) {
    const revisions = [...state.detail.revisions];
    if (state.detail.published && !revisions.some(revision => revision.revisionId === state.detail.published?.revisionId)) revisions.push(state.detail.published);
    const picker = byId('revision-picker'); picker.replaceChildren();
    for (const revision of revisions) {
      const suffix = revision.revisionId === state.detail.published?.revisionId ? ' · Published' : revision.revisionId === state.detail.latest.revisionId ? ' · Latest draft' : ' · Saved draft';
      const option = node('option', `${revision.revisionId}${suffix}`); option.value = revision.revisionId; picker.append(option);
    }
    const chosen = revisions.find(revision => revision.revisionId === selectedId) || revisions.find(revision => revision.revisionId === state.detail.latest.revisionId) || revisions[0];
    picker.value = chosen?.revisionId || ''; state.selected = chosen;
    renderRevision(byId('revision-preview'), chosen);
  }
  function renderPublication() {
    byId('publication-id').textContent = state.publication ? `${state.publication.publicationId} · generation ${state.publication.generation}` : 'Unavailable';
  }
  async function loadPage(entity, selectedId) {
    const detail = await request(`/entities/${entity.kind}/${encodeURIComponent(entity.id)}`);
    state.detail = detail; state.publication = detail.publication; state.dirty = false;
    byId('page-picker').value = entityKey(entity); renderEditor(); renderRevisions(selectedId); renderPublication(); renderPublishedLink();
  }
  function renderEntityPicker(selectedKey) {
    const picker = byId('page-picker'); picker.replaceChildren();
    for (const entity of state.entities) { const option = node('option', `${entity.kind === 'page' ? entity.path : entity.kind === 'officer' ? 'Officer' : 'Company'} — ${entity.title}${entity.publishedRevisionId ? '' : ' · Not published'}`); option.value = entityKey(entity); picker.append(option); }
    if (selectedKey) picker.value = selectedKey;
  }
  async function refreshEntitySummaries() {
    const result = await request('/entities?kind=all');
    state.entities = result.entities.filter(entity => ['page', 'site', 'officer'].includes(entity.kind));
    renderEntityPicker(state.detail ? entityKey(state.detail.entity) : undefined);
    // Only refresh profile-reference choices. Keep unsaved fields and editor base.
    contentEditor?.updateEntities(state.entities);
  }
  async function loadEntities(id, selectedId) {
    const result = await request('/entities?kind=all');
    state.entities = result.entities.filter(entity => ['page', 'site', 'officer'].includes(entity.kind));
    state.publication = result.publication; renderPublication();
    if (result.pendingPublication) {
      state.pending = clone(result.pendingPublication); state.recovering = true;
      id = entityKey(state.pending.selections[0]); selectedId = state.pending.selections[0].revisionId;
    } else if (state.recovering) { state.pending = null; state.recovering = false; }
    renderEntityPicker(id);
    const selected = state.entities.find(entity => entityKey(entity) === id) || state.entities.find(entity => entity.path === '/') || state.entities[0];
    if (!selected) { state.detail = null; state.selected = null; message('No editable website pages are available.'); return; }
    await loadPage(selected, selectedId);
  }
  // Dashboard mode: CONFIG.website.origin is the public website, which serves hero media
  // and the published pages. The local review harness sets WEBSITE_CMS_PREVIEW_URL instead.
  function websiteOrigin() {
    try {
      const origin = new URL(window.CONFIG?.website?.origin);
      return ['http:', 'https:'].includes(origin.protocol) ? origin : null;
    } catch { return null; }
  }
  function mediaUrl(path) {
    const origin = websiteOrigin();
    return path && origin ? new URL(path, origin).href : path;
  }
  function renderPublishedLink() {
    const link = byId('open-published-content'); link.hidden = true;
    if (!state.detail) return;
    const content = state.detail.latest.content; const kind = state.detail.entity.kind;
    const path = kind === 'page' ? content.path : kind === 'officer' ? `/loan-officers/${content.slug}` : '/contact';
    try {
      if (window.WEBSITE_CMS_PREVIEW_URL) {
        const origin = new URL(window.WEBSITE_CMS_PREVIEW_URL);
        if (!['http:', 'https:'].includes(origin.protocol)) return;
        link.href = new URL(`/preview/content${path === '/' ? '' : path}`, origin).href;
      } else {
        const origin = websiteOrigin();
        if (!origin) return;
        link.href = new URL(path, origin).href;
      }
      link.hidden = false;
    } catch { /* An explicit website origin is required. */ }
  }
  function mayDiscard() { return !state.dirty || window.confirm('Discard the unsaved form changes and load the latest saved version?'); }

  function assetPath(path) {
    return typeof path === 'string' && /^\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(?:jpg|jpeg|png|webp|avif|svg|mp4)$/.test(path) ? mediaUrl(path) : '';
  }
  function posterFor(hero) {
    return hero.media.kind === 'video' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(hero.media.name)
      ? mediaUrl(`/heroes/${hero.media.name}/poster.jpg`) : assetPath(hero.media.desktopAsset);
  }
  function artworkFor(hero) {
    return assetPath(hero.artworkAsset) || (!hero.artworkAsset && hero.media.kind === 'video' && hero.media.name === 'christmas-gifts' ? mediaUrl('/brand/msfg-holiday-triangle.svg') : '');
  }
  function libraryRevisions(detail) {
    const revisions = [...(detail.revisions || [])];
    if (!revisions.some(item => item.revisionId === detail.latest.revisionId)) revisions.unshift(detail.latest);
    return revisions;
  }
  function renderLibraryCards() {
    const query = byId('library-search').value.trim().toLowerCase();
    const category = byId('library-category').value;
    const filtered = state.library.filter(entry => (!category || entry.content.category === category) && `${entry.content.name} ${entry.content.category} ${entry.content.hero.headline}`.toLowerCase().includes(query));
    const cards = byId('library-cards'); cards.replaceChildren();
    byId('library-count').textContent = `${filtered.length} of ${state.library.length} designs`;
    byId('library-empty').hidden = filtered.length > 0;
    for (const entry of filtered) {
      const card = node('button', undefined, 'library-card'); card.type = 'button'; card.dataset.libraryHero = entry.id;
      card.setAttribute('aria-pressed', String(state.libraryDetail?.id === entry.id));
      const visual = node('span', undefined, 'library-card-image');
      const poster = node('img'); poster.src = posterFor(entry.content.hero); poster.alt = ''; poster.loading = 'lazy'; poster.width = 640; poster.height = 360;
      visual.append(poster);
      const artPath = artworkFor(entry.content.hero);
      if (artPath) { const art = node('img', undefined, 'library-card-artwork'); art.src = artPath; art.alt = ''; art.loading = 'lazy'; visual.append(art); }
      const caption = node('span', undefined, 'library-card-caption'); caption.append(node('strong', entry.content.name), node('span', entry.content.category));
      card.append(visual, caption);
      card.addEventListener('click', () => {
        if (!mayDiscardLibrary()) return;
        task(async () => {
          await loadLibraryHero(entry.id);
          byId('library-editor').focus({ preventScroll: true });
          byId('library-editor').scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
        });
      });
      cards.append(card);
    }
    updateControls();
  }
  function destinationChoices(current) {
    const paths = new Set(['/buy', '/refinance', '/veterans', '/reverse', '/investment', '/home-equity', '/loan-officers', '/contact', '/apply/buy']);
    for (const entry of state.library) for (const key of ['primary', 'secondary']) if (entry.content.hero[key]?.href) paths.add(entry.content.hero[key].href);
    if (current) paths.add(current);
    return [{ value: '', label: 'Use page default' }, ...[...paths].map(path => ({ value: path, label: path === '/apply/buy' ? 'Application — /apply/buy' : path }))];
  }
  function renderLibraryEditor() {
    const detail = state.libraryDetail;
    const content = detail.latest.content; const hero = content.hero;
    byId('library-editor-title').textContent = content.name;
    byId('library-base-revision').textContent = `Editing latest library revision ${detail.latest.revisionId}`;
    const inputs = byId('library-inputs'); inputs.replaceChildren();
    inputs.append(field('Design name', 'library-name', content.name, { maxLength: 120 }), field('Category', 'library-category-name', content.category, { maxLength: 60 }));
    inputs.append(field('Library headline', 'library-headline', hero.headline, { maxLength: 140 }), field('Library description', 'library-description', hero.description, { multiline: true, maxLength: 420 }));
    inputs.append(field('Triangle artwork', 'library-artwork', hero.artworkAsset || '', { choices: [{ value: '', label: 'No explicit artwork (legacy default)' }, ...state.artwork.map(art => ({ value: art.path, label: art.label }))] }));
    inputs.append(field('Hero background', 'library-media', state.libraryMedia.findIndex(media => JSON.stringify(media) === JSON.stringify(hero.media)), { choices: state.libraryMedia.map((media, index) => ({ value: String(index), label: mediaLabel(media) })) }));
    const details = node('details', undefined, 'library-layout'); details.append(node('summary', 'Layout & buttons'));
    details.append(node('p', 'Use page default inherits the button label and destination from the assigned page. It does not hide the button.', 'muted'));
    const alignments = node('div', undefined, 'field-row');
    for (const [key, label] of [['desktopAlign', 'Desktop alignment'], ['mobileAlign', 'Mobile alignment']]) alignments.append(field(label, `library-${key}`, hero[key], { choices: ['left', 'center', 'right'] }));
    details.append(alignments, field('Overlay darkness (0 to 1)', 'library-overlayOpacity', hero.overlayOpacity, { number: true }));
    for (const [key, label] of [['primary', 'Primary'], ['secondary', 'Secondary']]) {
      details.append(field(`${label} button label`, `library-${key}-label`, hero[key]?.label || '', { maxLength: 80, optional: true }), field(`${label} button destination`, `library-${key}-href`, hero[key]?.href || '', { choices: destinationChoices(hero[key]?.href) }));
    }
    inputs.append(details);
    const picker = byId('library-revision-picker'); picker.replaceChildren();
    const revisions = libraryRevisions(detail);
    for (const revision of revisions) { const option = node('option', `${revision.revisionId}${revision.revisionId === detail.latest.revisionId ? ' · Latest' : ' · Saved'}`); option.value = revision.revisionId; picker.append(option); }
    picker.value = detail.latest.revisionId; state.libraryRevision = detail.latest;
    state.libraryDirty = false;
  }
  function readLibraryEditor() {
    const content = clone(state.libraryDetail.latest.content); const hero = content.hero;
    content.name = byId('library-name').value; content.category = byId('library-category-name').value;
    for (const key of ['headline', 'description', 'desktopAlign', 'mobileAlign']) hero[key] = byId(`library-${key}`).value;
    hero.overlayOpacity = Number(byId('library-overlayOpacity').value);
    hero.media = clone(state.libraryMedia[Number(byId('library-media').value)]);
    if (byId('library-artwork').value) hero.artworkAsset = byId('library-artwork').value; else delete hero.artworkAsset;
    for (const key of ['primary', 'secondary']) {
      const href = byId(`library-${key}-href`).value;
      if (href) hero[key] = { label: byId(`library-${key}-label`).value, href }; else delete hero[key];
    }
    return content;
  }
  async function loadLibraryHero(id) {
    const detail = await request(`/hero-library/${encodeURIComponent(id)}`);
    state.libraryDetail = detail;
    const entry = state.library.find(item => item.id === id);
    if (entry) { entry.content = clone(detail.latest.content); entry.revisionId = detail.latest.revisionId; }
    renderLibraryEditor(); renderLibraryCards();
    byId('library-status').textContent = 'Latest shared library revision loaded. Existing page assignments are unchanged.';
  }
  async function loadLibrary() {
    let result;
    try { result = await request('/hero-library'); }
    catch (error) {
      if (error.status !== 404) throw error;
      byId('library-unavailable').hidden = false; byId('library-workspace').hidden = true;
      byId('library-count').textContent = 'Not configured'; return;
    }
    state.library = result.heroes || []; state.libraryMedia = result.media || []; state.artwork = result.artwork || [];
    byId('library-workspace').hidden = !state.library.length; byId('library-unavailable').hidden = !!state.library.length;
    const category = byId('library-category'); const previous = category.value; category.replaceChildren();
    const all = node('option', 'All themes'); all.value = ''; category.append(all);
    for (const value of [...new Set(state.library.map(entry => entry.content.category))].sort()) { const option = node('option', value); option.value = value; category.append(option); }
    category.value = [...category.options].some(option => option.value === previous) ? previous : '';
    if (state.library.length) await loadLibraryHero(state.library.find(entry => entry.id === state.libraryDetail?.id)?.id || state.library[0].id);
    else renderLibraryCards();
    if (state.detail && !state.dirty) renderEditor(); else renderAssignments();
  }
  function mayDiscardLibrary() { return !state.libraryDirty || window.confirm('Discard the unsaved library changes and load the saved design?'); }
  function assignmentRevisions(picker, revisions, latestId) {
    picker.replaceChildren();
    for (const revision of revisions) { const option = node('option', `${revision.revisionId}${revision.revisionId === latestId ? ' · Latest' : ' · Saved'}`); option.value = revision.revisionId; picker.append(option); }
    picker.value = latestId;
  }
  function renderAssignments() {
    document.querySelectorAll('.hero-assignment').forEach(element => element.remove());
    if (!state.detail || state.detail.entity.kind !== 'page' || !state.library.length) return;
    const defaultEntry = state.library.find(entry => entry.id === state.libraryDetail?.id) || state.library[0];
    const defaultRevisions = state.libraryDetail?.id === defaultEntry.id ? libraryRevisions(state.libraryDetail) : [{ revisionId: defaultEntry.revisionId }];
    state.detail.latest.content.heroVariants.forEach((slot, index) => {
      const host = document.querySelector(`[data-hero-id="${CSS.escape(slot.id)}"]`); if (!host) return;
      const assignment = node('section', undefined, 'hero-assignment'); assignment.dataset.slotId = slot.id;
      assignment.append(node('h4', 'Assign from the shared library'));
      assignment.append(field(`Hero ${index + 1} library design`, `assignment-${index}-hero`, defaultEntry.id, { choices: state.library.map(entry => ({ value: entry.id, label: entry.content.name })) }));
      const revisionField = field(`Hero ${index + 1} library revision`, `assignment-${index}-revision`, defaultEntry.revisionId, { choices: defaultRevisions.map(revision => ({ value: revision.revisionId, label: `${revision.revisionId}${revision.revisionId === defaultEntry.revisionId ? ' · Latest saved' : ' · Saved'}` })) }); assignment.append(revisionField);
      const activeLabel = node('label', undefined, 'checkbox-label'); const active = node('input'); active.type = 'checkbox'; active.id = `assignment-${index}-active`; active.checked = slot.active; activeLabel.htmlFor = active.id; activeLabel.append(active, document.createTextNode('Make this slot active in the saved page')); assignment.append(activeLabel);
      const button = node('button', 'Save hero assignment', 'button secondary'); button.type = 'button'; button.dataset.assignHero = slot.id; assignment.append(button, node('p', '', 'assignment-note muted')); host.append(assignment);
      const picker = byId(`assignment-${index}-hero`); const revisionPicker = byId(`assignment-${index}-revision`);
      let previousHeroId = picker.value;
      picker.addEventListener('change', () => {
        const heroId = picker.value;
        task(async () => {
          try {
            const detail = await request(`/hero-library/${encodeURIComponent(heroId)}`);
            assignmentRevisions(revisionPicker, libraryRevisions(detail), detail.latest.revisionId);
            previousHeroId = heroId;
          } catch (error) { picker.value = previousHeroId; throw error; }
        });
      });
      button.addEventListener('click', () => {
        if (state.dirty || state.busy || state.recovering) return;
        const id = state.detail.entity.id;
        const payload = { baseRevisionId: state.detail.latest.revisionId, slotId: slot.id, heroId: picker.value, heroRevisionId: revisionPicker.value, active: active.checked };
        task(async () => {
          const result = await request(`/entities/page/${encodeURIComponent(id)}/hero-assignments`, { method: 'POST', body: JSON.stringify(payload) });
          state.pending = null;
          await loadEntities(entityKey(state.detail.entity), result.revisionId);
          message(`Hero assignment saved as page revision ${result.revisionId}. Review this saved page before publishing. The shared library has not changed.`);
        });
      });
    });
    updateControls();
  }
  let stopVisualPreview = () => {};
  function pageDefaultButtons(page, supplied) {
    // Match PublishedHomepageView, DivisionPage and ProductPage. The homepage
    // application link comes from the authenticated publication projection.
    if (page.path === '/') return { primary: supplied?.primary, secondary: supplied?.secondary || { label: 'Explore Loan Options', href: '#services' } };
    const divisionPrimary = {
      '/veterans': 'Explore My VA Loan Options',
      '/reverse': 'Talk to a Reverse Mortgage Specialist',
      '/investment': 'Discuss My Investment Plans',
      '/home-equity': 'Explore My Home Equity Options',
    };
    if (divisionPrimary[page.path]) return { primary: { label: divisionPrimary[page.path], href: '/loan-officers' }, secondary: { label: 'Explore the Options', href: '#options' } };
    if (page.path === '/buy') return { primary: { label: 'Start My Application', href: '/apply/buy' }, secondary: { label: 'Explore Loan Options', href: '#options' } };
    if (page.path === '/refinance') return { primary: { label: 'Start My Refinance Application', href: 'Refinance application entry — verification pending' }, secondary: { label: 'Explore Loan Options', href: '#options' } };
    return supplied || {};
  }
  function renderVisualHero() {
    stopVisualPreview();
    const stage = byId('hero-preview-stage'); stage.replaceChildren(); byId('hero-preview-action').textContent = '';
    const hero = state.previewHeroes[Number(byId('hero-preview-slot').value)];
    if (!hero) { stage.append(node('p', 'This saved revision has no hero slots.')); return; }
    stage.dataset.heroId = hero.id;
    stage.dataset.desktopAlign = hero.desktopAlign; stage.dataset.mobileAlign = hero.mobileAlign;
    const poster = node('picture', undefined, 'hero-preview-poster');
    if (hero.media.kind === 'image' && assetPath(hero.media.mobileAsset)) { const source = node('source'); source.media = '(max-width: 768px)'; source.srcset = assetPath(hero.media.mobileAsset); poster.append(source); }
    const image = node('img'); image.src = posterFor(hero); image.alt = ''; poster.append(image); stage.append(poster);
    const overlay = node('div', undefined, 'hero-preview-overlay'); overlay.style.opacity = String(Math.max(0, Math.min(1, hero.overlayOpacity))); stage.append(overlay);
    const content = node('div', undefined, 'hero-preview-content'); const artwork = artworkFor(hero);
    if (artwork) { const art = node('img', undefined, 'hero-preview-artwork'); art.src = artwork; art.alt = ''; content.append(art); }
    content.append(node('h3', hero.headline), node('p', hero.description));
    const actions = node('div', undefined, 'hero-preview-actions');
    let unknownDefault = false;
    for (const key of ['primary', 'secondary']) {
      const link = hero[key] || state.previewDefaults?.[key];
      const label = link?.label || `Page default ${key} button`;
      const button = node('button', label, `button ${key === 'secondary' ? 'secondary' : ''}${link ? '' : ' hero-preview-inherited'}`);
      button.type = 'button'; button.dataset.previewButton = key;
      if (!link) unknownDefault = true;
      button.addEventListener('click', () => { byId('hero-preview-action').textContent = link ? `Preview only. Planned destination: ${link.href}` : 'The assigned page supplies this button’s label and destination. Review the saved page after assignment to see the actual button.'; });
      actions.append(button);
    }
    byId('hero-preview-default-note').hidden = !unknownDefault;
    byId('hero-preview-default-note').textContent = state.previewDefaults ? 'This page’s default button could not be resolved in this review. The placeholder does not mean the button is hidden.' : 'Page-default buttons are placeholders in library-only previews. The assigned page determines their labels and destinations; review the saved page after assignment.';
    content.append(actions); stage.append(content);
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)'); const connection = navigator.connection;
    let video = null; let control = null; let userPaused = false; let disposed = false;
    const allowsMotion = () => !motion.matches && !connection?.saveData;
    function removeVideo() {
      if (video) { video.pause(); video.removeAttribute('src'); video.replaceChildren(); video.load(); video.remove(); video = null; }
      control?.remove(); control = null;
    }
    function playback() {
      if (!video) return;
      if (document.hidden || userPaused || !byId('hero-visual-preview').open) video.pause();
      else video.play().catch(() => { if (!disposed && control) control.textContent = 'Play background video'; });
    }
    function preference() {
      if (!allowsMotion()) { removeVideo(); return; }
      if (video || hero.media.kind !== 'video' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(hero.media.name)) return;
      const base = mediaUrl(`/heroes/${hero.media.name}`);
      video = node('video', undefined, 'hero-preview-video'); video.muted = true; video.loop = true; video.playsInline = true; video.poster = `${base}/poster.jpg`; video.preload = 'auto'; video.setAttribute('aria-hidden', 'true'); video.tabIndex = -1;
      for (const [file, type, media] of [['720p.mp4', 'video/mp4', '(max-width: 768px)'], ['1080p-av1.mp4', 'video/mp4; codecs="av01.0.08M.08"'], ['1080p.mp4', 'video/mp4']]) { const source = node('source'); source.src = `${base}/${file}`; source.type = type; if (media) source.media = media; video.append(source); }
      control = node('button', 'Play background video', 'hero-preview-pause'); control.type = 'button';
      control.addEventListener('click', () => { userPaused = !video.paused; playback(); });
      video.addEventListener('playing', () => { if (video) video.style.opacity = '1'; if (control) control.textContent = 'Pause background video'; });
      video.addEventListener('pause', () => { if (control) control.textContent = 'Play background video'; });
      video.addEventListener('error', event => { if (event.target === video) removeVideo(); });
      stage.insertBefore(video, overlay); stage.append(control); playback();
    }
    motion.addEventListener('change', preference); connection?.addEventListener?.('change', preference); document.addEventListener('visibilitychange', playback);
    preference();
    stopVisualPreview = () => { disposed = true; motion.removeEventListener('change', preference); connection?.removeEventListener?.('change', preference); document.removeEventListener('visibilitychange', playback); removeVideo(); };
  }
  function openVisualPreview(title, revisionId, heroes, defaults = null) {
    byId('hero-preview-sections').replaceChildren();
    const visual = byId('hero-visual-preview'); state.previewHeroes = clone(heroes);
    state.previewDefaults = defaults;
    byId('hero-preview-title').textContent = title; byId('hero-preview-note').textContent = `Exact saved revision: ${revisionId}. Unsaved editor changes are not included.`;
    const picker = byId('hero-preview-slot'); picker.replaceChildren();
    heroes.forEach((hero, index) => { const option = node('option', `Hero ${index + 1} · ${hero.active ? 'Active' : 'Inactive'} · ${hero.headline}`); option.value = String(index); picker.append(option); });
    byId('hero-preview-slot-field').hidden = heroes.length < 2;
    visual.showModal(); renderVisualHero();
  }

  function markPageDirty(event) { if (event.target.closest('.hero-assignment')) return; state.dirty = true; updateControls(); }
  form.addEventListener('input', markPageDirty);
  form.addEventListener('change', markPageDirty);
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const content = readEditor(); const id = state.detail.entity.id; const baseRevisionId = state.detail.latest.revisionId;
    task(async () => {
      const result = await request(`/entities/${state.detail.entity.kind}/${encodeURIComponent(id)}/revisions`, { method: 'POST', body: JSON.stringify({ baseRevisionId, content }) });
      state.dirty = false; state.pending = null;
      message(`Draft saved as ${result.revisionId}. The published website has not changed.`);
      await loadEntities(entityKey(state.detail.entity), result.revisionId);
    });
  });
  byId('page-picker').addEventListener('change', event => {
    if (!mayDiscard()) { event.target.value = state.detail ? entityKey(state.detail.entity) : ''; return; }
    const entity = state.entities.find(item => entityKey(item) === event.target.value);
    if (!entity) return;
    task(async () => { await loadPage(entity); state.pending = null; message('Saved version loaded. Changes remain private until publication.'); });
  });
  byId('load-website-copy').addEventListener('click', () => {
    if (!state.detail?.hasContentImport || !mayDiscard()) return;
    const entity = state.detail.entity; const baseRevisionId = state.detail.latest.revisionId;
    task(async () => {
      const result = await request(`/entities/page/${encodeURIComponent(entity.id)}/content-imports`, { method: 'POST', body: JSON.stringify({ baseRevisionId }) });
      state.dirty = false; state.pending = null;
      await loadEntities(entityKey(entity), result.revisionId);
      message('Reviewed website copy loaded into a new saved draft. Hero selections and the published website are unchanged.');
    });
  });
  byId('refresh').addEventListener('click', () => {
    if (!mayDiscard() || !mayDiscardLibrary()) return;
    task(async () => { await loadEntities(state.detail ? entityKey(state.detail.entity) : undefined, state.selected?.revisionId); await loadLibrary(); message('Revision list refreshed. Published content and saved drafts are shown separately.'); });
  });
  byId('revision-picker').addEventListener('change', event => {
    state.selected = [...state.detail.revisions, ...(state.detail.published ? [state.detail.published] : [])].find(revision => revision.revisionId === event.target.value);
    state.pending = null; renderRevision(byId('revision-preview'), state.selected); updateControls();
  });
  byId('review-publish').addEventListener('click', () => {
    if (!state.selected || !state.publication || state.busy) return;
    // Preserve this request after ambiguous failures, so a retry can reconcile.
    if (!state.pending) state.pending = { requestId: `publish-${crypto.randomUUID()}`, basePublicationId: state.publication.publicationId, selections: [{ kind: state.detail.entity.kind, id: state.detail.entity.id, revisionId: state.selected.revisionId, action: 'replace' }] };
    renderRevision(byId('confirmation-summary'), state.selected); updateControls(); dialog.showModal();
  });
  byId('cancel-publish').addEventListener('click', () => dialog.close());
  dialog.addEventListener('cancel', event => { if (state.busy) event.preventDefault(); });
  byId('confirm-publish').addEventListener('click', () => {
    if (!state.pending) return;
    const pending = clone(state.pending);
    task(async () => {
      let result;
      try { result = await request('/publications', { method: 'POST', body: JSON.stringify(pending) }); }
      catch (error) {
        // A definite conflict needs a newly reviewed base after refresh. Only
        // ambiguous transport/server outcomes reuse the original request ID.
        if ([400, 403, 404, 409, 422].includes(error.status)) { state.pending = null; state.recovering = false; }
        else state.recovering = true;
        dialog.close();
        throw error;
      }
      state.pending = null; state.recovering = false; dialog.close();
      state.publication = result; renderPublication();
      message(`Published ${result.publicationId}; website adoption pending. Other saved drafts remain private.`);
      byId('adoption-status').textContent = 'Published; website adoption pending. Open the homepage to check its next content refresh.';
      // Refresh the publication/revision panel without replacing unsaved edits.
      const detail = await request(`/entities/${state.detail.entity.kind}/${encodeURIComponent(state.detail.entity.id)}`);
      const oldLatest = state.detail.latest;
      state.detail = { ...detail, latest: oldLatest };
      renderRevisions(pending.selections[0].revisionId);
      await refreshEntitySummaries();
    });
  });
  try {
    const configuredUrl = window.WEBSITE_CMS_PREVIEW_URL || websiteOrigin()?.href;
    if (!configuredUrl) throw new Error('No published homepage URL configured');
    const destination = new URL(configuredUrl);
    if (['http:', 'https:'].includes(destination.protocol)) { byId('open-homepage').href = destination.href; byId('open-homepage').hidden = false; }
  } catch { /* Keep the link hidden until an explicit destination is configured. */ }
  const libraryForm = byId('library-form');
  function markLibraryDirty() {
    state.libraryDirty = true;
    for (const key of ['primary', 'secondary']) byId(`library-${key}-label`)?.setCustomValidity('');
    byId('library-status').textContent = 'Unsaved library changes. Save a library revision before assigning these edits to a page.';
    updateControls();
  }
  libraryForm.addEventListener('input', markLibraryDirty);
  libraryForm.addEventListener('change', markLibraryDirty);
  libraryForm.addEventListener('submit', event => {
    event.preventDefault();
    if (!state.libraryDetail || state.busy || state.recovering) return;
    for (const key of ['primary', 'secondary']) {
      const label = byId(`library-${key}-label`);
      label.setCustomValidity(byId(`library-${key}-href`).value && !label.value.trim() ? 'Enter a label for this button, or choose Use page default.' : '');
      label.addEventListener('input', () => label.setCustomValidity(''), { once: true });
    }
    if (!libraryForm.reportValidity()) return;
    const id = state.libraryDetail.id; const baseRevisionId = state.libraryDetail.latest.revisionId;
    const content = readLibraryEditor();
    task(async () => {
      const result = await request(`/hero-library/${encodeURIComponent(id)}/revisions`, { method: 'POST', body: JSON.stringify({ baseRevisionId, content }) });
      state.libraryDirty = false;
      await loadLibrary();
      byId('library-status').textContent = `Library revision ${result.revisionId} saved on the server. Existing page assignments and the published website are unchanged.`;
      message('Shared hero saved. Assign its saved revision to a page separately.');
    });
  });
  byId('reload-library-hero').addEventListener('click', () => {
    if (!state.libraryDetail || !mayDiscardLibrary()) return;
    task(() => loadLibraryHero(state.libraryDetail.id));
  });
  byId('library-search').addEventListener('input', renderLibraryCards);
  byId('library-category').addEventListener('change', renderLibraryCards);
  byId('library-revision-picker').addEventListener('change', event => {
    state.libraryRevision = libraryRevisions(state.libraryDetail).find(revision => revision.revisionId === event.target.value);
  });
  byId('preview-library-hero').addEventListener('click', () => {
    const revision = state.libraryRevision;
    if (revision) openVisualPreview(revision.content.name, revision.revisionId, [revision.content.hero]);
  });
  byId('preview-page-revision').addEventListener('click', () => {
    if (!state.selected) return;
    const kind = state.detail.entity.kind;
    if (kind === 'page' && state.selected.content.heroVariants.length) {
      openVisualPreview(state.selected.content.title, state.selected.revisionId, state.selected.content.heroVariants, pageDefaultButtons(state.selected.content, state.detail.previewDefaults));
      window.WebsiteContentFields.preview(byId('hero-preview-sections'), kind, state.selected.content);
    } else {
      byId('content-preview-title').textContent = contentTitle(state.selected.content, kind);
      byId('content-preview-note').textContent = `Exact saved revision: ${state.selected.revisionId}. Unsaved changes are not included.`;
      byId('content-preview-body').replaceChildren();
      window.WebsiteContentFields.preview(byId('content-preview-body'), kind, state.selected.content);
      byId('content-visual-preview').showModal();
    }
  });
  byId('hero-preview-slot').addEventListener('change', renderVisualHero);
  byId('hero-visual-preview').addEventListener('close', () => { stopVisualPreview(); byId('hero-preview-stage').replaceChildren(); state.previewHeroes = []; state.previewDefaults = null; });
  window.addEventListener('beforeunload', event => { if (state.dirty || state.libraryDirty) { event.preventDefault(); event.returnValue = ''; } });
  task(async () => { await loadEntities(); await loadLibrary(); message('Ready to edit. Saved drafts stay private until you publish a selected version.'); });
})();
