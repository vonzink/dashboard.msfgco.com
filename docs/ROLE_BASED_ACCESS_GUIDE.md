# Role-Based Access Control Guide

## Overview

The API now supports role-based access control with two user roles:

- **Admin** - Can see and manage all data across all users
- **User** - Can only see and manage their own data (data created via their API key)

---

## How It Works

### 1. API Keys are User-Specific

When you generate an API key, you specify which user it belongs to. All data created via that API key is automatically associated with that user.

```bash
node scripts/generateApiKey.js "Zapier for John Doe" 2 1
```

- `"Zapier for John Doe"` - Name/description for the key
- `2` - User ID that will own data created via this key
- `1` - User ID creating this key (optional, defaults to user ID)

### 2. Data Filtering

**Admin Users:**
- Can see ALL tasks, pre-approvals, and pipeline items
- Can create/update/delete any data
- Can reassign items to other users

**Regular Users:**
- Can only see tasks assigned to them (`user_id = their_id`)
- Can only see pre-approvals assigned to them (`assigned_lo_id = their_id`)
- Can only see pipeline items assigned to them (`assigned_lo_id = their_id`)
- Can only update/delete their own items
- Cannot reassign items to other users

### 3. Webhook Data Association

When data comes in via webhook:
- The API key identifies which user owns it
- Data is automatically tagged with that user's ID
- User can only see data created via their API keys

---

## Setting Up Users and Roles

### Create Users

```sql
-- Create an admin user
INSERT INTO users (email, name, initials, role) 
VALUES ('admin@msfg.us', 'Admin User', 'AU', 'admin');

-- Create a regular user
INSERT INTO users (email, name, initials, role) 
VALUES ('user@msfg.us', 'Regular User', 'RU', 'user');
```

### Update User Roles

```sql
-- Make a user an admin
UPDATE users SET role = 'admin' WHERE email = 'user@example.com';

-- Make a user a regular user
UPDATE users SET role = 'user' WHERE email = 'user@example.com';
```

### List All Users

```sql
SELECT id, email, name, role FROM users ORDER BY created_at;
```

---

## Generating API Keys

### For a Specific User

```bash
cd ~/msfg-backend
node scripts/generateApiKey.js "Key Name" [user-id] [created-by-user-id]
```

**Example:**
```bash
# Generate API key for user ID 2 (John Doe)
node scripts/generateApiKey.js "Zapier Integration for John" 2 1
```

This will:
- Create an API key owned by user ID 2
- All webhook data will be associated with user ID 2
- User ID 2 will be able to see all data created via this key

### View API Keys

```sql
SELECT k.id, k.key_name, k.user_id, u.email, u.name, k.active, k.created_at, k.last_used_at
FROM api_keys k
JOIN users u ON k.user_id = u.id
ORDER BY k.created_at DESC;
```

---

## Example Workflows

### Scenario 1: Multiple Loan Officers

1. **Create users:**
   ```sql
   INSERT INTO users (email, name, initials, role) VALUES
   ('john@msfg.us', 'John Doe', 'JD', 'user'),
   ('jane@msfg.us', 'Jane Smith', 'JS', 'user');
   ```

2. **Generate API keys:**
   ```bash
   node scripts/generateApiKey.js "John's Zapier" 2 1
   node scripts/generateApiKey.js "Jane's Zapier" 3 1
   ```

3. **Configure Zapier:**
   - John uses his API key → Data goes to John's dashboard
   - Jane uses her API key → Data goes to Jane's dashboard

4. **View data:**
   - John logs in → Sees only his tasks/pre-approvals/pipeline
   - Jane logs in → Sees only her tasks/pre-approvals/pipeline
   - Admin logs in → Sees everyone's data

### Scenario 2: Admin Oversight

1. Admin user (role = 'admin') can:
   - View all data from all users
   - Reassign items between users
   - Generate API keys for any user
   - Manage users and roles

---

## API Behavior Examples

### GET /api/tasks

**Admin user:**
- Returns all tasks from all users

**Regular user:**
- Returns only tasks where `user_id = current_user.id`

### POST /api/tasks

**Admin user:**
- Can specify any `user_id` in the request
- Can assign to any user

**Regular user:**
- Task is automatically assigned to `current_user.id`
- Cannot assign to other users

### PUT /api/tasks/:id

**Admin user:**
- Can update any task
- Can reassign to any user

**Regular user:**
- Can only update tasks where `user_id = current_user.id`
- Cannot reassign to other users

### Webhook POST /api/webhooks/tasks

- Data is automatically associated with the user who owns the API key
- User ID from API key is used, not from request body

---

## Security Notes

1. **API keys are user-specific** - Each key belongs to one user
2. **Data isolation** - Users can only see their own data (unless admin)
3. **No privilege escalation** - Regular users cannot access other users' data
4. **Admin oversight** - Admins can manage all data for oversight/management

---

## Testing Access Control

### Test as Regular User

1. Create a test user with role = 'user'
2. Generate API key for that user
3. Create data via webhook using that API key
4. Query API using that API key (or as that user)
5. Should only see data created via their API key

### Test as Admin

1. Create a test user with role = 'admin'
2. Generate API key for that user
3. Query API using that API key
4. Should see all data from all users

---

## Troubleshooting

### Issue: User can't see their data

**Check:**
1. Is the API key associated with the correct user?
   ```sql
   SELECT user_id FROM api_keys WHERE api_key = 'your-key-here';
   ```

2. Is the data associated with that user?
   ```sql
   SELECT user_id, COUNT(*) FROM tasks GROUP BY user_id;
   SELECT assigned_lo_id, COUNT(*) FROM pre_approvals GROUP BY assigned_lo_id;
   ```

3. Is the user's role correct?
   ```sql
   SELECT id, email, role FROM users WHERE id = ?;
   ```

### Issue: Admin can't see all data

**Check:**
1. Is the user's role set to 'admin'?
   ```sql
   SELECT role FROM users WHERE email = 'admin@example.com';
   ```

2. Update if needed:
   ```sql
   UPDATE users SET role = 'admin' WHERE email = 'admin@example.com';
   ```

