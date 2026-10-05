-- openGym: the api's DATA_DIR mirrored as one row per file (api/supabase-sync.js).
create table if not exists public.opengym_files (
  name       text primary key,          -- e.g. db.json, state-<uid>.json, coach/<uid>.json
  content    text not null,             -- the file as written by the api (JSON, or the hex secret)
  updated_at timestamptz not null default now()
);

-- RLS on with no policies: only the service-role key (the api server) can read or write.
-- db.json holds passkey data and `secret` signs session cookies — never expose this table.
alter table public.opengym_files enable row level security;
