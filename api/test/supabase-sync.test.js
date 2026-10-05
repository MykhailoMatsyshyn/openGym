/* supabase-sync.js against a fake PostgREST: restore on boot, first-boot upload, and the mirror
   following writes and deletes in DATA_DIR. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const rows = new Map();
const fake = http.createServer(async (req, res) => {
  let body = '';
  for await (const c of req) body += c;
  const u = new URL(req.url, 'http://x');
  if (req.headers.apikey !== 'service-key') { res.writeHead(401).end('{}'); return; }
  if (req.method === 'GET') {
    const all = [...rows].map(([name, content]) => ({ name, content }));
    const from = +u.searchParams.get('offset'), n = +u.searchParams.get('limit');
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(all.slice(from, from + n)));
  } else if (req.method === 'POST') {
    for (const r of JSON.parse(body)) rows.set(r.name, r.content);
    res.writeHead(201).end();
  } else if (req.method === 'DELETE') {
    rows.delete(u.searchParams.get('name').replace(/^eq\./, ''));
    res.writeHead(204).end();
  }
});
await new Promise(r => fake.listen(0, '127.0.0.1', r));
process.env.SUPABASE_URL = `http://127.0.0.1:${fake.address().port}/`;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
const { supabaseConfigured, isTracked, hydrate, startMirror } = await import('../supabase-sync.js');
test.after(() => fake.close());

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'og-supa-'));
const waitFor = async (cond, ms = 3000) => {
  const end = Date.now() + ms;
  while (!cond()) { if (Date.now() > end) throw new Error('timed out'); await new Promise(r => setTimeout(r, 25)); }
};

test('only the state files are tracked', () => {
  assert.ok(supabaseConfigured());
  for (const f of ['db.json', 'secret', 'vapid.json', 'coach.json', 'state-u_1.json', 'coach/u_1.json', 'coach-auth-u_1.json']) assert.ok(isTracked(f), f);
  for (const f of ['db.json.tmp', 'audit.log', 'uploads/u_1/x.jpg', 'state-../x.json', 'coach/u_1.json.tmp']) assert.ok(!isTracked(f), f);
});

test('an empty table is the first boot: local files are uploaded', async () => {
  rows.clear();
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'db.json'), '{"users":[]}');
  fs.writeFileSync(path.join(dir, 'audit.log'), 'not state');
  await hydrate(dir);
  assert.deepEqual([...rows.keys()], ['db.json']);
});

test('a filled table is restored into an empty folder, and the mirror follows writes', async () => {
  rows.clear();
  rows.set('db.json', '{"users":[1]}');
  rows.set('secret', 'abc');
  rows.set('coach/u_1.json', '{"history":[]}');
  const dir = tmp();
  await hydrate(dir);
  assert.equal(fs.readFileSync(path.join(dir, 'db.json'), 'utf8'), '{"users":[1]}');
  assert.equal(fs.readFileSync(path.join(dir, 'coach/u_1.json'), 'utf8'), '{"history":[]}');

  const m = startMirror(dir);
  const f = path.join(dir, 'state-u_1.json');
  fs.writeFileSync(f + '.tmp', '{"_rev":1}');
  fs.renameSync(f + '.tmp', f);
  await waitFor(() => rows.get('state-u_1.json') === '{"_rev":1}');
  assert.ok(!rows.has('state-u_1.json.tmp'));

  fs.unlinkSync(f);
  await waitFor(() => !rows.has('state-u_1.json'));
  await m.stop();
});

test('a table that cannot be read stops the boot', async () => {
  fake.removeAllListeners('request');
  fake.on('request', (_q, res) => res.writeHead(500).end('down'));
  await assert.rejects(hydrate(tmp()), /HTTP 500/);
});
