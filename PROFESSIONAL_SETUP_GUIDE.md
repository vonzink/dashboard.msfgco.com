# Professional Setup Guide - Step by Step

## Overview
This guide walks you through setting up the backend API on your EC2 instance. The backend will:
- Connect to your RDS database (same VPC, secure)
- Handle all database operations
- Serve files from S3
- Provide REST API endpoints for your frontend

---

## STEP 1: Connect to Your EC2 Instance

### Option A: If you have your SSH key

```bash
# Find your key file location
# Common locations:
ls -la ~/.ssh/msfg-mortgage-key.pem
ls -la ~/Downloads/msfg-mortgage-key.pem
ls -la ~/Desktop/msfg-mortgage-key.pem

# Once found, SSH in (Amazon Linux uses 'ec2-user'):
ssh -i /path/to/msfg-mortgage-key.pem ec2-user@54.175.238.145

# OR if it's Ubuntu:
ssh -i /path/to/msfg-mortgage-key.pem ubuntu@54.175.238.145
```

### Option B: If you don't have the key

1. Go to AWS Console → EC2 → Key Pairs
2. If `msfg-mortgage-key` exists, you'll need to download it again (or create a new one)
3. OR use AWS Session Manager (if enabled on your instance)

---

## STEP 2: Prepare EC2 Instance

Once connected to EC2, run these commands:

### Install Node.js and npm

**For Amazon Linux 2:**
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
source ~/.bashrc
nvm install 20
nvm use 20
node --version  # Should show v20.x.x
npm --version   # Should show 10.x.x
```

**For Ubuntu:**
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version
npm --version
```

### Install MySQL Client (for testing connections)

**Amazon Linux:**
```bash
sudo yum install mysql -y
```

**Ubuntu:**
```bash
sudo apt-get update
sudo apt-get install mysql-client -y
```

### Install Git (if not installed)

**Amazon Linux:**
```bash
sudo yum install git -y
```

**Ubuntu:**
```bash
sudo apt-get install git -y
```

---

## STEP 3: Test RDS Connection from EC2

From your EC2 instance, test connecting to RDS:

```bash
mysql -h msfg-mortgage-db.cghqooasg1vk.us-east-1.rds.amazonaws.com -u admin -p
```

Enter your RDS password. If it connects successfully, you're ready to proceed!

---

## STEP 4: Create Backend Application Directory

On EC2, create the project:

```bash
# Create directory
mkdir -p ~/msfg-backend
cd ~/msfg-backend

# Initialize Node.js project
npm init -y
```

---

## STEP 5: Install Dependencies

```bash
npm install express mysql2 cors dotenv
npm install --save-dev nodemon
```

---

## STEP 6: Set Up Project Structure

Create these files (I'll provide the code in next steps):

```
msfg-backend/
├── server.js          # Main server file
├── .env              # Environment variables (database credentials)
├── package.json      # Dependencies
├── db/
│   ├── connection.js  # Database connection
│   └── migrations.js  # Database setup/migrations
├── routes/
│   ├── investors.js
│   ├── announcements.js
│   ├── notifications.js
│   ├── goals.js
│   └── files.js
└── middleware/
    └── auth.js
```

---

## NEXT: I'll provide all the code files

Once you've completed Steps 1-5 and confirmed you can connect to RDS from EC2, let me know and I'll provide:
- Complete backend code
- Database migration script
- Environment configuration
- Instructions for deployment

---

## What We're Building

The backend will have these endpoints:
- `GET /api/investors` - Get all investors
- `GET /api/investors/:id` - Get specific investor
- `PUT /api/investors/:id` - Update investor (including notes)
- `GET /api/announcements` - Get all announcements
- `POST /api/announcements` - Create announcement
- `DELETE /api/announcements/:id` - Delete announcement
- `POST /api/notifications` - Create notification/reminder
- `GET /api/goals` - Get goals
- `PUT /api/goals` - Update goals
- `POST /api/files/upload-url` - Get S3 presigned URL for file upload

---

**Ready to start? Begin with Step 1 - connect to your EC2 instance and let me know when you're in!**

