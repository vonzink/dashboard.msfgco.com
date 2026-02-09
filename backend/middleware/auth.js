/**
 * middleware/auth.js
 *
 * Combined authentication middleware.
 *
 * 1. Verifies the Cognito JWT (delegates to auth/middleware.js)
 * 2. Looks up the authenticated user in our DB by email
 * 3. Attaches req.user.db  =  { id, email, name, role }
 *
 * Exports:
 *   authenticate  – Express middleware (JWT + DB lookup)
 *   isAdmin       – helper: isAdmin(req) → boolean
 *   getUserFromApiKey – look up a user row by API key string
 */

const db = require('../db/connection');
const { requireAuth } = require('../auth/middleware');

// Cognito JWT verification middleware (handles 401 on failure)
const cognitoAuth = requireAuth();

/**
 * Express middleware: verify JWT then attach req.user.db
 */
function authenticate(req, res, next) {
  cognitoAuth(req, res, async function afterJwt(err) {
    if (err) return next(err);

    // cognitoAuth sets req.user with { sub, username, email, groups, claims }
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication failed' });
    }

    try {
      const email = req.user.email || req.user.claims?.email;
      if (email) {
        const [users] = await db.query(
          'SELECT id, email, name, role FROM users WHERE email = ?',
          [email]
        );
        if (users.length > 0) {
          req.user.db = users[0];
        }
      }
      next();
    } catch (dbErr) {
      console.error('DB user lookup error:', dbErr.message);
      // Don't fail auth just because the DB lookup had an issue
      next();
    }
  });
}

/**
 * Check if the current request user is an admin (from DB record).
 */
function isAdmin(req) {
  const role = String(req.user?.db?.role || '').toLowerCase();
  return role === 'admin';
}

/**
 * Get user from API key (for webhook authentication).
 */
async function getUserFromApiKey(apiKey) {
  try {
    const [keys] = await db.query(
      `SELECT k.*, u.id as user_id, u.email, u.name, u.role 
       FROM api_keys k
       JOIN users u ON k.user_id = u.id
       WHERE k.api_key = ? AND k.active = TRUE AND (k.expires_at IS NULL OR k.expires_at > NOW())`,
      [apiKey]
    );

    if (keys.length === 0) {
      return null;
    }

    return {
      id: keys[0].user_id,
      email: keys[0].email,
      name: keys[0].name,
      role: keys[0].role || 'user',
      apiKeyId: keys[0].id,
      apiKeyName: keys[0].key_name,
    };
  } catch (error) {
    console.error('Error getting user from API key:', error);
    return null;
  }
}

module.exports = {
  authenticate,
  isAdmin,
  getUserFromApiKey,
};

