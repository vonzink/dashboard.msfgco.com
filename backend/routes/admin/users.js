// Admin — User CRUD + AI integration keys + Cognito management
const express = require('express');
const router = express.Router();
const db = require('../../db/connection');
const { encrypt, decrypt, mask } = require('../../utils/encryption');
const { userUpdate, validate } = require('../../validation/schemas');
const cognito = require('../../services/cognito');

// GET /users
router.get('/', async (req, res, next) => {
  try {
    const [users] = await db.query(
      `SELECT id, cognito_sub, email, name, initials, role,
              is_active, created_at, updated_at
       FROM users
       ORDER BY name`
    );
    res.json(users);
  } catch (error) {
    next(error);
  }
});

// GET /users/:id
router.get('/:id', async (req, res, next) => {
  try {
    const [users] = await db.query('SELECT * FROM users WHERE id = ?', [req.params.id]);
    if (users.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json(users[0]);
  } catch (error) {
    next(error);
  }
});

// POST /users — create in Cognito AND DB
router.post('/', async (req, res, next) => {
  try {
    const { email, name, initials, role, password } = req.body;

    if (!email || !name) {
      return res.status(400).json({ error: 'email and name are required' });
    }
    if (!password || password.length < 8) {
      return res.status(400).json({ error: 'password is required and must be at least 8 characters' });
    }

    const [existing] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.length > 0) {
      return res.status(409).json({ error: 'A user with this email already exists' });
    }

    const userInitials = initials || name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    const userRole = role || 'user';

    // Create in Cognito first
    let cognitoResult;
    try {
      cognitoResult = await cognito.adminCreateUser({ email, name, password, role: userRole });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to create Cognito user: ' + err.message });
    }

    const [result] = await db.query(
      'INSERT INTO users (cognito_sub, email, name, initials, role, is_active) VALUES (?, ?, ?, ?, ?, 1)',
      [cognitoResult.sub || null, email, name, userInitials, userRole]
    );

    res.status(201).json({
      id: result.insertId,
      cognito_sub: cognitoResult.sub,
      email,
      name,
      initials: userInitials,
      role: userRole,
      is_active: 1,
    });
  } catch (error) {
    next(error);
  }
});

// PUT /users/:id — update DB + sync to Cognito
router.put('/:id', validate(userUpdate), async (req, res, next) => {
  try {
    const { name, initials, role, is_active } = req.body;
    const userId = req.params.id;

    const [existingRows] = await db.query('SELECT * FROM users WHERE id = ?', [userId]);
    if (existingRows.length === 0) return res.status(404).json({ error: 'User not found' });
    const existing = existingRows[0];

    const updates = [];
    const params = [];

    if (name !== undefined) { updates.push('name = ?'); params.push(name); }
    if (initials !== undefined) { updates.push('initials = ?'); params.push(initials); }
    if (role !== undefined) { updates.push('role = ?'); params.push(role); }
    if (is_active !== undefined) { updates.push('is_active = ?'); params.push(is_active ? 1 : 0); }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    params.push(userId);
    await db.query(`UPDATE users SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`, params);

    // Sync to Cognito (best-effort; log but don't fail the DB update)
    try {
      const username = await cognito.findUsername({
        email: existing.email,
        sub: existing.cognito_sub,
      });
      if (username) {
        if (name !== undefined) {
          await cognito.adminUpdateAttributes(username, { name });
        }
        if (role !== undefined) {
          await cognito.adminSyncGroup(username, role);
        }
        if (is_active !== undefined) {
          if (is_active) await cognito.adminEnableUser(username);
          else await cognito.adminDisableUser(username);
        }
      }
    } catch (e) {
      console.warn('Cognito sync failed for user', userId, e.message);
    }

    const [users] = await db.query('SELECT * FROM users WHERE id = ?', [userId]);
    res.json(users[0]);
  } catch (error) {
    next(error);
  }
});

// DELETE /users/:id — soft delete (deactivate in DB + disable in Cognito)
router.delete('/:id', async (req, res, next) => {
  try {
    const userId = req.params.id;
    const currentUserId = req.user?.db?.id;

    if (String(userId) === String(currentUserId)) {
      return res.status(400).json({ error: 'Cannot deactivate your own account' });
    }

    const [rows] = await db.query('SELECT email, cognito_sub FROM users WHERE id = ?', [userId]);
    if (rows.length === 0) return res.status(404).json({ error: 'User not found' });

    await db.query('UPDATE users SET is_active = 0, updated_at = NOW() WHERE id = ?', [userId]);

    // Disable in Cognito so they can no longer log in
    try {
      const username = await cognito.findUsername({
        email: rows[0].email,
        sub: rows[0].cognito_sub,
      });
      if (username) await cognito.adminDisableUser(username);
    } catch (e) {
      console.warn('Cognito disable failed for user', userId, e.message);
    }

    res.json({ success: true, message: 'User deactivated' });
  } catch (error) {
    next(error);
  }
});

// DELETE /users/:id/permanent — hard delete (DB + Cognito)
router.delete('/:id/permanent', async (req, res, next) => {
  try {
    const userId = req.params.id;
    const currentUserId = req.user?.db?.id;

    if (String(userId) === String(currentUserId)) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    const [users] = await db.query('SELECT id, name, email, cognito_sub FROM users WHERE id = ?', [userId]);
    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Clean up tables without FK CASCADE constraints
    await db.query('DELETE FROM chat_messages WHERE user_id = ?', [userId]);
    await db.query('DELETE FROM chat_attachments WHERE user_id = ?', [userId]);
    await db.query('DELETE FROM user_preferences WHERE user_id = ?', [userId]);
    await db.query('UPDATE processing_records SET user_id = NULL WHERE user_id = ?', [userId]);

    // Delete the user — CASCADE handles the rest
    await db.query('DELETE FROM users WHERE id = ?', [userId]);

    // Delete in Cognito (best-effort)
    try {
      const username = await cognito.findUsername({
        email: users[0].email,
        sub: users[0].cognito_sub,
      });
      if (username) await cognito.adminDeleteUser(username);
    } catch (e) {
      console.warn('Cognito delete failed for user', userId, e.message);
    }

    res.json({ success: true, message: `User "${users[0].name}" permanently deleted` });
  } catch (error) {
    next(error);
  }
});

// POST /users/:id/set-password — admin sets a new permanent password
router.post('/:id/set-password', async (req, res, next) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 8) {
      return res.status(400).json({ error: 'password is required and must be at least 8 characters' });
    }

    const [rows] = await db.query('SELECT email, cognito_sub FROM users WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'User not found' });

    const username = await cognito.findUsername({
      email: rows[0].email,
      sub: rows[0].cognito_sub,
    });
    if (!username) return res.status(404).json({ error: 'Cognito user not found' });

    await cognito.adminSetPassword(username, password, true);
    res.json({ success: true, message: 'Password updated' });
  } catch (error) {
    next(error);
  }
});

// POST /users/:id/reset-password — triggers Cognito to email the user a reset code
router.post('/:id/reset-password', async (req, res, next) => {
  try {
    const [rows] = await db.query('SELECT email, cognito_sub FROM users WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'User not found' });

    const username = await cognito.findUsername({
      email: rows[0].email,
      sub: rows[0].cognito_sub,
    });
    if (!username) return res.status(404).json({ error: 'Cognito user not found' });

    await cognito.adminResetPassword(username);
    res.json({ success: true, message: 'Reset code emailed to user' });
  } catch (error) {
    next(error);
  }
});

// ── AI API Key Management ───────────────────────

// GET /users/:id/integrations
router.get('/:id/integrations', async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT id, service, credential_type, encrypted_value, iv, auth_tag, is_active
       FROM user_integrations
       WHERE user_id = ? AND service IN ('openai', 'anthropic')`,
      [req.params.id]
    );

    const integrations = rows.map(row => {
      let maskedValue = '••••••••';
      try {
        const plaintext = decrypt(row.encrypted_value, row.iv, row.auth_tag);
        maskedValue = mask(plaintext);
      } catch { /* ignore decryption failures */ }
      return { service: row.service, maskedValue, is_active: row.is_active };
    });

    res.json(integrations);
  } catch (error) {
    next(error);
  }
});

// POST /users/:id/integrations
router.post('/:id/integrations', async (req, res, next) => {
  try {
    const userId = req.params.id;
    const { service, value } = req.body;

    if (!service || !['openai', 'anthropic'].includes(service)) {
      return res.status(400).json({ error: 'service must be openai or anthropic' });
    }
    if (!value || !value.trim()) {
      return res.status(400).json({ error: 'value is required' });
    }

    const { encrypted, iv, authTag } = encrypt(value.trim());

    await db.query(
      `INSERT INTO user_integrations (user_id, service, credential_type, encrypted_value, iv, auth_tag)
       VALUES (?, ?, 'api_key', ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         encrypted_value = VALUES(encrypted_value),
         iv = VALUES(iv),
         auth_tag = VALUES(auth_tag),
         is_active = TRUE,
         updated_at = NOW()`,
      [userId, service, encrypted, iv, authTag]
    );

    res.json({ success: true, service, maskedValue: mask(value.trim()) });
  } catch (error) {
    next(error);
  }
});

// DELETE /users/:id/integrations/:service
router.delete('/:id/integrations/:service', async (req, res, next) => {
  try {
    await db.query(
      'DELETE FROM user_integrations WHERE user_id = ? AND service = ?',
      [req.params.id, req.params.service]
    );
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
