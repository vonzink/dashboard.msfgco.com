// Public user directory — basic info for all authenticated users
const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const { requireDbUser } = require('../middleware/userContext');
const { BUCKETS, getDownloadUrl } = require('../services/s3');

router.use(requireDbUser);

// GET /api/users/directory — active employees (name, email, role, initials)
router.get('/directory', async (req, res, next) => {
  try {
    const [users] = await db.query(
      `SELECT u.id, u.name, u.email, u.initials, u.role,
              p.phone, p.display_email, p.team, p.avatar_s3_key
       FROM users u
       LEFT JOIN user_profiles p ON u.id = p.user_id
       WHERE u.is_active = 1
       ORDER BY u.name`
    );
    res.json(users);
  } catch (error) {
    next(error);
  }
});

// GET /api/users/:id/contact-card — public-safe profile data for contact card display
router.get('/:id/contact-card', async (req, res, next) => {
  try {
    const userId = req.params.id;

    const [users] = await db.query(
      `SELECT u.id, u.name, u.email, u.initials, u.role,
              p.team, p.phone, p.display_email, p.website, p.online_app_url,
              p.facebook_url, p.instagram_url, p.twitter_url, p.linkedin_url, p.tiktok_url,
              p.youtube_url,
              p.avatar_s3_key, p.business_card_s3_key,
              p.qr_code_1_s3_key, p.qr_code_1_label,
              p.qr_code_2_s3_key, p.qr_code_2_label,
              p.nmls_number,
              p.email_signature
       FROM users u
       LEFT JOIN user_profiles p ON u.id = p.user_id
       WHERE u.id = ? AND u.is_active = 1`,
      [userId]
    );

    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = users[0];

    // Generate presigned URLs for images
    let avatar_url = null;
    if (user.avatar_s3_key) {
      try { avatar_url = await getDownloadUrl(BUCKETS.media, user.avatar_s3_key); } catch { /* ignore */ }
    }
    let business_card_url = null;
    if (user.business_card_s3_key) {
      try { business_card_url = await getDownloadUrl(BUCKETS.media, user.business_card_s3_key); } catch { /* ignore */ }
    }
    let qr_code_1_url = null;
    if (user.qr_code_1_s3_key) {
      try { qr_code_1_url = await getDownloadUrl(BUCKETS.media, user.qr_code_1_s3_key); } catch { /* ignore */ }
    }
    let qr_code_2_url = null;
    if (user.qr_code_2_s3_key) {
      try { qr_code_2_url = await getDownloadUrl(BUCKETS.media, user.qr_code_2_s3_key); } catch { /* ignore */ }
    }

    // Get custom links
    const [customLinks] = await db.query(
      'SELECT id, label, url, icon, sort_order FROM employee_custom_links WHERE user_id = ? ORDER BY sort_order, id',
      [userId]
    );

    delete user.avatar_s3_key;
    delete user.business_card_s3_key;
    delete user.qr_code_1_s3_key;
    delete user.qr_code_2_s3_key;
    user.avatar_url = avatar_url;
    user.business_card_url = business_card_url;
    user.qr_code_1_url = qr_code_1_url;
    user.qr_code_2_url = qr_code_2_url;
    user.custom_links = customLinks;

    res.json(user);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
