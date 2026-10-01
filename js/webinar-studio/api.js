(function initializeWebinarStudioApi(root) {
  'use strict';

  const serverApi = root.ServerAPI;
  if (!serverApi) throw new Error('ServerAPI is required before WebinarStudioAPI');

  function encodeIdentifier(value) {
    if ((typeof value !== 'string' && typeof value !== 'number') || String(value).length === 0) {
      throw new TypeError('A webinar API identifier is required');
    }
    return encodeURIComponent(String(value));
  }

  function assetCatalogPath(filters = {}) {
    const query = new URLSearchParams();
    for (const field of ['search', 'mediaType', 'status']) {
      if (filters[field] !== undefined && filters[field] !== null && filters[field] !== '') {
        query.set(field, String(filters[field]));
      }
    }
    const encoded = query.toString();
    return encoded ? `/webinar-assets?${encoded}` : '/webinar-assets';
  }

  const WebinarStudioAPI = Object.freeze({
    listWebinars: () => serverApi.get('/webinars'),
    getWebinar: id => serverApi.get(`/webinars/${encodeIdentifier(id)}`),
    createWebinar: body => serverApi.post('/webinars', body),
    archiveWebinar: id => serverApi.delete(`/webinars/${encodeIdentifier(id)}`),
    saveMaster: (id, body) => serverApi.put(`/webinars/${encodeIdentifier(id)}/master`, body),
    addSlide: (id, body) => serverApi.post(`/webinars/${encodeIdentifier(id)}/slides`, body),
    saveSlide: (id, slideId, body) => serverApi.put(
      `/webinars/${encodeIdentifier(id)}/slides/${encodeIdentifier(slideId)}`,
      body,
    ),
    reorderSlides: (id, body) => serverApi.put(`/webinars/${encodeIdentifier(id)}/slides/order`, body),
    archiveSlide: (id, slideId, body) => serverApi.delete(
      `/webinars/${encodeIdentifier(id)}/slides/${encodeIdentifier(slideId)}`,
      body,
    ),
    getHistory: id => serverApi.get(`/webinars/${encodeIdentifier(id)}/history`),
    restoreRevision: (id, revisionId, body) => serverApi.post(
      `/webinars/${encodeIdentifier(id)}/history/${encodeIdentifier(revisionId)}/restore`,
      body,
    ),
    changeOwner: (id, body) => serverApi.put(`/webinars/${encodeIdentifier(id)}/owner`, body),
    changeAudienceAccess: (id, body) => serverApi.put(`/webinars/${encodeIdentifier(id)}/audience-access`, body),
    listNotes: id => serverApi.get(`/webinars/${encodeIdentifier(id)}/notes`),
    addNote: (id, slideId, body) => serverApi.post(
      `/webinars/${encodeIdentifier(id)}/slides/${encodeIdentifier(slideId)}/notes`,
      body,
    ),
    updateNote: (id, noteId, body) => serverApi.put(
      `/webinars/${encodeIdentifier(id)}/notes/${encodeIdentifier(noteId)}`,
      body,
    ),
    deleteNote: (id, noteId) => serverApi.delete(
      `/webinars/${encodeIdentifier(id)}/notes/${encodeIdentifier(noteId)}`,
    ),
    getSettings: () => serverApi.get('/webinar-presenter-settings/me'),
    saveSettings: body => serverApi.put('/webinar-presenter-settings/me', body),
    listUsers: () => serverApi.get('/users/directory'),
    listAssets: filters => serverApi.get(assetCatalogPath(filters)),
    createUploadIntent: body => serverApi.post('/webinar-assets/upload-intents', body),
    confirmUpload: versionId => serverApi.post(
      `/webinar-assets/upload-intents/${encodeIdentifier(versionId)}/confirm`,
      {},
    ),
    createAssetVersionIntent: (assetId, body) => serverApi.post(
      `/webinar-assets/${encodeIdentifier(assetId)}/versions`,
      body,
    ),
    updateAsset: (assetId, body) => serverApi.patch(
      `/webinar-assets/${encodeIdentifier(assetId)}`,
      body,
    ),
    updateAssetVersion: (assetId, versionId, body) => serverApi.patch(
      `/webinar-assets/${encodeIdentifier(assetId)}/versions/${encodeIdentifier(versionId)}`,
      body,
    ),
    getAssetUsage: versionId => serverApi.get(
      `/webinar-assets/${encodeIdentifier(versionId)}/usage`,
    ),
  });

  root.WebinarStudioAPI = WebinarStudioAPI;
}(window));
