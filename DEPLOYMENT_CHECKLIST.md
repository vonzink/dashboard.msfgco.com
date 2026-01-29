# Deployment Checklist - API Endpoints & Zapier Integration

## ✅ What We've Created

### 1. Database Tables
- ✅ `tasks` - Task management
- ✅ `pre_approvals` - Pre-approval tracking
- ✅ `pipeline` - Pipeline/loan tracking
- ✅ `api_keys` - API key management
- ✅ `webhook_logs` - Webhook call logging

### 2. API Endpoints

**Standard REST Endpoints (no auth required for now):**
- `/api/tasks` - GET, POST, PUT, DELETE
- `/api/pre-approvals` - GET, POST, PUT, DELETE
- `/api/pipeline` - GET, POST, PUT, DELETE

**Webhook Endpoints (API key required):**
- `/api/webhooks/tasks` - POST, PUT
- `/api/webhooks/pre-approvals` - POST, PUT
- `/api/webhooks/pipeline` - POST, PUT
- `/api/webhooks/bulk/tasks` - POST (bulk create)

### 3. Files Created
- ✅ `ADDITIONAL_TABLES.sql` - Database schema
- ✅ `backend/routes/tasks.js` - Tasks API
- ✅ `backend/routes/preApprovals.js` - Pre-approvals API
- ✅ `backend/routes/pipeline.js` - Pipeline API
- ✅ `backend/routes/webhooks.js` - Webhook endpoints
- ✅ `backend/middleware/apiKeyAuth.js` - API key authentication
- ✅ `backend/scripts/generateApiKey.js` - API key generator
- ✅ `ZAPIER_INTEGRATION.md` - Complete Zapier guide

---

## 📋 Deployment Steps

### Step 1: Run Database Migration

On EC2 or your local machine with MySQL access:

```bash
mysql -h msfg-mortgage-db.cghqooasg1vk.us-east-1.rds.amazonaws.com -u admin -p msfg_mortgage_db < ADDITIONAL_TABLES.sql
```

**Verify tables were created:**
```sql
SHOW TABLES;
-- Should see: tasks, pre_approvals, pipeline, api_keys, webhook_logs
```

### Step 2: Deploy Backend Files to EC2

Transfer new files to EC2:

```bash
# From your Mac
cd /Users/zacharyzink/MSFG/index_page/msfg-dashboard

# Transfer routes
scp -i /Users/zacharyzink/MSFG/msfg-mortgage-key.pem backend/routes/tasks.js ubuntu@54.175.238.145:~/msfg-backend/routes/
scp -i /Users/zacharyzink/MSFG/msfg-mortgage-key.pem backend/routes/preApprovals.js ubuntu@54.175.238.145:~/msfg-backend/routes/
scp -i /Users/zacharyzink/MSFG/msfg-mortgage-key.pem backend/routes/pipeline.js ubuntu@54.175.238.145:~/msfg-backend/routes/
scp -i /Users/zacharyzink/MSFG/msfg-mortgage-key.pem backend/routes/webhooks.js ubuntu@54.175.238.145:~/msfg-backend/routes/

# Transfer middleware
scp -i /Users/zacharyzink/MSFG/msfg-mortgage-key.pem -r backend/middleware ubuntu@54.175.238.145:~/msfg-backend/

# Transfer scripts
scp -i /Users/zacharyzink/MSFG/msfg-mortgage-key.pem -r backend/scripts ubuntu@54.175.238.145:~/msfg-backend/

# Transfer updated server.js
scp -i /Users/zacharyzink/MSFG/msfg-mortgage-key.pem backend/server.js ubuntu@54.175.238.145:~/msfg-backend/
```

### Step 3: Restart Backend Server

On EC2:

```bash
pm2 restart msfg-backend
pm2 logs msfg-backend --lines 30
```

**Check for errors!** Should see:
- ✓ Database connection successful
- ✓ Database migrations completed
- ✓ Server running on http://0.0.0.0:8080

### Step 4: Test API Endpoints

From your Mac or browser:

```bash
# Test health
curl http://54.175.238.145:8080/health

# Test tasks endpoint
curl http://54.175.238.145:8080/api/tasks

# Test creating a task
curl -X POST http://54.175.238.145:8080/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"Test Task","priority":"high","status":"todo"}'
```

### Step 5: Generate API Key for Zapier

On EC2:

```bash
cd ~/msfg-backend
node scripts/generateApiKey.js "Zapier Production" 1
```

**Save the API key!** You'll need it for Zapier configuration.

### Step 6: Test Webhook Endpoint

Test webhook with API key:

```bash
curl -X POST http://54.175.238.145:8080/api/webhooks/tasks \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY_HERE" \
  -d '{"title":"Webhook Test Task","priority":"high"}'
```

Should return: `{"success": true, "data": {...}}`

### Step 7: Set Up HTTPS (if not done yet)

Follow `API_HTTPS_SETUP.md` to set up HTTPS for the API.

### Step 8: Configure Zapier

1. Create a new Zap in Zapier
2. Use webhook action
3. Configure:
   - URL: `https://api.msfgco.com/api/webhooks/tasks` (or your endpoint)
   - Header: `X-API-Key: your-api-key`
   - Method: POST
   - Body: JSON with your data

See `ZAPIER_INTEGRATION.md` for detailed instructions.

---

## ✅ Verification Checklist

- [ ] Database tables created (tasks, pre_approvals, pipeline, api_keys, webhook_logs)
- [ ] All backend files transferred to EC2
- [ ] Server restarted successfully
- [ ] Standard API endpoints work (GET /api/tasks, etc.)
- [ ] Webhook endpoints work with API key
- [ ] API key generated and saved
- [ ] HTTPS configured (optional but recommended)
- [ ] Test webhook call succeeds
- [ ] Webhook logs appear in database

---

## 📚 Documentation

- **API Endpoints:** See route files in `backend/routes/`
- **Zapier Integration:** See `ZAPIER_INTEGRATION.md`
- **HTTPS Setup:** See `API_HTTPS_SETUP.md`
- **Database Schema:** See `ADDITIONAL_TABLES.sql`

---

## 🚀 Next Steps After Deployment

1. **Test all endpoints** with Postman or curl
2. **Create API keys** for each external system you'll integrate
3. **Set up Zapier zaps** for your workflows
4. **Monitor webhook logs** regularly
5. **Update frontend** to use new endpoints (when ready)

---

## ⚠️ Important Notes

- API keys are shown only once when generated
- Webhook endpoints require API key authentication
- All webhook calls are logged in `webhook_logs` table
- Standard REST endpoints don't require auth (for now - you can add later if needed)
- Use HTTPS in production for security

