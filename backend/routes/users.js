// Public user directory — basic info for all authenticated users
const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const { requireDbUser } = require('../middleware/userContext');

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

module.exports = router;
