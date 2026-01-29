# Deploy Role-Based Access Control - Step by Step

## Step 1: Update Database

On your EC2 instance or from your Mac with MySQL access:

```bash
# Connect to database
mysql -h msfg-mortgage-db.cghqooasg1vk.us-east-1.rds.amazonaws.com -u admin -p msfg_mortgage_db
```

Then run these SQL commands:

### 1.1 Update api_keys table to add user_id

```sql
ALTER TABLE api_keys ADD COLUMN user_id INT;
ALTER TABLE api_keys ADD FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX idx_user ON api_keys(user_id);
```

### 1.2 Create new tables

Copy and paste the contents of `ADDITIONAL_TABLES.sql` (the CREATE TABLE statements for tasks, pre_approvals, pipeline, api_keys, webhook_logs)

### 1.3 Update default user to admin role

```sql
UPDATE users SET role = 'admin' WHERE email = 'zachary.zink@msfg.us' AND (role IS NULL OR role = '');
```

---

## Step 2: Transfer Backend Files to EC2

From your Mac:

```bash
cd /Users/zacharyzink/MSFG/index_page/msfg-dashboard

# Transfer new route files
scp -i /Users/zacharyzink/MSFG/msfg-mortgage-key.pem backend/routes/tasks.js ubuntu@54.175.238.145:~/msfg-backend/routes/
scp -i /Users/zacharyzink/MSFG/msfg-mortgage-key.pem backend/routes/preApprovals.js ubuntu@54.175.238.145:~/msfg-backend/routes/
scp -i /Users/zacharyzink/MSFG/msfg-mortgage-key.pem backend/routes/pipeline.js ubuntu@54.175.238.145:~/msfg-backend/routes/
scp -i /Users/zacharyzink/MSFG/msfg-mortgage-key.pem backend/routes/webhooks.js ubuntu@54.175.238.145:~/msfg-backend/routes/

# Transfer middleware
scp -i /Users/zacharyzink/MSFG/msfg-mortgage-key.pem backend/middleware/auth.js ubuntu@54.175.238.145:~/msfg-backend/middleware/
scp -i /Users/zacharyzink/MSFG/msfg-mortgage-key.pem backend/middleware/apiKeyAuth.js ubuntu@54.175.238.145:~/msfg-backend/middleware/

# Transfer scripts
scp -i /Users/zacharyzink/MSFG/msfg-mortgage-key.pem backend/scripts/generateApiKey.js ubuntu@54.175.238.145:~/msfg-backend/scripts/

# Transfer updated server.js
scp -i /Users/zacharyzink/MSFG/msfg-mortgage-key.pem backend/server.js ubuntu@54.175.238.145:~/msfg-backend/
```

---

## Step 3: Restart Backend Server

On EC2:

```bash
pm2 restart msfg-backend
pm2 logs msfg-backend --lines 30
```

Check for errors!

---

## Step 4: Test

Test the new endpoints:

```bash
# Test tasks endpoint
curl https://api.msfgco.com/api/tasks

# Test with API key (once you generate one)
curl -H "X-API-Key: YOUR_KEY" https://api.msfgco.com/api/webhooks/tasks \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"title":"Test Task","priority":"high"}'
```

