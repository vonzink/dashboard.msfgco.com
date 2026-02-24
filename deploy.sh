#!/usr/bin/env bash
# ============================================
# MSFG Dashboard Deploy Script
# Syncs frontend to S3 + invalidates CloudFront
# Optionally deploys backend to EC2
# ============================================
set -euo pipefail

# ── Config ──
S3_BUCKET="s3://dashboard.msfgco.com"
CF_DISTRIBUTION="E3QTH6K640MMKK"
EC2_HOST="ubuntu@54.175.238.145"
EC2_KEY="/Users/zacharyzink/MSFG/Security/msfg-mortgage-key.pem"
EC2_PROJECT_DIR="/home/ubuntu/dashboard.msfgco.com"

# ── Colors ──
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# ── Flags ──
DEPLOY_FRONTEND=true
DEPLOY_BACKEND=false

for arg in "$@"; do
  case $arg in
    --backend)  DEPLOY_BACKEND=true ;;
    --backend-only)  DEPLOY_FRONTEND=false; DEPLOY_BACKEND=true ;;
    --help|-h)
      echo "Usage: ./deploy.sh [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  (no flags)      Deploy frontend only (S3 + CloudFront)"
      echo "  --backend       Deploy both frontend AND backend"
      echo "  --backend-only  Deploy backend only (git pull + pm2 restart)"
      echo "  -h, --help      Show this help"
      exit 0
      ;;
    *)
      echo "Unknown option: $arg"
      exit 1
      ;;
  esac
done

echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}  MSFG Dashboard Deploy${NC}"
echo -e "${CYAN}========================================${NC}"
echo ""

# ── Frontend Deploy ──
if [ "$DEPLOY_FRONTEND" = true ]; then
  echo -e "${YELLOW}▸ Syncing frontend to S3...${NC}"
  aws s3 sync . "$S3_BUCKET" \
    --exclude "backend/*" \
    --exclude ".git/*" \
    --exclude "node_modules/*" \
    --exclude "*.sh" \
    --exclude ".env*" \
    --exclude ".claude/*" \
    --exclude "*.sql" \
    --exclude "*.md" \
    --exclude "*.txt" \
    --exclude "*.json" \
    --exclude ".gitignore" \
    --exclude ".DS_Store" \
    --exclude "s3-policy.json" \
    --exclude "trust-policy.json" \
    --exclude "cors-config.json" \
    --delete \
    --size-only

  echo -e "${GREEN}✓ S3 sync complete${NC}"
  echo ""

  echo -e "${YELLOW}▸ Invalidating CloudFront cache...${NC}"
  INVALIDATION_ID=$(aws cloudfront create-invalidation \
    --distribution-id "$CF_DISTRIBUTION" \
    --paths "/*" \
    --query 'Invalidation.Id' \
    --output text)

  echo -e "${GREEN}✓ CloudFront invalidation created: ${INVALIDATION_ID}${NC}"
  echo "  (Changes will propagate in ~30-60 seconds)"
  echo ""
fi

# ── Backend Deploy ──
if [ "$DEPLOY_BACKEND" = true ]; then
  echo -e "${YELLOW}▸ Deploying backend to EC2...${NC}"
  ssh -i "$EC2_KEY" "$EC2_HOST" bash -s <<'REMOTE'
    set -e
    cd /home/ubuntu/dashboard.msfgco.com
    echo "  Pulling latest from git..."
    git pull origin main
    echo "  Restarting backend with PM2..."
    cd backend
    npm install --production 2>/dev/null
    pm2 restart msfg-dashboard-api 2>/dev/null || pm2 start server.js --name msfg-dashboard-api
    echo "  Backend deploy complete."
REMOTE

  echo -e "${GREEN}✓ Backend deployed and restarted${NC}"
  echo ""
fi

# ── Summary ──
echo -e "${CYAN}========================================${NC}"
echo -e "${GREEN}  Deploy complete!${NC}"
[ "$DEPLOY_FRONTEND" = true ] && echo -e "  Frontend: ${GREEN}✓${NC} S3 + CloudFront"
[ "$DEPLOY_BACKEND" = true ]  && echo -e "  Backend:  ${GREEN}✓${NC} EC2 + PM2"
echo -e "${CYAN}========================================${NC}"
