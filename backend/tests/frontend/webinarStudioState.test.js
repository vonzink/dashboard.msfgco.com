import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const stateModulePath = resolve(process.cwd(), '../js/webinar-studio/state.js');

const firstSlideId = '11111111-1111-4111-8111-111111111111';
const secondSlideId = '22222222-2222-4222-8222-222222222222';

function privateDocument(overrides = {}) {
  return {
    id: 14,
    slug: 'homebuyer-basics',
    title: 'Homebuyer Basics',
    primaryOwnerUserId: 7,
    audienceEnabled: false,
    liveVersion: 7,
    masterHtml: '<main>{{SLIDE_CONTENT}}</main>',
    masterCss: 'main { color: navy; }',
    resourcePolicy: { assetOrigin: 'https://assets.example.test' },
    notes: [{ id: 1, body: 'must not leak' }],
    settings: { shortcut: 'ArrowRight' },
    slides: [
      {
        id: firstSlideId,
        title: 'Opening',
        anchor: 'opening',
        targetSeconds: 60,
        speakerNotes: 'Welcome everyone.',
        html: '<section>Opening</section>',
        css: '.opening { color: blue; }',
        javascript: 'window.openingReady = true;',
        presignedUrl: 'https://private.example.test/upload',
        storageKey: 'private/object-key',
      },
      {
        id: secondSlideId,
        title: 'Agenda',
        anchor: 'agenda',
        targetSeconds: 90,
        speakerNotes: '',
        html: '<section>Agenda</section>',
        css: '',
        javascript: '',
      },
    ],
    ...overrides,
  };
}

function success(liveVersion) {
  return { liveVersion, updatedAt: `2026-09-03T12:0${liveVersion - 7}:00.000Z` };
}

let stateApi;

beforeEach(() => {
  delete require.cache[stateModulePath];
  stateApi = require(stateModulePath);
});
describe('Webinar Studio normalized state', () => {
  it('normalizes only editable webinar fields and preserves server slide order', () => {
    const state = stateApi.createStudioState(privateDocument());

    expect(state).toEqual({
      webinar: {
        id: 14,
        slug: 'homebuyer-basics',
        title: 'Homebuyer Basics',
        primaryOwnerUserId: 7,
        audienceEnabled: false,
      },
      liveVersion: 7,
      master: {
        html: '<main>{{SLIDE_CONTENT}}</main>',
        css: 'main { color: navy; }',
        dirtyFields: [],
      },
      slideOrder: [firstSlideId, secondSlideId],
      slidesById: {
        [firstSlideId]: {
          id: firstSlideId,
          title: 'Opening',
          anchor: 'opening',
          targetSeconds: 60,
          speakerNotes: 'Welcome everyone.',
          html: '<section>Opening</section>',
          css: '.opening { color: blue; }',
          javascript: 'window.openingReady = true;',
          dirtyFields: [],
        },
        [secondSlideId]: {
          id: secondSlideId,
          title: 'Agenda',
          anchor: 'agenda',
          targetSeconds: 90,
          speakerNotes: '',
          html: '<section>Agenda</section>',
          css: '',
          javascript: '',
          dirtyFields: [],
        },
      },
      selectedSlideId: firstSlideId,
      conflict: null,
    });
    expect(JSON.stringify(state)).not.toMatch(/must not leak|private\.example|object-key|shortcut|assetOrigin/);
  });

  it('updates Master immutably and tracks each changed field once in edit order', () => {
    const state = stateApi.createStudioState(privateDocument());
    const htmlEdited = stateApi.updateMaster(state, 'html', '<main>Changed {{SLIDE_CONTENT}}</main>');
    const bothEdited = stateApi.updateMaster(htmlEdited, 'css', 'main { color: green; }');
    const sameValue = stateApi.updateMaster(bothEdited, 'html', bothEdited.master.html);

    expect(state.master).toEqual({
      html: '<main>{{SLIDE_CONTENT}}</main>',
      css: 'main { color: navy; }',
      dirtyFields: [],
    });
    expect(bothEdited.master.dirtyFields).toEqual(['html', 'css']);
    expect(sameValue).toBe(bothEdited);
    expect(bothEdited.slidesById).toBe(state.slidesById);
  });

  it('updates one slide immutably without changing its stable identity or order', () => {
    const state = stateApi.createStudioState(privateDocument());
    const htmlEdited = stateApi.updateSlide(state, firstSlideId, 'html', '<h1>Changed</h1>');
    const titleEdited = stateApi.updateSlide(htmlEdited, firstSlideId, 'title', 'A confident start');

    expect(state.slidesById[firstSlideId].html).toBe('<section>Opening</section>');
    expect(titleEdited.slidesById[firstSlideId]).toMatchObject({
      id: firstSlideId,
      title: 'A confident start',
      html: '<h1>Changed</h1>',
      dirtyFields: ['html', 'title'],
    });
    expect(titleEdited.slideOrder).toEqual([firstSlideId, secondSlideId]);
    expect(titleEdited.slidesById[secondSlideId]).toBe(state.slidesById[secondSlideId]);
    expect(titleEdited.liveVersion).toBe(7);
  });

  it('clears only the successfully saved surface and advances the live version', () => {
    const initial = stateApi.createStudioState(privateDocument());
    const masterEdited = stateApi.updateMaster(initial, 'css', 'main { color: green; }');
    const bothEdited = stateApi.updateSlide(masterEdited, firstSlideId, 'html', '<h1>Changed</h1>');
    const slideSaved = stateApi.markSurfaceSaved(bothEdited, firstSlideId, success(8));

    expect(slideSaved.liveVersion).toBe(8);
    expect(slideSaved.slidesById[firstSlideId].dirtyFields).toEqual([]);
    expect(slideSaved.master.dirtyFields).toEqual(['css']);
    expect(stateApi.hasUnsavedChanges(slideSaved)).toBe(true);

    const masterSaved = stateApi.markSurfaceSaved(slideSaved, 'master', success(9));
    expect(masterSaved.master.dirtyFields).toEqual([]);
    expect(masterSaved.slidesById[firstSlideId].dirtyFields).toEqual([]);
    expect(stateApi.hasUnsavedChanges(masterSaved)).toBe(false);
    expect(stateApi.canNavigateAway(masterSaved)).toBe(true);
  });

  it('retains every unsaved value on conflict and keeps only bounded conflict metadata', () => {
    const initial = stateApi.createStudioState(privateDocument());
    const edited = stateApi.updateSlide(
      stateApi.updateMaster(initial, 'css', 'main { color: lime; }'),
      firstSlideId,
      'html',
      '<h1>Changed</h1>',
    );
    const conflicted = stateApi.applyConflict(edited, {
      code: 'VERSION_CONFLICT',
      message: '<script>raw response</script>',
      currentVersion: 8,
      updatedAt: '2026-09-03T12:00:00Z',
      updatedBy: {
        id: 8,
        name: 'Another Editor',
        email: 'private@example.test',
        token: 'secret',
      },
      responseBody: { html: '<main>remote</main>' },
    });

    expect(conflicted.conflict).toEqual({
      currentVersion: 8,
      updatedAt: '2026-09-03T12:00:00Z',
      updatedBy: { id: 8, name: 'Another Editor' },
    });
    expect(conflicted.liveVersion).toBe(7);
    expect(conflicted.master.css).toBe('main { color: lime; }');
    expect(conflicted.slidesById[firstSlideId].html).toBe('<h1>Changed</h1>');
    expect(JSON.stringify(conflicted.conflict)).not.toMatch(/private@example|secret|script|remote/);
  });

  it('waits for a complete server-issued slide before appending or duplicating', () => {
    const state = stateApi.createStudioState(privateDocument());
    const serverSlideId = '33333333-3333-4333-8333-333333333333';
    const serverSlide = {
      id: serverSlideId,
      title: 'Agenda copy',
      anchor: 'agenda-copy',
      targetSeconds: 90,
      speakerNotes: '',
      html: '<section>Agenda</section>',
      css: '',
      javascript: '',
    };

    expect(() => stateApi.appendServerSlide(state, { ...serverSlide, id: undefined }, success(8))).toThrow(/server-issued slide id/i);
    expect(() => stateApi.appendServerSlide(state, { ...serverSlide, id: 'temporary-1' }, success(8))).toThrow(/server-issued slide id/i);
    expect(state.slideOrder).toEqual([firstSlideId, secondSlideId]);

    const appended = stateApi.appendServerSlide(state, serverSlide, success(8));
    expect(appended.slideOrder).toEqual([firstSlideId, secondSlideId, serverSlideId]);
    expect(appended.slidesById[serverSlideId]).toEqual({ ...serverSlide, dirtyFields: [] });
    expect(appended.selectedSlideId).toBe(serverSlideId);
    expect(appended.liveVersion).toBe(8);
  });

  it('applies server-confirmed removal and exact order without disturbing other dirty surfaces', () => {
    const dirty = stateApi.updateSlide(
      stateApi.createStudioState(privateDocument()),
      firstSlideId,
      'speakerNotes',
      'Unsaved local note',
    );
    const reordered = stateApi.applyOrder(dirty, [secondSlideId, firstSlideId], success(8));

    expect(reordered.slideOrder).toEqual([secondSlideId, firstSlideId]);
    expect(reordered.slidesById[firstSlideId].speakerNotes).toBe('Unsaved local note');
    expect(reordered.slidesById[firstSlideId].dirtyFields).toEqual(['speakerNotes']);

    const removed = stateApi.removeServerSlide(reordered, firstSlideId, success(9));
    expect(removed.slideOrder).toEqual([secondSlideId]);
    expect(removed.slidesById).not.toHaveProperty(firstSlideId);
    expect(removed.selectedSlideId).toBe(secondSlideId);
    expect(removed.liveVersion).toBe(9);
  });

  it.each([
    ['missing slide id', privateDocument({ slides: [{ ...privateDocument().slides[0], id: undefined }] })],
    ['invalid slide id', privateDocument({ slides: [{ ...privateDocument().slides[0], id: 'client-temp-id' }] })],
    ['duplicate slide ids', privateDocument({ slides: [privateDocument().slides[0], { ...privateDocument().slides[1], id: firstSlideId }] })],
    ['empty slide set', privateDocument({ slides: [] })],
  ])('rejects a %s without constructing partial state', (_label, document) => {
    expect(() => stateApi.createStudioState(document)).toThrow();
  });

  it('rejects invalid edits, missing surfaces, and broken order sets without mutating prior state', () => {
    const state = stateApi.updateMaster(
      stateApi.createStudioState(privateDocument()),
      'html',
      '<main>Unsaved {{SLIDE_CONTENT}}</main>',
    );
    const before = JSON.stringify(state);

    expect(() => stateApi.updateMaster(state, 'javascript', 'bad()')).toThrow(/Master field/i);
    expect(() => stateApi.updateSlide(state, '44444444-4444-4444-8444-444444444444', 'html', '')).toThrow(/slide/i);
    expect(() => stateApi.updateSlide(state, firstSlideId, 'targetSeconds', '90')).toThrow(/targetSeconds/i);
    expect(() => stateApi.markSurfaceSaved(state, 'unknown-surface', success(8))).toThrow(/surface/i);
    expect(() => stateApi.applyOrder(state, [firstSlideId], success(8))).toThrow(/every active slide/i);
    expect(() => stateApi.applyOrder(state, [firstSlideId, firstSlideId], success(8))).toThrow(/unique/i);
    expect(() => stateApi.applyOrder(state, [firstSlideId, '44444444-4444-4444-8444-444444444444'], success(8))).toThrow(/active slide/i);
    expect(() => stateApi.removeServerSlide(state, '44444444-4444-4444-8444-444444444444', success(8))).toThrow(/slide/i);
    expect(() => stateApi.removeServerSlide(state, firstSlideId, success(8))).not.toThrow();
    expect(JSON.stringify(state)).toBe(before);
  });

  it('requires explicit caller confirmation before replacing a dirty state with a reload', () => {
    const dirty = stateApi.updateSlide(
      stateApi.createStudioState(privateDocument()),
      firstSlideId,
      'html',
      '<h1>Keep me until confirmed</h1>',
    );

    expect(stateApi.hasUnsavedChanges(dirty)).toBe(true);
    expect(stateApi.canNavigateAway(dirty)).toBe(false);
    expect(dirty.slidesById[firstSlideId].html).toBe('<h1>Keep me until confirmed</h1>');

    // The caller may construct replacement state only after it has received confirmation.
    const confirmedReplacement = stateApi.createStudioState(privateDocument({
      liveVersion: 8,
      slides: [{ ...privateDocument().slides[0], html: '<h1>Server restored</h1>' }],
    }));
    expect(confirmedReplacement.liveVersion).toBe(8);
    expect(confirmedReplacement.slidesById[firstSlideId].html).toBe('<h1>Server restored</h1>');
    expect(dirty.slidesById[firstSlideId].html).toBe('<h1>Keep me until confirmed</h1>');
  });
});
