# HTTPS Setup for Backend API

## Problem
Frontend is on HTTPS, but API is on HTTP. Browsers block mixed content.

## Solution: Nginx Reverse Proxy with Let's Encrypt SSL

### Step 1: Install Nginx on EC2

On your EC2 instance:
```bash
sudo apt-get update
sudo apt-get install -y nginx certbot python3-certbot-nginx
```

### Step 2: Configure Nginx

Create nginx config:
```bash
sudo nano /etc/nginx/sites-available/api
```

Paste this (replace YOUR_DOMAIN with your API domain, e.g., `api.msfgco.com`):
```nginx
server {
    listen 80;
    server_name YOUR_DOMAIN;

    location / {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Enable the site:
```bash
sudo ln -s /etc/nginx/sites-available/api /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### Step 3: Set up SSL with Let's Encrypt

```bash
sudo certbot --nginx -d YOUR_DOMAIN
```

Follow the prompts. This will automatically configure SSL.

### Step 4: Update Frontend Config

Update `js/config.js`:
```javascript
api: {
    baseUrl: 'https://YOUR_DOMAIN/api',
    // ...
}
```

### Step 5: Re-upload Frontend

Run your S3 upload script again.

---

## Alternative: Quick Test Solution (Development Only)

If you want to test immediately without SSL setup, you can temporarily:

1. Change your frontend config to use HTTP (not recommended for production)
2. Or use a browser extension to allow mixed content (Chrome: "Allow CORS" extension)

But HTTPS is required for production!

---

## Option 2: Use Application Load Balancer (More Robust)

This is better for production but more complex. It requires:
- Creating an ALB
- Getting an SSL certificate from ACM
- Setting up target group pointing to EC2
- Updating DNS to point to ALB

Let me know which approach you prefer!

