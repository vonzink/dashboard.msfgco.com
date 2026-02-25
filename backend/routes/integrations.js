/**
 * /api/integrations — Manage per-user service credentials
 *
 * Credentials are AES-256-GCM encrypted at rest.
 * GET  /              — list all integrations for the current user (masked values)
 * POST /              — upsert a credential
 * POST /:service/test — test a credential
 * DELETE /:service    — remove a credential
 */
const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const { getUserId, requireDbUser } = require('../middleware/userContext');
const { encrypt, decrypt, mask } = require('../utils/encryption');

router.use(requireDbUser);

const VALID_SERVICES = [
  'openai', 'anthropic', 'canva', 'elevenlabs', 'midjourney', 'sora',
  'n8n', 'zapier', 'monday',
  'facebook', 'instagram', 'twitter', 'linkedin', 'tiktok',
];

const VALID_CREDENTIAL_TYPES = ['api_key', 'oauth_token', 'webhook_url'];

// ── GET / — list integrations (masked) ──────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const [rows] = await db.query(
      `SELECT id, service, credential_type, label, is_active,
              last_tested_at, last_test_result, created_at, updated_at
       FROM user_integrations
       WHERE user_id = ?
       ORDER BY service`,
      [userId]
    );

    // For each row, decrypt to get a masked preview
    const integrations = [];
    for (const row of rows) {
      let maskedValue = '••••••••';
      try {
        const [full] = await db.query(
          'SELECT encrypted_value, iv, auth_tag FROM user_integrations WHERE id = ?',
          [row.id]
        );
        if (full.length > 0) {
          const plaintext = decrypt(full[0].encrypted_value, full[0].iv, full[0].auth_tag);
          maskedValue = mask(plaintext);
        }
      } catch {
        // If decryption fails, just show masked
      }
      integrations.push({ ...row, maskedValue });
    }

    res.json(integrations);
  } catch (error) {
    next(error);
  }
});

// ── POST / — upsert a credential ───────────────────────────────
router.post('/', async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const { service, credential_type, value, label } = req.body;

    if (!service || !VALID_SERVICES.includes(service)) {
      return res.status(400).json({ error: `Invalid service. Must be one of: ${VALID_SERVICES.join(', ')}` });
    }
    if (!credential_type || !VALID_CREDENTIAL_TYPES.includes(credential_type)) {
      return res.status(400).json({ error: `Invalid credential_type. Must be one of: ${VALID_CREDENTIAL_TYPES.join(', ')}` });
    }
    if (!value || typeof value !== 'string' || !value.trim()) {
      return res.status(400).json({ error: 'value is required' });
    }

    const { encrypted, iv, authTag } = encrypt(value.trim());

    await db.query(
      `INSERT INTO user_integrations (user_id, service, credential_type, encrypted_value, iv, auth_tag, label)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         encrypted_value = VALUES(encrypted_value),
         iv = VALUES(iv),
         auth_tag = VALUES(auth_tag),
         label = VALUES(label),
         is_active = TRUE,
         last_tested_at = NULL,
         last_test_result = NULL,
         updated_at = NOW()`,
      [userId, service, credential_type, encrypted, iv, authTag, label || null]
    );

    res.json({ success: true, service, credential_type, maskedValue: mask(value.trim()) });
  } catch (error) {
    next(error);
  }
});

// ── POST /:service/test — test a stored credential ──────────────
router.post('/:service/test', async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const { service } = req.params;

    const [rows] = await db.query(
      'SELECT id, encrypted_value, iv, auth_tag, credential_type FROM user_integrations WHERE user_id = ? AND service = ? AND is_active = TRUE',
      [userId, service]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: `No credential found for ${service}` });
    }

    const row = rows[0];
    let plaintext;
    try {
      plaintext = decrypt(row.encrypted_value, row.iv, row.auth_tag);
    } catch {
      await db.query('UPDATE user_integrations SET last_tested_at = NOW(), last_test_result = ? WHERE id = ?', ['fail', row.id]);
      return res.json({ success: false, message: 'Failed to decrypt credential — it may be corrupted. Please re-enter it.' });
    }

    // Service-specific tests
    let testResult = { success: false, message: 'Test not implemented for this service' };

    if (service === 'openai' || service === 'sora') {
      // Sora uses OpenAI API keys
      testResult = await testOpenAI(plaintext);
    } else if (service === 'anthropic') {
      testResult = await testAnthropic(plaintext);
    } else if (service === 'n8n' || service === 'zapier') {
      testResult = await testWebhook(plaintext);
    } else if (service === 'canva') {
      testResult = await testCanva(plaintext);
    } else if (service === 'elevenlabs') {
      testResult = await testElevenLabs(plaintext);
    } else if (service === 'facebook' || service === 'instagram') {
      testResult = await testFacebookToken(plaintext);
    } else if (service === 'linkedin') {
      testResult = await testLinkedIn(plaintext);
    } else if (service === 'twitter') {
      testResult = await testTwitter(plaintext);
    } else if (service === 'monday') {
      testResult = await testMonday(plaintext);
    } else {
      testResult = { success: plaintext.length > 10, message: plaintext.length > 10 ? 'Credential looks valid (format check only)' : 'Credential seems too short' };
    }

    await db.query(
      'UPDATE user_integrations SET last_tested_at = NOW(), last_test_result = ? WHERE id = ?',
      [testResult.success ? 'pass' : 'fail', row.id]
    );

    res.json(testResult);
  } catch (error) {
    next(error);
  }
});

// ── DELETE /:service — remove a credential ──────────────────────
router.delete('/:service', async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const { service } = req.params;

    const [result] = await db.query(
      'DELETE FROM user_integrations WHERE user_id = ? AND service = ?',
      [userId, service]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: `No credential found for ${service}` });
    }

    res.json({ success: true, message: `${service} credential removed` });
  } catch (error) {
    next(error);
  }
});

// ── Test helpers ────────────────────────────────────────────────

async function testOpenAI(apiKey) {
  try {
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: { 'Authorization': `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(8000),
    });
    if (response.ok) {
      return { success: true, message: 'OpenAI API key is valid' };
    }
    const err = await response.json().catch(() => ({}));
    return { success: false, message: err.error?.message || `HTTP ${response.status}` };
  } catch (error) {
    return { success: false, message: error.message || 'Connection failed' };
  }
}

async function testAnthropic(apiKey) {
  try {
    const response = await fetch('https://api.anthropic.com/v1/models', {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      signal: AbortSignal.timeout(8000),
    });
    if (response.ok) {
      return { success: true, message: 'Anthropic (Claude) API key is valid' };
    }
    const err = await response.json().catch(() => ({}));
    return { success: false, message: err.error?.message || `HTTP ${response.status}` };
  } catch (error) {
    return { success: false, message: error.message || 'Connection failed' };
  }
}

async function testWebhook(url) {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ test: true, source: 'msfg-content-engine', timestamp: new Date().toISOString() }),
      signal: AbortSignal.timeout(10000),
    });
    if (response.ok || response.status === 200 || response.status === 201) {
      return { success: true, message: `Webhook responded with ${response.status}` };
    }
    return { success: false, message: `Webhook returned HTTP ${response.status}` };
  } catch (error) {
    return { success: false, message: error.message || 'Connection failed' };
  }
}

async function testCanva(apiKey) {
  try {
    const response = await fetch('https://api.canva.com/rest/v1/users/me', {
      headers: { 'Authorization': `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(8000),
    });
    if (response.ok) {
      return { success: true, message: 'Canva API key is valid' };
    }
    return { success: false, message: `Canva returned HTTP ${response.status}` };
  } catch (error) {
    return { success: false, message: error.message || 'Connection failed' };
  }
}

async function testElevenLabs(apiKey) {
  try {
    const response = await fetch('https://api.elevenlabs.io/v1/user', {
      headers: { 'xi-api-key': apiKey },
      signal: AbortSignal.timeout(8000),
    });
    if (response.ok) {
      return { success: true, message: 'ElevenLabs API key is valid' };
    }
    return { success: false, message: `ElevenLabs returned HTTP ${response.status}` };
  } catch (error) {
    return { success: false, message: error.message || 'Connection failed' };
  }
}

async function testFacebookToken(accessToken) {
  try {
    const response = await fetch(`https://graph.facebook.com/v19.0/me?access_token=${encodeURIComponent(accessToken)}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (response.ok) {
      const data = await response.json();
      return { success: true, message: `Connected as ${data.name || 'Facebook user'}` };
    }
    const err = await response.json().catch(() => ({}));
    return { success: false, message: err.error?.message || `Facebook returned HTTP ${response.status}` };
  } catch (error) {
    return { success: false, message: error.message || 'Connection failed' };
  }
}

async function testLinkedIn(accessToken) {
  try {
    const response = await fetch('https://api.linkedin.com/v2/userinfo', {
      headers: { 'Authorization': `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(8000),
    });
    if (response.ok) {
      const data = await response.json();
      return { success: true, message: `Connected as ${data.name || 'LinkedIn user'}` };
    }
    return { success: false, message: `LinkedIn returned HTTP ${response.status}` };
  } catch (error) {
    return { success: false, message: error.message || 'Connection failed' };
  }
}

async function testTwitter(bearerToken) {
  try {
    const response = await fetch('https://api.twitter.com/2/users/me', {
      headers: { 'Authorization': `Bearer ${bearerToken}` },
      signal: AbortSignal.timeout(8000),
    });
    if (response.ok) {
      const data = await response.json();
      return { success: true, message: `Connected as @${data.data?.username || 'Twitter user'}` };
    }
    const err = await response.json().catch(() => ({}));
    return { success: false, message: err.detail || `Twitter returned HTTP ${response.status}` };
  } catch (error) {
    return { success: false, message: error.message || 'Connection failed' };
  }
}

async function testMonday(apiToken) {
  try {
    const response = await fetch('https://api.monday.com/v2', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': apiToken,
      },
      body: JSON.stringify({ query: 'query { me { name email } }' }),
      signal: AbortSignal.timeout(8000),
    });
    if (response.ok) {
      const data = await response.json();
      const name = data.data?.me?.name || 'Monday.com user';
      return { success: true, message: `Connected as ${name}` };
    }
    return { success: false, message: `Monday.com returned HTTP ${response.status}` };
  } catch (error) {
    return { success: false, message: error.message || 'Connection failed' };
  }
}

/**
 * Helper: retrieve a decrypted credential for internal use by other routes.
 */
async function getCredential(userId, service) {
  const [rows] = await db.query(
    'SELECT encrypted_value, iv, auth_tag FROM user_integrations WHERE user_id = ? AND service = ? AND is_active = TRUE',
    [userId, service]
  );
  if (rows.length === 0) return null;
  try {
    return decrypt(rows[0].encrypted_value, rows[0].iv, rows[0].auth_tag);
  } catch {
    return null;
  }
}

module.exports = router;
module.exports.getCredential = getCredential;
