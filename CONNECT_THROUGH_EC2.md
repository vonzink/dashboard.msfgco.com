# Connecting to RDS Through EC2

Your RDS database is in a private subnet (not publicly accessible). To connect, we'll use your EC2 instance as a "jump host."

## Your EC2 Details:
- **Public IP:** 54.175.238.145
- **Private IP:** 172.31.27.127
- **Key Name:** msfg-mortgage-key
- **Username:** ec2-user (for Amazon Linux) or ubuntu (for Ubuntu)

## Step 1: SSH into Your EC2 Instance

First, find your SSH key file. It's probably in `~/.ssh/msfg-mortgage-key.pem` or similar.

```bash
# Try to find your key file
ls -la ~/.ssh/ | grep msfg

# If you find it, SSH in (use 'ec2-user' for Amazon Linux, 'ubuntu' for Ubuntu):
ssh -i ~/.ssh/msfg-mortgage-key.pem ec2-user@54.175.238.145

# OR if it's Ubuntu:
ssh -i ~/.ssh/msfg-mortgage-key.pem ubuntu@54.175.238.145
```

**If you don't have the key file:**
- You'll need to download it from AWS or create a new key pair

## Step 2: Install MySQL Client on EC2 (if needed)

Once connected to EC2, check if MySQL client is installed:

```bash
mysql --version
```

If not installed:

**For Amazon Linux:**
```bash
sudo yum update -y
sudo yum install mysql -y
```

**For Ubuntu:**
```bash
sudo apt-get update
sudo apt-get install mysql-client -y
```

## Step 3: Connect to RDS from EC2

From within your EC2 instance, connect to RDS:

```bash
mysql -h msfg-mortgage-db.cghqooasg1vk.us-east-1.rds.amazonaws.com -u admin -p -P 3306
```

Enter your RDS password when prompted.

---

## Alternative: Enable Public Access on RDS

If you prefer to connect directly from your computer, we can enable public accessibility on the RDS instance. However, this requires:
- RDS instance to be in a public subnet (with internet gateway)
- Security groups properly configured (already done)
- Slightly less secure (but still password protected)

Let me know which approach you prefer!

