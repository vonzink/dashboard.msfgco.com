#!/bin/bash
# Script to set up database from EC2 instance
# Run this ON your EC2 instance after SSHing in

echo "=== MSFG Database Setup Script ==="
echo ""

# Database connection details
DB_HOST="msfg-mortgage-db.cghqooasg1vk.us-east-1.rds.amazonaws.com"
DB_USER="admin"
DB_NAME="msfg_mortgage_db"

echo "Step 1: Installing MySQL client (if needed)..."
if ! command -v mysql &> /dev/null; then
    if [ -f /etc/redhat-release ]; then
        # Amazon Linux / RHEL
        sudo yum update -y
        sudo yum install mysql -y
    elif [ -f /etc/debian_version ]; then
        # Ubuntu / Debian
        sudo apt-get update
        sudo apt-get install mysql-client -y
    fi
else
    echo "MySQL client already installed"
fi

echo ""
echo "Step 2: Testing connection..."
echo "Please enter your RDS password when prompted:"
mysql -h "$DB_HOST" -u "$DB_USER" -p -e "SELECT 'Connection successful!' AS Status;" || {
    echo "Connection failed. Please check:"
    echo "1. Your RDS password is correct"
    echo "2. Security groups allow connections from EC2"
    exit 1
}

echo ""
echo "Step 3: Creating database..."
mysql -h "$DB_HOST" -u "$DB_USER" -p <<EOF
CREATE DATABASE IF NOT EXISTS $DB_NAME;
USE $DB_NAME;
SELECT 'Database created/selected' AS Status;
EOF

echo ""
echo "Step 4: Running schema script..."
echo "You'll need to upload DATABASE_SCHEMA.sql to EC2 first, then run:"
echo "mysql -h $DB_HOST -u $DB_USER -p $DB_NAME < DATABASE_SCHEMA.sql"
echo ""
echo "Or copy/paste the SQL from the file into MySQL"

echo ""
echo "=== Setup Complete ==="

