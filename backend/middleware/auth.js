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
      // Try to find the user in our DB.
      // ID tokens have email; access tokens only have sub/username.
      const email = req.user.email || req.user.claims?.email;
      const sub = req.user.sub || req.user.claims?.sub;

      let users = [];

      // 1. Try email lookup (works with ID tokens)
      if (email) {
        [users] = await db.query(
          'SELECT id, email, name, role FROM users WHERE email = ?',
          [email]
        );
      }

      // 2. Fallback: try cognito_sub lookup (works with access tokens)
      if (users.length === 0 && sub) {
        [users] = await db.query(
          'SELECT id, email, name, role FROM users WHERE cognito_sub = ?',
          [sub]
        );
      }

      if (users.length > 0) {
        req.user.db = users[0];

        // Backfill cognito_sub if we found the user by email but sub isn't stored yet
        if (sub && !users[0].cognito_sub) {
          db.query('UPDATE users SET cognito_sub = ? WHERE id = ?', [sub, users[0].id])
            .catch(err => console.warn('cognito_sub backfill failed:', err.message));
        }
      } else {
        console.warn('Auth: JWT valid but no DB user found for email=%s sub=%s', email, sub);
      }

      next();
    } catch (dbErr) {
      console.error('DB user lookup error:', dbErr.message);
      // Still allow the request — JWT is valid, but downstream should check req.user.db
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
 * Express middleware: reject with 403 if user is not an admin.
 * Use after `authenticate` on routes that require admin access.
 *
 *   router.post('/', requireAdmin, handler);
 */
function requireAdmin(req, res, next) {
  if (!isAdmin(req)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
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
  requireAdmin,
  getUserFromApiKey,
};

