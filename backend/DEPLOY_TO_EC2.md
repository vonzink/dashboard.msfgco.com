# Deploy Backend to EC2 - Complete Instructions

## Prerequisites
- You have SSH access to your EC2 instance (54.175.238.145)
- You know your RDS password
- You have AWS credentials (for S3 access)

---

## Step 1: Transfer Backend Code to EC2

### Option A: Using SCP (from your local machine)

```bash
# From your local machine, in the msfg-dashboard directory:
cd /Users/zacharyzink/MSFG/index_page/msfg-dashboard

# Transfer the entire backend folder to EC2
scp -i ~/.ssh/msfg-mortgage-key.pem -r backend ec2-user@54.175.238.145:~/msfg-backend
```

### Option B: Using Git (if you push to a repository)

```bash
# On EC2, clone your repository:
git clone YOUR_REPO_URL
cd YOUR_REPO_NAME/msfg-dashboard/backend
```

### Option C: Manual Copy-Paste

1. Create files on EC2 manually using `nano` or `vi`
2. Copy content from your local files

---

## Step 2: SSH into EC2

```bash
ssh -i ~/.ssh/msfg-mortgage-key.pem ec2-user@54.175.238.145
```

---

## Step 3: Install Node.js (if not already installed)

```bash
# Install Node Version Manager
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
source ~/.bashrc

# Install Node.js LTS
nvm install 20
nvm use 20
nvm alias default 20

# Verify
node --version  # Should show v20.x.x
npm --version   # Should show 10.x.x
```

---

## Step 4: Navigate to Backend Directory

```bash
cd ~/msfg-backend
# OR if you transferred it differently:
cd ~/msfg-backend/backend
```

---

## Step 5: Install Dependencies

```bash
npm install
```

This will install:
- express
- mysql2
- cors
- dotenv
- @aws-sdk/client-s3
- @aws-sdk/s3-request-presigner
- nodemon (dev dependency)

---

## Step 6: Create .env File

```bash
nano .env
```

Paste this content (update with your actual values):

```env
# Database Configuration
DB_HOST=msfg-mortgage-db.cghqooasg1vk.us-east-1.rds.amazonaws.com
DB_PORT=3306
DB_USER=admin
DB_PASSWORD=YOUR_RDS_PASSWORD_HERE
DB_NAME=msfg_mortgage_db

# Server Configuration
PORT=8080
NODE_ENV=production

# AWS S3 Configuration
AWS_REGION=us-east-1
S3_BUCKET_NAME=msfg-dashboard-files
AWS_ACCESS_KEY_ID=YOUR_AWS_ACCESS_KEY
AWS_SECRET_ACCESS_KEY=YOUR_AWS_SECRET_KEY
```

**Important:** 
- Replace `YOUR_RDS_PASSWORD_HERE` with your actual RDS password
- Replace AWS credentials (or use IAM role if configured on EC2)
- Save and exit: `Ctrl+X`, then `Y`, then `Enter`

---

## Step 7: Copy DATABASE_SCHEMA.sql to Backend

The migration script needs the SQL file. Copy it:

```bash
# If the SQL file is in the parent directory:
cp ../DATABASE_SCHEMA.sql ./

# OR if you need to upload it separately:
# Use SCP to transfer: scp -i ~/.ssh/msfg-mortgage-key.pem DATABASE_SCHEMA.sql ec2-user@54.175.238.145:~/msfg-backend/
```

---

## Step 8: Test Database Connection

```bash
# Install MySQL client (if not installed)
sudo yum install mysql -y

# Test connection
mysql -h msfg-mortgage-db.cghqooasg1vk.us-east-1.rds.amazonaws.com -u admin -p

# Enter password. If it connects, you're good! Exit with: exit
```

---

## Step 9: Start the Server

### First Time (Test Run)

```bash
npm start
```

You should see:
```
✓ Database connection successful
✓ Database migrations completed
✓ Server running on http://0.0.0.0:8080
✓ API available at http://localhost:8080/api
```

**Test it:** Open another terminal and test:

```bash
curl http://localhost:8080/health
# Should return: {"status":"ok","timestamp":"..."}
```

### Run in Background (Production)

Use `pm2` for process management (recommended):

```bash
# Install PM2 globally
npm install -g pm2

# Start the server
pm2 start server.js --name msfg-backend

# Make it start on boot
pm2 startup
pm2 save

# Check status
pm2 status

# View logs
pm2 logs msfg-backend
```

**OR** use `nohup`:

```bash
nohup npm start > server.log 2>&1 &
```

---

## Step 10: Configure EC2 Security Group

Allow inbound traffic on port 8080:

1. Go to AWS Console → EC2 → Security Groups
2. Find the security group for `msfg-mortgage-app`
3. Add inbound rule:
   - Type: Custom TCP
   - Port: 8080
   - Source: 0.0.0.0/0 (or specific IPs for security)
   - Description: "Backend API"

---

## Step 11: Test API from Your Computer

```bash
# Test health endpoint
curl http://54.175.238.145:8080/health

# Test investors endpoint
curl http://54.175.238.145:8080/api/investors
```

---

## Step 12: Update Frontend Config

Update `msfg-dashboard/js/config.js`:

```javascript
api: {
  baseUrl: 'http://54.175.238.145:8080/api'
}
```

---

## Troubleshooting

### Port 8080 Already in Use
```bash
# Find what's using port 8080
sudo lsof -i :8080

# Kill the process or use a different port in .env
```

### Database Connection Fails
- Check `.env` file has correct credentials
- Verify RDS security group allows connections from EC2 security group
- Test connection manually with `mysql` command

### Can't Connect from Outside
- Check EC2 security group allows port 8080
- Verify server is listening on `0.0.0.0:8080` (not just `localhost`)

### PM2 Not Found
```bash
# Add npm global bin to PATH
export PATH=$PATH:~/.nvm/versions/node/v20.x.x/bin
```

---

## Next Steps

1. ✅ Backend is running
2. ⏭️ Create S3 bucket (next step)
3. ⏭️ Update frontend to use API
4. ⏭️ Test end-to-end

---

## Useful Commands

```bash
# View server logs (if using PM2)
pm2 logs msfg-backend

# Restart server
pm2 restart msfg-backend

# Stop server
pm2 stop msfg-backend

# View process status
pm2 status

# If using nohup, view logs
tail -f server.log
```

