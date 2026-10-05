#!/usr/bin/env bash
# Local development: api on :3000 + Vite (hot reload) on :5173. Ctrl+C stops both.
# Data goes to api/data (gitignored). Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in api/.env.dev
# to mirror it into Supabase — use a separate table (SUPABASE_TABLE) from production.
set -euo pipefail
cd "$(dirname "$0")/.."

CDN=https://cdn.jsdelivr.net/gh/hasaneyldrm/exercises-dataset@7455efae41b330c265e7cd4b78dfa848e7ce5ebd
[ -f api/.env.dev ] && set -a && . api/.env.dev && set +a

(cd api && DATA_DIR="${DATA_DIR:-./data}" PORT=3000 RP_ID=localhost ORIGIN=http://localhost:5173 \
  PASSWORD_LOGIN="${PASSWORD_LOGIN:-1}" node server.js) &
API=$!
trap 'kill $API 2>/dev/null' EXIT

cd frontend
API_ORIGIN=http://localhost:5173 VITE_IMG_BASE=$CDN/images/ VITE_GIF_BASE=$CDN/videos/ \
  npx vite --port 5173 --strictPort
