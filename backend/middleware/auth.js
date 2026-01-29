// Authentication and Authorization Middleware
const db = require('../db/connection');

/**
 * Get user from API key (for webhook authentication)
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
      apiKeyName: keys[0].key_name
    };
  } catch (error) {
    console.error('Error getting user from API key:', error);
    return null;
  }
}

module.exports = {
  getUserFromApiKey
};

