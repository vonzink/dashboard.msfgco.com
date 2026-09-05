(function initializeWebinarStudioState(root, factory) {
  'use strict';

  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.WebinarStudioState = api;
}(typeof window !== 'undefined' ? window : null, function createWebinarStudioStateApi() {
  'use strict';

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const MASTER_FIELDS = new Set(['html', 'css']);
  const SLIDE_STRING_FIELDS = new Set([
    'title',
    'anchor',
    'speakerNotes',
    'html',
    'css',
    'javascript',
  ]);
  const SLIDE_FIELDS = new Set([...SLIDE_STRING_FIELDS, 'targetSeconds']);
  const MAX_CONFLICT_TIMESTAMP_LENGTH = 64;
  const MAX_CONFLICT_UPDATER_NAME_LENGTH = 255;

  function invariant(condition, message) {
    if (!condition) throw new TypeError(message);
  }

  function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function assertString(value, label) {
    invariant(typeof value === 'string', `${label} must be a string`);
  }

  function assertPositiveInteger(value, label) {
    invariant(Number.isSafeInteger(value) && value > 0, `${label} must be a positive integer`);
  }

  function assertLiveVersion(value, label = 'liveVersion') {
    invariant(Number.isSafeInteger(value) && value > 0, `${label} must be a positive integer`);
  }

  function assertServerSlideId(value) {
    invariant(typeof value === 'string' && UUID.test(value), 'A valid server-issued slide id is required');
  }

  function assertTargetSeconds(value) {
    invariant(
      Number.isSafeInteger(value) && value >= 0 && value <= 7200,
      'targetSeconds must be an integer from 0 through 7200',
    );
  }

  function assertSlideFields(slide) {
    invariant(isPlainObject(slide), 'A complete server slide is required');
    assertServerSlideId(slide.id);
    for (const field of SLIDE_STRING_FIELDS) assertString(slide[field], `Slide ${field}`);
    assertTargetSeconds(slide.targetSeconds);
  }

  function normalizeDirtyFields(fields, allowlist, label) {
    invariant(Array.isArray(fields), `${label} dirtyFields must be an array`);
    const unique = new Set(fields);
    invariant(unique.size === fields.length, `${label} dirtyFields must be unique`);
    invariant(fields.every(field => allowlist.has(field)), `${label} has an invalid dirty field`);
    return fields;
  }

  function assertStudioState(state) {
    invariant(isPlainObject(state), 'Studio state is required');
    invariant(isPlainObject(state.webinar), 'Studio webinar state is required');
    assertPositiveInteger(state.webinar.id, 'Webinar id');
    assertString(state.webinar.slug, 'Webinar slug');
    assertString(state.webinar.title, 'Webinar title');
    assertPositiveInteger(state.webinar.primaryOwnerUserId, 'Primary owner user id');
    invariant(typeof state.webinar.audienceEnabled === 'boolean', 'audienceEnabled must be boolean');
    assertLiveVersion(state.liveVersion);
    invariant(isPlainObject(state.master), 'Master state is required');
    assertString(state.master.html, 'Master html');
    assertString(state.master.css, 'Master css');
    normalizeDirtyFields(state.master.dirtyFields, MASTER_FIELDS, 'Master');
    invariant(Array.isArray(state.slideOrder) && state.slideOrder.length > 0, 'Studio must retain at least one active slide');
    invariant(isPlainObject(state.slidesById), 'slidesById must be an object');

    const orderedIds = new Set();
    for (const id of state.slideOrder) {
      assertServerSlideId(id);
      invariant(!orderedIds.has(id), 'Slide order ids must be unique');
      orderedIds.add(id);
      const slide = state.slidesById[id];
      invariant(slide !== undefined, 'Slide order must reference every active slide');
      assertSlideFields(slide);
      invariant(slide.id === id, 'Slide map key must match its stable slide id');
      normalizeDirtyFields(slide.dirtyFields, SLIDE_FIELDS, `Slide ${id}`);
    }

    const mappedIds = Object.keys(state.slidesById);
    invariant(mappedIds.length === orderedIds.size, 'Slide order must include every active slide');
    invariant(mappedIds.every(id => orderedIds.has(id)), 'Slide map contains an unordered active slide');
    invariant(orderedIds.has(state.selectedSlideId), 'Selected slide must be active');
    invariant(state.conflict === null || isPlainObject(state.conflict), 'Conflict state must be null or normalized metadata');
    return state;
  }

  function normalizeSlide(slide) {
    assertSlideFields(slide);
    return {
      id: slide.id,
      title: slide.title,
      anchor: slide.anchor,
      targetSeconds: slide.targetSeconds,
      speakerNotes: slide.speakerNotes,
      html: slide.html,
      css: slide.css,
      javascript: slide.javascript,
      dirtyFields: [],
    };
  }

  function createStudioState(document) {
    invariant(isPlainObject(document), 'A private webinar document is required');
    assertPositiveInteger(document.id, 'Webinar id');
    assertString(document.slug, 'Webinar slug');
    assertString(document.title, 'Webinar title');
    assertPositiveInteger(document.primaryOwnerUserId, 'Primary owner user id');
    invariant(typeof document.audienceEnabled === 'boolean', 'audienceEnabled must be boolean');
    assertLiveVersion(document.liveVersion);
    assertString(document.masterHtml, 'Master html');
    assertString(document.masterCss, 'Master css');
    invariant(Array.isArray(document.slides) && document.slides.length > 0, 'A webinar must contain at least one slide');

    const slidesById = {};
    const slideOrder = [];
    for (const serverSlide of document.slides) {
      const slide = normalizeSlide(serverSlide);
      invariant(!Object.prototype.hasOwnProperty.call(slidesById, slide.id), 'Slide ids must be unique');
      slidesById[slide.id] = slide;
      slideOrder.push(slide.id);
    }

    return assertStudioState({
      webinar: {
        id: document.id,
        slug: document.slug,
        title: document.title,
        primaryOwnerUserId: document.primaryOwnerUserId,
        audienceEnabled: document.audienceEnabled,
      },
      liveVersion: document.liveVersion,
      master: {
        html: document.masterHtml,
        css: document.masterCss,
        dirtyFields: [],
      },
      slideOrder,
      slidesById,
      selectedSlideId: slideOrder[0],
      conflict: null,
    });
  }

  function addDirtyField(fields, field) {
    return fields.includes(field) ? fields : [...fields, field];
  }

  function updateMaster(state, field, value) {
    assertStudioState(state);
    invariant(MASTER_FIELDS.has(field), 'Unknown Master field');
    assertString(value, `Master ${field}`);
    if (state.master[field] === value) return state;
    return {
      ...state,
      master: {
        ...state.master,
        [field]: value,
        dirtyFields: addDirtyField(state.master.dirtyFields, field),
      },
    };
  }

  function updateSlide(state, id, field, value) {
    assertStudioState(state);
    invariant(Object.prototype.hasOwnProperty.call(state.slidesById, id), 'Active slide not found');
    invariant(SLIDE_FIELDS.has(field), 'Unknown slide field');
    if (field === 'targetSeconds') assertTargetSeconds(value);
    else assertString(value, `Slide ${field}`);

    const current = state.slidesById[id];
    if (current[field] === value) return state;
    const updated = {
      ...current,
      [field]: value,
      dirtyFields: addDirtyField(current.dirtyFields, field),
    };
    return {
      ...state,
      slidesById: { ...state.slidesById, [id]: updated },
    };
  }

  function nextVersion(state, response) {
    invariant(isPlainObject(response), 'A successful server response is required');
    assertLiveVersion(response.liveVersion, 'Response liveVersion');
    invariant(response.liveVersion === state.liveVersion + 1, 'Response liveVersion must advance exactly once');
    assertString(response.updatedAt, 'Response updatedAt');
    invariant(
      response.updatedAt.length > 0 && response.updatedAt.length <= MAX_CONFLICT_TIMESTAMP_LENGTH,
      'Response updatedAt is invalid',
    );
    return response.liveVersion;
  }

  function appendServerSlide(state, serverSlide, response) {
    assertStudioState(state);
    const slide = normalizeSlide(serverSlide);
    invariant(!Object.prototype.hasOwnProperty.call(state.slidesById, slide.id), 'Server slide id is already active');
    const liveVersion = nextVersion(state, response);
    return assertStudioState({
      ...state,
      liveVersion,
      slideOrder: [...state.slideOrder, slide.id],
      slidesById: { ...state.slidesById, [slide.id]: slide },
      selectedSlideId: slide.id,
      conflict: null,
    });
  }

  function removeServerSlide(state, id, response) {
    assertStudioState(state);
    invariant(Object.prototype.hasOwnProperty.call(state.slidesById, id), 'Active slide not found');
    invariant(state.slideOrder.length > 1, 'Studio must retain at least one active slide');
    const liveVersion = nextVersion(state, response);
    const slideOrder = state.slideOrder.filter(slideId => slideId !== id);
    const slidesById = { ...state.slidesById };
    delete slidesById[id];
    return assertStudioState({
      ...state,
      liveVersion,
      slideOrder,
      slidesById,
      selectedSlideId: state.selectedSlideId === id ? slideOrder[0] : state.selectedSlideId,
      conflict: null,
    });
  }

  function applyOrder(state, ids, response) {
    assertStudioState(state);
    invariant(Array.isArray(ids), 'Slide order must be an array');
    invariant(new Set(ids).size === ids.length, 'Slide order ids must be unique');
    invariant(ids.length === state.slideOrder.length, 'Slide order must include every active slide');
    invariant(
      ids.every(id => Object.prototype.hasOwnProperty.call(state.slidesById, id)),
      'Slide order contains a non-active slide',
    );
    const liveVersion = nextVersion(state, response);
    return assertStudioState({
      ...state,
      liveVersion,
      slideOrder: [...ids],
      conflict: null,
    });
  }

  function markSurfaceSaved(state, surface, response) {
    assertStudioState(state);
    const liveVersion = nextVersion(state, response);
    if (surface === 'master') {
      return {
        ...state,
        liveVersion,
        master: { ...state.master, dirtyFields: [] },
        conflict: null,
      };
    }
    invariant(
      typeof surface === 'string' && Object.prototype.hasOwnProperty.call(state.slidesById, surface),
      'Unknown saved surface',
    );
    return {
      ...state,
      liveVersion,
      slidesById: {
        ...state.slidesById,
        [surface]: { ...state.slidesById[surface], dirtyFields: [] },
      },
      conflict: null,
    };
  }

  function applyConflict(state, error) {
    assertStudioState(state);
    invariant(isPlainObject(error), 'Conflict metadata is required');
    assertLiveVersion(error.currentVersion, 'Conflict currentVersion');
    invariant(error.currentVersion > state.liveVersion, 'Conflict currentVersion must be newer than local state');
    assertString(error.updatedAt, 'Conflict updatedAt');
    invariant(error.updatedAt.length > 0, 'Conflict updatedAt is required');
    invariant(isPlainObject(error.updatedBy), 'Conflict updater is required');
    assertPositiveInteger(error.updatedBy.id, 'Conflict updater id');
    invariant(
      error.updatedBy.name === null || typeof error.updatedBy.name === 'string',
      'Conflict updater name must be a string or null',
    );

    return {
      ...state,
      conflict: {
        currentVersion: error.currentVersion,
        updatedAt: error.updatedAt.slice(0, MAX_CONFLICT_TIMESTAMP_LENGTH),
        updatedBy: {
          id: error.updatedBy.id,
          name: error.updatedBy.name === null
            ? null
            : error.updatedBy.name.slice(0, MAX_CONFLICT_UPDATER_NAME_LENGTH),
        },
      },
    };
  }

  function hasUnsavedChanges(state) {
    assertStudioState(state);
    return state.master.dirtyFields.length > 0
      || state.slideOrder.some(id => state.slidesById[id].dirtyFields.length > 0);
  }

  function canNavigateAway(state) {
    return !hasUnsavedChanges(state);
  }

  return Object.freeze({
    createStudioState,
    updateMaster,
    updateSlide,
    appendServerSlide,
    removeServerSlide,
    applyOrder,
    markSurfaceSaved,
    applyConflict,
    hasUnsavedChanges,
    canNavigateAway,
  });
}));
