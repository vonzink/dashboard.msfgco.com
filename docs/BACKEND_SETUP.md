# MSFG Dashboard Backend Setup Guide

## Architecture Overview

- **Database**: MySQL Aurora RDS (`msfg-mortgage-db`)
- **Application Server**: EC2 (`msfg-mortgage-app`) - 54.175.238.145
- **File Storage**: S3 bucket (to be configured)
- **Backend Framework**: Spring Boot (recommended) or Node.js/Express

---

## Step 1: Database Setup

### Connect to RDS Database

```bash
# From your EC2 instance or locally
mysql -h msfg-mortgage-db.xxxxxxxxx.us-east-1.rds.amazonaws.com \
      -u admin \
      -p \
      msfg_mortgage_db
```

### Create Database

```sql
CREATE DATABASE IF NOT EXISTS msfg_mortgage_db;
USE msfg_mortgage_db;
```

### Run Schema Script

Execute the `DATABASE_SCHEMA.sql` file to create all tables.

---

## Step 2: S3 Bucket Setup

### Create S3 Bucket for File Storage

```bash
aws s3 mb s3://msfg-dashboard-files --region us-east-1
```

### Configure CORS for File Uploads

Create `cors-config.json`:
```json
{
  "CORSRules": [
    {
      "AllowedOrigins": ["*"],
      "AllowedMethods": ["GET", "PUT", "POST", "DELETE"],
      "AllowedHeaders": ["*"],
      "ExposeHeaders": ["ETag"],
      "MaxAgeSeconds": 3000
    }
  ]
}
```

Apply CORS:
```bash
aws s3api put-bucket-cors --bucket msfg-dashboard-files --cors-configuration file://cors-config.json
```

### Create IAM Policy for EC2 Instance

Allow EC2 to access S3:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject"
      ],
      "Resource": "arn:aws:s3:::msfg-dashboard-files/*"
    }
  ]
}
```

Attach to EC2 instance role.

---

## Step 3: Spring Boot Backend Setup (Recommended)

### Project Structure

```
msfg-backend/
├── src/
│   └── main/
│       └── java/
│           └── com/
│               └── msfg/
│                   └── dashboard/
│                       ├── DashboardApplication.java
│                       ├── config/
│                       │   ├── DatabaseConfig.java
│                       │   ├── S3Config.java
│                       │   └── SecurityConfig.java
│                       ├── controller/
│                       │   ├── InvestorController.java
│                       │   ├── AnnouncementController.java
│                       │   ├── NotificationController.java
│                       │   ├── GoalController.java
│                       │   └── FileController.java
│                       ├── service/
│                       │   ├── InvestorService.java
│                       │   ├── AnnouncementService.java
│                       │   ├── NotificationService.java
│                       │   ├── GoalService.java
│                       │   └── S3Service.java
│                       ├── repository/
│                       │   ├── InvestorRepository.java
│                       │   ├── AnnouncementRepository.java
│                       │   ├── NotificationRepository.java
│                       │   └── GoalRepository.java
│                       └── model/
│                           ├── Investor.java
│                           ├── Announcement.java
│                           ├── Notification.java
│                           └── Goal.java
├── pom.xml
└── application.properties
```

### application.properties

```properties
# Database Configuration
spring.datasource.url=jdbc:mysql://msfg-mortgage-db.xxxxxxxxx.us-east-1.rds.amazonaws.com:3306/msfg_mortgage_db
spring.datasource.username=admin
spring.datasource.password=${DB_PASSWORD}
spring.datasource.driver-class-name=com.mysql.cj.jdbc.Driver

# JPA Configuration
spring.jpa.hibernate.ddl-auto=none
spring.jpa.show-sql=true
spring.jpa.properties.hibernate.dialect=org.hibernate.dialect.MySQL8Dialect

# S3 Configuration
aws.s3.bucket=msfg-dashboard-files
aws.s3.region=us-east-1

# Server Configuration
server.port=8080
server.address=0.0.0.0

# CORS
spring.web.cors.allowed-origins=*
spring.web.cors.allowed-methods=GET,POST,PUT,DELETE,OPTIONS
spring.web.cors.allowed-headers=*

# File Upload
spring.servlet.multipart.max-file-size=10MB
spring.servlet.multipart.max-request-size=10MB
```

---

## Step 4: EC2 Instance Setup

### SSH into EC2

```bash
ssh -i msfg-mortgage-key.pem ec2-user@54.175.238.145
```

### Install Java (for Spring Boot)

```bash
sudo yum update -y
sudo yum install java-17-amazon-corretto -y
```

### Install Node.js (alternative backend)

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 18
nvm use 18
```

### Install MySQL Client (for testing)

```bash
sudo yum install mysql -y
```

### Install Nginx (Reverse Proxy - Optional but Recommended)

```bash
sudo yum install nginx -y
sudo systemctl start nginx
sudo systemctl enable nginx
```

### Configure Security Group

Ensure these ports are open:
- Port 22 (SSH)
- Port 8080 (Spring Boot) or 3000 (Node.js)
- Port 80/443 (if using Nginx)

---

## Step 5: Deploy Backend Application

### Option A: Spring Boot JAR

```bash
# Build JAR locally or on EC2
mvn clean package

# Copy to EC2
scp -i msfg-mortgage-key.pem target/dashboard-0.0.1-SNAPSHOT.jar ec2-user@54.175.238.145:/home/ec2-user/

# Run on EC2
java -jar dashboard-0.0.1-SNAPSHOT.jar

# Or run as service
sudo systemctl create dashboard.service
```

### Option B: Node.js/Express

```bash
# Install PM2
npm install -g pm2

# Start application
pm2 start server.js
pm2 save
pm2 startup
```

---

## Step 6: Environment Variables

Create `.env` file on EC2:

```bash
DB_HOST=msfg-mortgage-db.xxxxxxxxx.us-east-1.rds.amazonaws.com
DB_NAME=msfg_mortgage_db
DB_USER=admin
DB_PASSWORD=your_password
AWS_REGION=us-east-1
S3_BUCKET=msfg-dashboard-files
JWT_SECRET=your_jwt_secret_key
ADMIN_EMAILS=zachary.zink@msfg.us
```

---

## Step 7: Testing

### Test Database Connection

```bash
mysql -h msfg-mortgage-db.xxxxxxxxx.us-east-1.rds.amazonaws.com \
      -u admin \
      -p \
      msfg_mortgage_db \
      -e "SELECT 1"
```

### Test API Endpoint

```bash
curl http://54.175.238.145:8080/api/investors
```

---

## Step 8: Frontend Configuration

Update `js/config.js`:

```javascript
api: {
    baseUrl: 'http://54.175.238.145:8080/api',
    timeout: 30000
}
```

Or use environment variable:
```javascript
api: {
    baseUrl: process.env.API_URL || 'http://54.175.238.145:8080/api',
    timeout: 30000
}
```

---

## Next Steps

1. ✅ Set up database schema
2. ✅ Configure S3 bucket
3. ✅ Deploy backend application
4. ✅ Update frontend API configuration
5. ✅ Test all endpoints
6. ✅ Set up authentication (JWT)
7. ✅ Configure SSL/TLS (CloudFront or Let's Encrypt)
8. ✅ Set up monitoring and logging

---

## Security Recommendations

1. **Use environment variables** for sensitive data (DB passwords, AWS keys)
2. **Enable SSL/TLS** for API endpoints
3. **Implement authentication** (JWT tokens)
4. **Use IAM roles** instead of access keys when possible
5. **Enable database backups** in RDS
6. **Configure CloudWatch** for monitoring
7. **Use Security Groups** to restrict access
8. **Regular security updates** on EC2 instance

