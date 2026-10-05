#!/usr/bin/env bash
# Starts the MCP server against the Supabase copy of the data (mcp/src/supabase-pull.js).
# Reads SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY from api/.env.render (gitignored), so the key
# never lands in an MCP client's config file.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
set -a; . "$ROOT/api/.env.render"; set +a
exec node "$ROOT/mcp/src/index.js"
