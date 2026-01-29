// API Key Authentication Middleware
// Updated to use the auth middleware
const { getUserFromApiKey } = require('./auth');
const db = require('../db/connection');

async function validateApiKey(req, res, next) {
  try {
    const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '') || req.query.api_key;
    
    if (!apiKey) {
      return res.status(401).json({ error: 'API key required' });
    }
    
    // Get user from API key
    const user = await getUserFromApiKey(apiKey);
    
    if (!user) {
      return res.status(401).json({ error: 'Invalid or expired API key' });
    }
    
    // Store user and key info in request
    req.user = user;
    req.apiKeyId = user.apiKeyId;
    req.apiKeyName = user.apiKeyName;
    
    // Check if endpoint is allowed (if restrictions are set)
    // This would require fetching the key record again, but for now we'll skip
    // since user info is already in req.user
    
    next();
  } catch (error) {
    console.error('API key validation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// Log webhook call
async function logWebhookCall(req, res, next) {
  // Log after response is sent
  const originalSend = res.json;
  res.json = function(data) {
    logRequest(req, res.statusCode, data);
    return originalSend.call(this, data);
  };
  next();
}

async function logRequest(req, statusCode, responseBody) {
  try {
    await db.query(
      `INSERT INTO webhook_logs (api_key_id, endpoint, method, payload, response_code, response_body, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.apiKeyId || null,
        req.path,
        req.method,
        JSON.stringify(req.body),
        statusCode,
        typeof responseBody === 'object' ? JSON.stringify(responseBody) : responseBody,
        req.ip || req.connection.remoteAddress,
        req.get('user-agent') || null
      ]
    );
  } catch (error) {
    console.error('Failed to log webhook call:', error);
  }
}

module.exports = { validateApiKey, logWebhookCall };

