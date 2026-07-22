#!/usr/bin/env bash
# Push the Ask AI corpus to the msfg-dashboard brain's S3 source.
# After syncing, open the rag-brain console and hit "Sync now" on the
# msfg-dashboard brain to re-ingest.
set -euo pipefail
cd "$(dirname "$0")/.."

aws s3 sync docs/ask-ai-corpus/ s3://msfg.us/rag-brain-dashboard/ \
  --delete --region us-west-1 --exclude ".DS_Store"

echo ""
echo "Synced docs/ask-ai-corpus/ -> s3://msfg.us/rag-brain-dashboard/"
echo "NEXT: rag-brain console -> msfg-dashboard brain -> Sync now"
