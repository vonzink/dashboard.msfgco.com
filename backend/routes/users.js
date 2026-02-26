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
              p.avatar_s3_key, p.email_signature
       FROM users u
       LEFT JOIN user_profiles p ON u.id = p.user_id
       WHERE u.id = ? AND u.is_active = 1`,
      [userId]
    );

    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = users[0];

    // Generate presigned avatar URL if exists
    let avatar_url = null;
    if (user.avatar_s3_key) {
      try {
        avatar_url = await getDownloadUrl(BUCKETS.media, user.avatar_s3_key);
      } catch { /* ignore */ }
    }
    delete user.avatar_s3_key;
    user.avatar_url = avatar_url;

    res.json(user);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
