#!/usr/bin/env bash
# ============================================
# MSFG Dashboard Deploy Script
# Syncs frontend to S3 + invalidates CloudFront
# Optionally deploys backend to EC2
# ============================================
set -euo pipefail

# ── Ensure aws CLI is in PATH ──
export PATH="/opt/homebrew/bin:$PATH"

# ── Config ──
S3_BUCKET="s3://dashboard.msfgco.com"
CF_DISTRIBUTION="E3QTH6K640MMKK"
EC2_HOST="ubuntu@52.203.186.217"
EC2_KEY="/Users/zacharyzink/MSFG/Security/msfg-mortgage-key.pem"
EC2_PROJECT_DIR="/home/ubuntu/msfg-backend"

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
  # Regenerate scanner JS + vendor from the canonical ../msfg-scanner source
  # before pushing to S3. Keeps the fork surface to just the CSS + HTML shell.
  if [ -x "./sync-scanner.sh" ]; then
    ./sync-scanner.sh
    echo ""
  fi

  # Build step (audit §3.1): content-hash every js/css file and rewrite the
  # HTML to point at the hashed names. dist/ becomes the deployable tree.
  #
  # This replaces the old approach of hand-bumping ?v=... query strings in
  # the HTML and relying on the s3 sync --size-only heuristic, both of which
  # silently broke whenever a same-length version bump was made.
  echo -e "${YELLOW}▸ Building (content-hashing js/css, rewriting HTML)...${NC}"
  node build.js
  echo -e "${GREEN}✓ Build complete${NC}"
  echo ""

  echo -e "${YELLOW}▸ Syncing dist/ to S3...${NC}"
  # Cache-Control matters here: with no header, browsers heuristically cache
  # index.html and can keep serving a stale copy that references hashed
  # bundles a previous --delete removed — the 404'd scripts make every
  # data-action no-op silently (this broke the HR employee cards 2026-07-21).
  # HTML must always revalidate (no-cache + ETag = cheap 304); content-hashed
  # js/css never change under the same name, so they cache for a year.
  # Ordered so new HTML never references a not-yet-uploaded asset.

  # 1. Content-hashed js/css → long immutable cache
  aws s3 sync dist/ "$S3_BUCKET" \
    --exclude "*" \
    --include "js/*.??????????.js" \
    --include "css/*.??????????.css" \
    --cache-control "public,max-age=31536000,immutable"

  # 2. Everything else except HTML (vendor, assets, un-hashed scanner js, ...)
  aws s3 sync dist/ "$S3_BUCKET" --exclude "*.html"

  # 3. HTML → force-upload every deploy (sync would skip unchanged files,
  #    leaving stale metadata) with always-revalidate caching
  aws s3 cp dist/ "$S3_BUCKET" --recursive \
    --exclude "*" \
    --include "*.html" \
    --cache-control "no-cache"

  # 4. Remove orphaned files from previous deploys (old hashed bundles)
  aws s3 sync dist/ "$S3_BUCKET" --delete
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
    cd /home/ubuntu/msfg-backend
    echo "  Pulling latest from git..."
    # npm install --production rewrites backend/package-lock.json on EC2,
    # which conflicts with the lockfile committed from a dev machine on the
    # next pull. Discard the EC2-local lockfile changes first.
    git checkout -- backend/package-lock.json 2>/dev/null || true
    git pull origin main
    echo "  Restarting backend with PM2..."
    cd backend
    npm install --production 2>/dev/null
    pm2 restart msfg-backend 2>/dev/null || pm2 start server.js --name msfg-backend
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
