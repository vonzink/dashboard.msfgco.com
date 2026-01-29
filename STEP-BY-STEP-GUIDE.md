# Step-by-Step Setup Guide

## STEP 1: DATABASE SETUP

### Step 1.1: Get Your Database Connection Info

✅ **Your RDS Endpoint:** `msfg-mortgage-db.cghqooasg1vk.us-east-1.rds.amazonaws.com`
- Port: 3306 (default MySQL port)
- Database Name: You'll need to create it or it might already exist
- Username: Check your RDS instance configuration
- Password: You set this when creating the RDS instance

### Step 1.2: Install MySQL Client on Your Computer

**If you're on Mac:**
```bash
brew install mysql-client
```

**If you're on Windows:**
- Download MySQL Workbench: https://dev.mysql.com/downloads/workbench/
- Or install MySQL Command Line Client

**If you're on Linux:**
```bash
sudo apt-get install mysql-client  # Ubuntu/Debian
sudo yum install mysql            # Amazon Linux/RHEL
```

### Step 1.3: Connect to Your Database

Open your terminal and run:

```bash
mysql -h msfg-mortgage-db.cghqooasg1vk.us-east-1.rds.amazonaws.com \
      -u YOUR_USERNAME \
      -p \
      -P 3306
```

**What this means:**
- `-h` = hostname (your RDS endpoint)
- `-u` = username (replace YOUR_USERNAME with your actual RDS username)
- `-p` = prompt for password (you'll be asked to enter it)
- `-P` = port (3306 is default MySQL port)

**Example:**
```bash
mysql -h msfg-mortgage-db.cghqooasg1vk.us-east-1.rds.amazonaws.com -u admin -p -P 3306
```

**When prompted, enter your RDS master password.**

### Step 1.4: Create Database (if it doesn't exist)

Once connected, you'll see a MySQL prompt like `mysql>`

Run these commands one at a time:

```sql
CREATE DATABASE IF NOT EXISTS msfg_mortgage_db;
USE msfg_mortgage_db;
SHOW DATABASES;
```

**Expected output:** You should see `msfg_mortgage_db` in the list

### Step 1.5: Run the Schema Script

**Option A: Copy and Paste Method**

1. Open the file `DATABASE_SCHEMA.sql` in a text editor
2. Copy ALL the contents (Cmd+A / Ctrl+A, then Cmd+C / Ctrl+C)
3. Paste into your MySQL terminal (right-click or Cmd+V / Ctrl+V)
4. Press Enter

**Option B: File Method**

From your terminal (NOT in MySQL), run:

```bash
mysql -h msfg-mortgage-db.cghqooasg1vk.us-east-1.rds.amazonaws.com \
      -u YOUR_USERNAME \
      -p \
      -P 3306 \
      msfg_mortgage_db < /Users/zacharyzink/MSFG/index_page/msfg-dashboard/DATABASE_SCHEMA.sql
```

Replace `YOUR_USERNAME` with your actual username and enter the path correctly.

### Step 1.6: Verify Tables Were Created

Back in MySQL (or reconnect), run:

```sql
USE msfg_mortgage_db;
SHOW TABLES;
```

**You should see these tables:**
- users
- investors
- investor_team
- investor_lender_ids
- investor_mortgagee_clauses
- investor_links
- announcements
- notifications
- goals
- user_preferences

**If you see all 10 tables, SUCCESS! ✅**

### Step 1.7: Verify Initial Data

Check if the default user was created:

```sql
SELECT * FROM users;
```

You should see at least one row with your email address.

---

## 🎯 CHECKPOINT 1

Before moving to Step 2, make sure:
- ✅ You can connect to the database
- ✅ All 10 tables exist
- ✅ You see at least one user in the users table

**Once Step 1 is complete, let me know and we'll move to Step 2!**

