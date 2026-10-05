# My fork: local dev, Supabase, Vercel, phone app

What this fork adds on top of upstream openGym, and how to run it.

```
Vercel (frontend)  ──rewrite /api/*──>  Railway/Render (api, Docker)  ──>  Supabase (table opengym_files)
                                                                              ▲
                                       MCP on my Mac (read-only snapshot) ────┘
```

## 1. Local development

```bash
cp api/.env.dev.example api/.env.dev   # optional: Supabase + ADMIN_UIDS
./scripts/dev.sh                       # api :3000 + Vite :5173 with hot reload
```

Open http://localhost:5173. Data is in `api/data/` (gitignored). Password sign-in is on in dev.
Exercise images come from the jsDelivr CDN, so there is nothing to download.

Get updates from the original project:

```bash
git fetch upstream && git merge upstream/main
```

## 2. Supabase

1. Create a project at supabase.com.
2. SQL Editor → run `supabase/migrations/20261005000000_opengym_files.sql`.
3. Project Settings → API: copy the **Project URL** and the **service_role** key.

How it works (`api/supabase-sync.js`): the api still works on JSON files. On boot it restores
them from the table; after that every change in `DATA_DIR` is upserted to the table. With an
empty table, the first boot uploads the local files (a simple way to migrate existing data).

Rules:
- The `service_role` key is a server secret. Never put it in the frontend or in git.
- One api process per table. Local dev uses `SUPABASE_TABLE=opengym_files_dev`.
- Not mirrored yet: `uploads/` (photos/videos of custom exercises) and `audit.log`.

## 3. Backend on Railway (or Render / Fly)

New service from this GitHub repo, **root directory `api`**, it builds `api/Dockerfile`.
Environment variables:

| Variable | Value |
|---|---|
| `ORIGIN` | `https://<my-app>.vercel.app` (the address people open) |
| `RP_ID` | `<my-app>.vercel.app` (no `https://`) |
| `DATA_DIR` | `/data` |
| `TRUST_PROXY` | `1` |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | from step 2 |
| `ADMIN_UIDS` | my user id (after the first sign-in, from the table row `db.json`) |
| `PASSWORD_LOGIN` | `1` if I want name + password next to passkeys |

Railway sets `PORT` itself. Check: `https://<api-host>/api/health` → `{"ok":true,...}`.

## 4. Frontend on Vercel

New project from this repo, **root directory `frontend`**. In `frontend/vercel.json` replace
`REPLACE-WITH-API-HOST` with the Railway host. Passkeys need one origin, and the rewrite keeps
`/api` on the Vercel domain.

## 5. AI coach

No code needed. Sign in → Settings → Admin dashboard → AI Coach → pick a provider
(Anthropic / OpenAI / Gemini / OpenAI-compatible) → paste the API key → Test → turn on.
The key is encrypted into `coach.json`, which is mirrored to Supabase like the rest.
Details: [AI_COACH.md](AI_COACH.md).

## 6. MCP (Claude Desktop / Claude Code)

Local data:

```bash
claude mcp add opengym -e OPENGYM_DATA=$PWD/api/data -- node $PWD/mcp/src/index.js
```

Data in Supabase: the MCP pulls a read-only snapshot into `~/.cache/opengym-mcp` and refreshes it
every minute (`mcp/src/supabase-pull.js`):

```bash
claude mcp add opengym -e SUPABASE_URL=... -e SUPABASE_SERVICE_ROLE_KEY=... -- node $PWD/mcp/src/index.js
```

Add `-e OPENGYM_UID=<id>` when there is more than one profile.

## 7. Phone app (Android)

Needs Android Studio + Java 21. Every change I make in `frontend/` goes into the app on rebuild:

```bash
cd frontend
npm run build:mobile     # build + copy into android/ and ios/
npx cap open android     # Run on the phone, or Build → Build APK(s)
```

In the app: Settings → **Connect to my server** → `https://<my-app>.vercel.app` and a pairing
code from the web app. iPhone: Xcode (free Apple ID = reinstall every 7 days), or use the PWA
from Safari → Add to Home Screen. More: [MOBILE.md](MOBILE.md).
