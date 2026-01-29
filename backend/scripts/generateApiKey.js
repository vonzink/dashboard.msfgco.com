// Script to generate API keys for webhook access
// Usage: node scripts/generateApiKey.js [key-name] [user-id] [created-by-user-id]
// Example: node scripts/generateApiKey.js "Zapier for John" 2 1

const crypto = require('crypto');
const db = require('../db/connection');
require('dotenv').config();

async function generateApiKey(keyName, userId, createdByUserId = null) {
  try {
    if (!userId) {
      console.error('\n❌ Error: user_id is required!\n');
      console.log('Usage: node scripts/generateApiKey.js [key-name] [user-id] [created-by-user-id]');
      console.log('Example: node scripts/generateApiKey.js "Zapier Production" 1 1');
      console.log('\nThe user_id determines which user the webhook data will be associated with.\n');
      process.exit(1);
    }
    
    // Verify user exists
    const [users] = await db.query('SELECT id, email, name, role FROM users WHERE id = ?', [userId]);
    if (users.length === 0) {
      console.error(`\n❌ Error: User with ID ${userId} not found!\n`);
      console.log('Available users:');
      const [allUsers] = await db.query('SELECT id, email, name, role FROM users');
      allUsers.forEach(u => {
        console.log(`  ID: ${u.id}, Email: ${u.email}, Name: ${u.name}, Role: ${u.role || 'user'}`);
      });
      process.exit(1);
    }
    
    const user = users[0];
    
    // Generate random API key (64 characters)
    const apiKey = crypto.randomBytes(32).toString('hex');
    
    // Optionally generate secret key
    const secretKey = crypto.randomBytes(32).toString('hex');
    
    // Insert into database
    const [result] = await db.query(
      `INSERT INTO api_keys (key_name, api_key, secret_key, user_id, created_by, active)
       VALUES (?, ?, ?, ?, ?, TRUE)`,
      [keyName, apiKey, secretKey, userId, createdByUserId || userId]
    );
    
    console.log('\n✅ API Key Generated Successfully!\n');
    console.log('Key Name:', keyName);
    console.log('Associated User:', user.name, `(${user.email})`);
    console.log('User Role:', user.role || 'user');
    console.log('\nAPI Key:', apiKey);
    console.log('Secret Key:', secretKey);
    console.log('\n⚠️  IMPORTANT: Save these keys now! They will not be shown again.\n');
    console.log('All webhook data created with this API key will be associated with user:', user.email);
    console.log('\nUse this API key in Zapier by adding it to the header:');
    console.log('Header Name: X-API-Key');
    console.log('Header Value:', apiKey);
    console.log('\nOr use it as a query parameter:');
    console.log('URL: https://api.msfgco.com/api/webhooks/tasks?api_key=' + apiKey);
    console.log('\n');
    
    process.exit(0);
  } catch (error) {
    console.error('Error generating API key:', error);
    process.exit(1);
  }
}

// Get command line arguments
const keyName = process.argv[2] || null;
const userId = process.argv[3] ? parseInt(process.argv[3]) : null;
const createdByUserId = process.argv[4] ? parseInt(process.argv[4]) : null;

if (!keyName || !userId) {
  console.log('\nUsage: node scripts/generateApiKey.js [key-name] [user-id] [created-by-user-id]');
  console.log('\nExample:');
  console.log('  node scripts/generateApiKey.js "Zapier for John Doe" 2 1');
  console.log('\nArguments:');
  console.log('  key-name: Name/description for this API key');
  console.log('  user-id: User ID that will own data created via this API key');
  console.log('  created-by-user-id: (Optional) User ID creating this key (defaults to user-id)');
  console.log('\nTo see available users, run:');
  console.log('  mysql -h [host] -u [user] -p msfg_mortgage_db -e "SELECT id, email, name, role FROM users;"');
  process.exit(1);
}

generateApiKey(keyName, userId, createdByUserId).then(() => {
  db.close();
});

