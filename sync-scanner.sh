#!/usr/bin/env bash
# ============================================
# Sync scanner JS + vendor from ../msfg-scanner
# ============================================
# The scanner's authoritative source lives in the sibling ../msfg-scanner repo.
# This script regenerates the dashboard's copy by:
#   - rsync'ing vendor/ (byte-identical in both trees)
#   - transforming each main-thread module into a dashboard-prefixed copy
#   - copying cv-worker.js verbatim as scanner-worker.js
#
# Module list: MAIN_MODULES below lists every main-thread .js file. Each one
# is transformed and written as js/scanner-<name>.js. Add new modules here
# as the source tree grows.
#
# CSS and HTML are NOT synced — they are legitimate forks. The dashboard's
# scanner.css uses dashboard design tokens and is scoped under .sc-page;
# scanner.html embeds in the dashboard shell with auth-gate + nav.
#
# Run this before deploy. deploy.sh calls it automatically.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="${SCRIPT_DIR}/../msfg-scanner"
DST="${SCRIPT_DIR}"

# ── Colors ──
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

if [ ! -d "$SRC" ]; then
  echo -e "${RED}Error: canonical scanner source not found at $SRC${NC}" >&2
  echo "This script expects ../msfg-scanner to be checked out as a sibling." >&2
  exit 1
fi

echo -e "${YELLOW}▸ Syncing scanner assets from $SRC${NC}"

# ── 1. Vendor/ — rsync verbatim ──
rsync -a --delete \
  "$SRC/vendor/opencv/"    "$DST/vendor/opencv/"
rsync -a --delete \
  "$SRC/vendor/pdfjs/"     "$DST/vendor/pdfjs/"
rsync -a --delete \
  "$SRC/vendor/heic2any/"  "$DST/vendor/heic2any/"
echo "  vendor/: synced (opencv, pdfjs, heic2any)"

GENERATED_BANNER='// ─────────────────────────────────────────────────────────────────
// GENERATED FILE — DO NOT EDIT
// Source:    ../msfg-scanner/js/__SOURCE__
// Generator: dashboard.msfgco.com/sync-scanner.sh
// Edits will be overwritten on next deploy.
// ─────────────────────────────────────────────────────────────────
'

# ── 2. Main-thread modules → js/scanner-<name>.js ──
# Transforms applied to every module:
#   'vendor/...'            → '/vendor/...'          (absolute paths for dashboard root)
#   '.zoom-toolbar'         → '.sc-zoom-toolbar'     (class prefix)
#   '.adj-value'            → '.sc-adj-value'        (class prefix, 2 forms)
#   'js/cv-worker.js'       → 'js/scanner-worker.js' (only matters in main.js)
#   from './<mod>.js'       → from './scanner-<mod>.js' (local ES module imports)
#
# Add modules to this list as the scanner source tree grows. Order doesn't
# matter — ES module imports resolve by name, not load order.
MAIN_MODULES=(main.js util.js decoders.js adjust.js viewport.js)

for mod in "${MAIN_MODULES[@]}"; do
  out="scanner-${mod}"
  {
    echo "${GENERATED_BANNER//__SOURCE__/$mod}"
    sed -E \
      -e "s|'vendor/|'/vendor/|g" \
      -e "s|'\\.zoom-toolbar'|'.sc-zoom-toolbar'|g" \
      -e "s|\\.adj-value\\[|.sc-adj-value[|g" \
      -e "s|'\\.adj-value'|'.sc-adj-value'|g" \
      -e "s|'js/cv-worker\\.js'|'js/scanner-worker.js'|g" \
      -e "s|from '\\./([A-Za-z0-9_-]+)\\.js'|from './scanner-\\1.js'|g" \
      "$SRC/js/$mod"
  } > "$DST/js/$out"
  echo "  js/$out: regenerated"
done

# ── 3. js/cv-worker.js → js/scanner-worker.js verbatim ──
{
  echo "${GENERATED_BANNER//__SOURCE__/cv-worker.js}"
  cat "$SRC/js/cv-worker.js"
} > "$DST/js/scanner-worker.js"
echo "  js/scanner-worker.js: copied"

echo -e "${GREEN}✓ Scanner sync complete${NC}"
