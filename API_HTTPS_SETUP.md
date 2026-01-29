# Set Up HTTPS for API - Step by Step

## Prerequisites
- Access to your DNS provider (to create A record for api.msfgco.com)
- SSH access to EC2 instance

## Step 1: Create DNS A Record

In your DNS provider (Route 53 or wherever dashboard.msfgco.com is hosted):

1. Create new A record:
   - **Name:** `api` (or `api.msfgco.com` depending on your DNS provider)
   - **Type:** A
   - **Value:** `54.175.238.145` (your EC2 public IP)
   - **TTL:** 300 (or default)

2. Wait 5-10 minutes for DNS to propagate
3. Test: `ping api.msfgco.com` (should return your EC2 IP)

---

## Step 2: Install Nginx on EC2

SSH into your EC2 instance and run:

```bash
sudo apt-get update
sudo apt-get install -y nginx certbot python3-certbot-nginx
```

---

## Step 3: Configure Nginx Reverse Proxy

Create nginx configuration:

```bash
sudo nano /etc/nginx/sites-available/api
```

Paste this (replace `api.msfgco.com` if you used a different subdomain):

```nginx
server {
    listen 80;
    server_name api.msfgco.com;

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

Save and exit (Ctrl+X, Y, Enter)

Enable the site:

```bash
sudo ln -s /etc/nginx/sites-available/api /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default  # Remove default site
sudo nginx -t  # Test configuration
```

If test passes, restart nginx:

```bash
sudo systemctl restart nginx
sudo systemctl enable nginx  # Start on boot
```

---

## Step 4: Get SSL Certificate with Let's Encrypt

Run certbot:

```bash
sudo certbot --nginx -d api.msfgco.com
```

Follow the prompts:
- Enter your email address
- Agree to terms
- Choose whether to share email with EFF (your choice)
- It will automatically configure SSL!

---

## Step 5: Update Frontend Config

Update `msfg-dashboard/js/config.js`:

```javascript
api: {
    baseUrl: 'https://api.msfgco.com/api',
    // ... rest of config
}
```

---

## Step 6: Re-upload Frontend to S3

Run your upload script again to push the updated config.

---

## Step 7: Test

1. Go to: https://dashboard.msfgco.com
2. Open console and run:
   ```javascript
   fetch('https://api.msfgco.com/health')
     .then(r => r.json())
     .then(console.log)
   ```
3. Should work without mixed content errors!

---

## Verify Nginx is Working

After setup, test:

```bash
# Test HTTP redirects to HTTPS
curl -I http://api.msfgco.com/health

# Test HTTPS works
curl https://api.msfgco.com/health
```

---

## Auto-Renewal

Let's Encrypt certificates expire every 90 days. Certbot sets up auto-renewal, but verify:

```bash
sudo certbot renew --dry-run
```

This should pass. If it does, certificates will auto-renew!

