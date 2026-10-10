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

New project from this repo, **Root Directory `frontend`** with "include files outside the root" on (the build needs `api/coach/core`). In `frontend/vercel.json` replace
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
claude mcp add opengym -s user -e OPENGYM_UID=<id> -- $PWD/mcp/run-supabase.sh   # reads the key from api/.env.render
```

Add `-e OPENGYM_UID=<id>` when there is more than one profile.

### Remote MCP (claude.ai, Claude on the phone)

The api on Render also serves MCP over HTTP at `https://<api-host>/mcp/<MCP_TOKEN>`
(`mcp/src/http.js`, mounted in `api/server.js`; image `deploy/render-api.Dockerfile`).
Set `MCP_TOKEN` (64 random hex chars, in `api/.env.render`) on Render → Environment, then
claude.ai → Settings → Connectors → Add custom connector → Name `openGym`, URL as above.
Read-only. Anyone with the URL can read the data: keep it secret, change the token if it leaks.

## 7. Phone app (Android)

Built in the cloud by `.github/workflows/android-release.yml` — no Android Studio needed:

```bash
git tag v2.0.1 && git push origin v2.0.1     # → signed APK in GitHub Releases, ~10 min
```

- The tag is the version (`vX.Y.Z` → versionName X.Y.Z, versionCode X*10000+Y*100+Z). Every new
  tag must be higher than the last one.
- App id `com.mykhailomatsyshyn.opengym`, so it installs next to the official openGym app.
- First install: download the `.apk` from the release on the phone. After that the app finds
  updates itself (Settings) from this fork's releases (`frontend/src/lib/update.js`).
- Signing key: `~/.android-keystores/opengym/` (release.p12 + password.txt) and the repo secrets
  `ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`. **Back it up.** Without
  the same key no update installs over the app; only uninstall + reinstall (local data lost).
- Sync with the website: in the app, Settings → **Connect to my server** →
  `https://opengym-omega.vercel.app` + a pairing code from the web app.

Local build (needs Android Studio + Java 21): `cd frontend && npm run build:mobile && npx cap open android`.
iPhone without Xcode: Safari → Share → Add to Home Screen (PWA). More: [MOBILE.md](MOBILE.md).
