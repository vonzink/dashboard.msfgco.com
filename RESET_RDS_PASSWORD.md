# How to Reset Your RDS Database Password

## Option 1: AWS Console (Easiest)

### Step 1: Go to AWS RDS Console
1. Log into AWS Console: https://console.aws.amazon.com
2. Navigate to **RDS** service
3. Click on **Databases** in the left sidebar
4. Find and click on your database: **msfg-mortgage-db**

### Step 2: Modify the Database
1. Click the **Actions** button (top right)
2. Select **Modify**
3. Scroll down to **Database authentication** section
4. Find **Master password** field
5. Click **Change password**
6. Enter your new password (must be 8+ characters)
7. **IMPORTANT:** Check the box that says **Apply immediately** (or it will wait for maintenance window)
8. Scroll to bottom and click **Continue**
9. Review and click **Modify DB instance**

### Step 3: Wait for Restart
- The database will restart (takes 2-5 minutes)
- You'll see status change to "Modifying" then back to "Available"
- **Don't try to connect until status is "Available"**

### Step 4: Test Connection
Once status is "Available", try connecting again:

```bash
mysql -h msfg-mortgage-db.cghqooasg1vk.us-east-1.rds.amazonaws.com -u YOUR_USERNAME -p -P 3306
```

Enter your NEW password when prompted.

---

## Option 2: AWS CLI (Command Line)

If you prefer command line, you can reset it with:

```bash
aws rds modify-db-instance \
    --db-instance-identifier msfg-mortgage-db \
    --master-user-password YOUR_NEW_PASSWORD \
    --apply-immediately \
    --region us-east-1
```

**Replace `YOUR_NEW_PASSWORD` with your actual new password.**

**Note:** This will restart your database immediately.

---

## Troubleshooting

### If you don't know your username:
Check in AWS Console:
1. Go to RDS → Your database
2. Click **Configuration** tab
3. Look for **Master username** (usually `admin` or `root`)

### If connection still fails after reset:
1. **Check Security Group:** Your IP might not be allowed
   - Go to RDS → Your database → **Connectivity & security** tab
   - Click on the Security Group link
   - Make sure there's an inbound rule allowing MySQL (port 3306) from your IP

2. **Check if database is in a VPC:**
   - If it's in a private VPC, you might need to connect through a bastion host or VPN

### Test connection without password prompt:
```bash
mysql -h msfg-mortgage-db.cghqooasg1vk.us-east-1.rds.amazonaws.com -u YOUR_USERNAME -pYOUR_PASSWORD -P 3306
```
(No space between -p and password - but this is less secure as password shows in command history)

