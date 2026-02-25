# HTTPS Setup - Step by Step

## Prerequisites

You need:
1. A subdomain for your API (e.g., `api.msfgco.com`)
2. Access to your DNS provider (to create A record)
3. SSH access to EC2 instance

---

## Step 1: Create DNS A Record

In your DNS provider (wherever `dashboard.msfgco.com` is hosted):

1. Create a new A record:
   - **Name/Host:** `api` (or `api.msfgco.com` depending on your DNS provider)
   - **Type:** A
   - **Value/Points to:** `54.175.238.145` (your EC2 public IP)
   - **TTL:** 300 (or default)

2. Wait 5-10 minutes for DNS propagation

3. Test DNS:
   ```bash
   ping api.msfgco.com
   # Should return: 54.175.238.145
   ```

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
- Agree to terms of service
- Choose whether to share email (your choice)
- Certbot will automatically configure SSL!

**Note:** Certbot will automatically modify your nginx config to add SSL.

---

## Step 5: Verify HTTPS Works

Test from your Mac:

```bash
curl https://api.msfgco.com/health
```

Should return: `{"status":"ok","timestamp":"..."}`

---

## Step 6: Update Frontend Config

The frontend config is already set up to use HTTPS when available:

```javascript
baseUrl: window.location.protocol === 'https:' 
    ? 'https://api.msfgco.com/api'
    : 'http://54.175.238.145:8080/api'
```

Just re-upload the frontend to S3:

```bash
cd /Users/zacharyzink/MSFG/index_page
./upload-to-s3.sh
```

---

## Step 7: Test End-to-End

1. Go to: https://dashboard.msfgco.com
2. Open browser console
3. Test API call:
   ```javascript
   fetch('https://api.msfgco.com/health')
     .then(r => r.json())
     .then(console.log)
   ```
4. Should work without mixed content errors!

---

## Auto-Renewal

Let's Encrypt certificates expire every 90 days. Certbot sets up auto-renewal automatically.

Test auto-renewal:

```bash
sudo certbot renew --dry-run
```

If this passes, certificates will auto-renew!

---

## Troubleshooting

### DNS not resolving
- Wait longer (up to 24 hours, but usually 5-10 minutes)
- Check DNS record is correct
- Try `dig api.msfgco.com` to check DNS

### Certbot fails
- Make sure DNS is resolving correctly first
- Make sure port 80 is open in EC2 security group
- Make sure nginx is running: `sudo systemctl status nginx`

### Nginx not starting
- Check config: `sudo nginx -t`
- Check logs: `sudo tail -f /var/log/nginx/error.log`
- Make sure port 80/443 are open in security group

