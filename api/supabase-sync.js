/* Optional Supabase mirror of DATA_DIR.
 *
 * The api keeps working on its JSON files exactly as before: every read and the revision check
 * in PUT /api/data stay synchronous. This module only makes those files survive a host whose
 * disk is thrown away on every deploy (Railway, Render, Fly without a volume):
 *
 *   boot   — hydrate(): pull every row of the table into DATA_DIR before server.js reads it.
 *            An empty table is the first boot: the local files (if any) are uploaded instead.
 *   run    — startMirror(): fs.watch on DATA_DIR, each tracked file that changes is upserted
 *            (or deleted) a moment later. A periodic scan catches anything the watcher missed.
 *   stop   — SIGTERM/SIGINT wait for the pending uploads before the process exits.
 *
 * One api process per table. Two processes on the same table overwrite each other's files —
 * give a local dev server its own table (SUPABASE_TABLE) or no Supabase at all.
 *
 * Only the server talks to Supabase, with the service-role key. The table has RLS on and no
 * policies (supabase/migrations), so the anon key reads nothing: db.json holds passkey data and
 * `secret` signs every session cookie. Uploaded photos and videos (uploads/) are not mirrored. */
import fs from 'node:fs';
import path from 'node:path';

const URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const TABLE = process.env.SUPABASE_TABLE || 'opengym_files';
const DEBOUNCE_MS = 300;
const RETRY_MS = 5000;
const SCAN_MS = 30000;
const PAGE = 1000;

export const supabaseConfigured = () => !!(URL && KEY);

// The files that are the instance's state. Temp files, the audit log and uploads/ are not.
const TRACKED = /^(db\.json|secret|vapid\.json|coach\.json|state-[A-Za-z0-9_-]+\.json|coach-auth-[A-Za-z0-9_-]+\.json|coach\/[A-Za-z0-9_-]+\.json)$/;
export const isTracked = rel => TRACKED.test(rel);
const rel = (dir, file) => path.relative(dir, file).split(path.sep).join('/');

async function rest(method, query, body, prefer) {
  const res = await fetch(`${URL}/rest/v1/${TABLE}${query}`, {
    method,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`supabase ${method} ${TABLE}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return method === 'GET' ? res.json() : null;
}

const upsert = (name, content) =>
  rest('POST', '?on_conflict=name', [{ name, content, updated_at: new Date().toISOString() }], 'resolution=merge-duplicates,return=minimal');
const remove = name => rest('DELETE', `?name=eq.${encodeURIComponent(name)}`);

function localFiles(dir) {
  const out = [];
  for (const sub of ['', 'coach']) {
    let names = [];
    try { names = fs.readdirSync(path.join(dir, sub)); } catch { continue; }
    for (const n of names) {
      const r = sub ? `${sub}/${n}` : n;
      if (isTracked(r)) out.push(r);
    }
  }
  return out;
}

// What was last sent per file, so a scan or a duplicate watch event uploads nothing.
const sent = new Map();

/* Fails loudly rather than booting on an empty folder: a server that started with no db.json
   would write a fresh one, and the mirror would then overwrite every profile in the table. */
export async function hydrate(dir) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const page = await rest('GET', `?select=name,content&order=name&limit=${PAGE}&offset=${from}`);
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  if (!rows.length) {
    const files = localFiles(dir);
    for (const r of files) {
      const content = fs.readFileSync(path.join(dir, r), 'utf8');
      await upsert(r, content);
      sent.set(r, content);
    }
    console.log(`supabase: table ${TABLE} was empty — uploaded ${files.length} local file(s)`);
    return;
  }
  for (const { name, content } of rows) {
    if (!isTracked(name)) continue;
    const file = path.join(dir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, { mode: 0o600 });
    sent.set(name, content);
  }
  // Files only this disk has (a profile created while Supabase was off) go up too.
  for (const r of localFiles(dir)) {
    if (!sent.has(r)) {
      const content = fs.readFileSync(path.join(dir, r), 'utf8');
      await upsert(r, content);
      sent.set(r, content);
    }
  }
  console.log(`supabase: restored ${rows.length} file(s) from ${TABLE}`);
}

export function startMirror(dir) {
  const timers = new Map();
  let chain = Promise.resolve();   // one request at a time keeps the order of writes per file

  const flush = r => {
    chain = chain.then(async () => {
      let content = null;
      try { content = fs.readFileSync(path.join(dir, r), 'utf8'); } catch { /* deleted */ }
      if (content === sent.get(r)) return;
      try {
        if (content === null) { await remove(r); sent.delete(r); }
        else { await upsert(r, content); sent.set(r, content); }
      } catch (e) {
        console.error(`supabase: could not sync ${r} — retrying`, e.message);
        schedule(r, RETRY_MS);
      }
    });
    return chain;
  };
  const schedule = (r, ms = DEBOUNCE_MS) => {
    clearTimeout(timers.get(r));
    timers.set(r, setTimeout(() => { timers.delete(r); flush(r); }, ms));
  };

  const watcher = fs.watch(dir, { recursive: true }, (_ev, filename) => {
    if (!filename) return;
    const r = rel(dir, path.join(dir, filename.toString()));
    if (isTracked(r)) schedule(r);
  }).on('error', e => console.error('supabase: watcher error', e.message));

  const scan = setInterval(() => {
    const seen = new Set(localFiles(dir));
    for (const r of seen) schedule(r);
    for (const r of sent.keys()) if (!seen.has(r)) schedule(r);
  }, SCAN_MS).unref();

  const drain = async () => {
    for (const [r, t] of timers) { clearTimeout(t); timers.delete(r); flush(r); }
    await chain;
  };
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.once(sig, async () => {
      const giveUp = setTimeout(() => process.exit(0), 8000);
      try { await drain(); } finally { clearTimeout(giveUp); process.exit(0); }
    });
  }
  console.log(`supabase: mirroring ${dir} → ${TABLE}`);
  const stop = async () => { watcher.close(); clearInterval(scan); await drain(); };
  return { drain, stop };
}
