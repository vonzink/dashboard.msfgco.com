// Investor Logos & Photos — S3 presigned upload/download
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { requireAdmin } = require('../../middleware/userContext');
const { BUCKETS, getUploadUrl, getDownloadUrl, deleteObject } = require('../../services/s3');
const Investor = require('../../models/Investor');

const ALLOWED_LOGO_TYPES = {
  'image/png':      '.png',
  'image/jpeg':     '.jpg',
  'image/svg+xml':  '.svg',
};
const MAX_LOGO_BYTES = 5 * 1024 * 1024; // 5 MB

function isS3Key(val) {
  return val && !val.startsWith('http://') && !val.startsWith('https://');
}

// POST /api/investors/:id/logo/upload-url
router.post('/:id/logo/upload-url', requireAdmin, async (req, res, next) => {
  try {
    const investorId = req.params.id;
    const { fileName, fileType, fileSize } = req.body;

    if (!fileName) return res.status(400).json({ error: 'fileName is required' });
    if (!fileType || !ALLOWED_LOGO_TYPES[fileType]) {
      return res.status(400).json({ error: 'Only PNG, JPG, and SVG images are allowed' });
    }
    if (fileSize && fileSize > MAX_LOGO_BYTES) {
      return res.status(400).json({ error: 'Logo must be under 5 MB' });
    }
    if (!await Investor.exists(investorId)) {
      return res.status(404).json({ error: 'Investor not found' });
    }

    const ext = ALLOWED_LOGO_TYPES[fileType];
    const fileKey = `vendor/${investorId}/${crypto.randomUUID()}${ext}`;

    const result = await getUploadUrl(BUCKETS.media, fileKey, fileType);
    res.json(result);
  } catch (error) { next(error); }
});

// PUT /api/investors/:id/logo/confirm
router.put('/:id/logo/confirm', requireAdmin, async (req, res, next) => {
  try {
    const investorId = req.params.id;
    const { fileKey } = req.body;
    if (!fileKey) return res.status(400).json({ error: 'fileKey is required' });

    const oldKey = await Investor.getLogoUrl(investorId);
    if (oldKey === null && !await Investor.exists(investorId)) {
      return res.status(404).json({ error: 'Investor not found' });
    }

    await Investor.setLogoUrl(investorId, fileKey);

    if (oldKey && isS3Key(oldKey) && oldKey !== fileKey) {
      await deleteObject(BUCKETS.media, oldKey);
    }

    let logo_url = null;
    try { logo_url = await getDownloadUrl(BUCKETS.media, fileKey); } catch {}
    res.json({ success: true, fileKey, logo_url });
  } catch (error) { next(error); }
});

// DELETE /api/investors/:id/logo
router.delete('/:id/logo', requireAdmin, async (req, res, next) => {
  try {
    const investorId = req.params.id;
    const key = await Investor.getLogoUrl(investorId);
    if (key === null && !await Investor.exists(investorId)) {
      return res.status(404).json({ error: 'Investor not found' });
    }

    if (key && isS3Key(key)) {
      await deleteObject(BUCKETS.media, key);
    }
    await Investor.clearLogoUrl(investorId);
    res.json({ success: true });
  } catch (error) { next(error); }
});

// POST /api/investors/:id/photo/upload-url — Generic photo upload for AE/team
router.post('/:id/photo/upload-url', requireAdmin, async (req, res, next) => {
  try {
    const investorId = req.params.id;
    const { fileName, fileType, fileSize, purpose } = req.body;

    if (!fileName) return res.status(400).json({ error: 'fileName is required' });
    if (!fileType || !ALLOWED_LOGO_TYPES[fileType]) {
      return res.status(400).json({ error: 'Only PNG, JPG, and SVG images are allowed' });
    }
    if (fileSize && fileSize > MAX_LOGO_BYTES) {
      return res.status(400).json({ error: 'Photo must be under 5 MB' });
    }
    if (!await Investor.exists(investorId)) {
      return res.status(404).json({ error: 'Investor not found' });
    }

    const ext = ALLOWED_LOGO_TYPES[fileType];
    const prefix = purpose === 'ae' ? 'ae' : 'team';
    const fileKey = `vendor/${investorId}/${prefix}-${crypto.randomUUID()}${ext}`;

    const result = await getUploadUrl(BUCKETS.media, fileKey, fileType);
    res.json(result);
  } catch (error) { next(error); }
});

// PUT /api/investors/:id/photo/confirm
router.put('/:id/photo/confirm', requireAdmin, async (req, res, next) => {
  try {
    const investorId = req.params.id;
    const { fileKey, purpose } = req.body;
    if (!fileKey) return res.status(400).json({ error: 'fileKey is required' });

    if (purpose === 'ae') {
      const oldKey = await Investor.getAePhotoUrl(investorId);
      if (oldKey === null && !await Investor.exists(investorId)) {
        return res.status(404).json({ error: 'Investor not found' });
      }

      await Investor.setAePhotoUrl(investorId, fileKey);

      if (oldKey && isS3Key(oldKey) && oldKey !== fileKey) {
        await deleteObject(BUCKETS.media, oldKey).catch(() => {});
      }
    }

    let photo_url = null;
    try { photo_url = await getDownloadUrl(BUCKETS.media, fileKey); } catch {}
    res.json({ success: true, fileKey, photo_url });
  } catch (error) { next(error); }
});

// DELETE /api/investors/:id/ae-photo
router.delete('/:id/ae-photo', requireAdmin, async (req, res, next) => {
  try {
    const investorId = req.params.id;
    const key = await Investor.getAePhotoUrl(investorId);
    if (key === null && !await Investor.exists(investorId)) {
      return res.status(404).json({ error: 'Investor not found' });
    }

    if (key && isS3Key(key)) {
      await deleteObject(BUCKETS.media, key).catch(() => {});
    }
    await Investor.clearAePhotoUrl(investorId);
    res.json({ success: true });
  } catch (error) { next(error); }
});

module.exports = router;
