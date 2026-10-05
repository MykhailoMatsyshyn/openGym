/* Read-only Supabase source for the MCP server.
 *
 * When the api mirrors its DATA_DIR into Supabase (api/supabase-sync.js) and runs on a host
 * far away, this pulls db.json and the state-*.json files into a local cache folder and keeps
 * them fresh. state.js then reads that folder exactly as it reads a self-hosted ./data.
 * Nothing is ever written back: the only request this module makes is a GET. */
import fs from 'node:fs'
import path from 'node:path'

const URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '')
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const TABLE = process.env.SUPABASE_TABLE || 'opengym_files'
const PAGE = 1000
const NAME = /^(db\.json|state-[A-Za-z0-9_-]+\.json)$/

export const supabaseConfigured = () => !!(URL && KEY)

async function fetchRows() {
  const rows = []
  for (let from = 0; ; from += PAGE) {
    const q = `?select=name,content&or=(name.eq.db.json,name.like.state-*)&order=name&limit=${PAGE}&offset=${from}`
    const res = await fetch(`${URL}/rest/v1/${TABLE}${q}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } })
    if (!res.ok) throw new Error(`supabase: HTTP ${res.status} reading ${TABLE}`)
    const page = await res.json()
    rows.push(...page)
    if (page.length < PAGE) return rows
  }
}

// Writes only what changed, with the same temp-then-rename the api uses, so state.js's
// watcher sees one change per file and never a half-written one.
export async function pullSnapshot(dir) {
  fs.mkdirSync(dir, { recursive: true })
  let changed = 0
  for (const { name, content } of await fetchRows()) {
    if (!NAME.test(name)) continue
    const file = path.join(dir, name)
    let cur = null
    try { cur = fs.readFileSync(file, 'utf8') } catch { /* new */ }
    if (cur === content) continue
    fs.writeFileSync(file + '.tmp', content, { mode: 0o600 })
    fs.renameSync(file + '.tmp', file)
    changed++
  }
  return changed
}

export function startRefresh(dir, ms) {
  setInterval(() => {
    pullSnapshot(dir).catch(e => console.error(`[opengym-mcp] ${e.message}`))
  }, ms).unref()
}
