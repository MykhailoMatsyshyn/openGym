#!/usr/bin/env node
/* openGym MCP server — stdio transport. The LLM client (Claude Desktop, Cursor, …) spawns
   this process locally, talks JSON-RPC over stdin/stdout, tears it down when the session ends.
   No extra container, no new outbound network — your data stays in a folder you control. */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import os from 'node:os'
import path from 'node:path'
import { supabaseConfigured, pullSnapshot, startRefresh } from './supabase-pull.js'
import { createMcpServer } from './server.js'

// Data in Supabase (api/supabase-sync.js): pull it into a local cache before state.js, which
// reads OPENGYM_DATA when it is first imported — hence the dynamic imports below.
if (supabaseConfigured()) {
  const dir = process.env.OPENGYM_DATA ||= path.join(os.homedir(), '.cache', 'opengym-mcp')
  try { await pullSnapshot(dir); console.error(`[opengym-mcp] Supabase snapshot in ${dir}`) }
  catch (e) { console.error(`[opengym-mcp] ${e.message}`) }
  startRefresh(dir, 60_000)
}
const { TOOLS } = await import('./tools.js')
const { init, getUser } = await import('./state.js')

// Fail fast on bad config so a misnamed OPENGYM_DATA doesn't silently answer every call with
// the no-state sentinel. Always register every tool so the LLM sees the full list at
// handshake, even when state didn't resolve.
try {
  init()
  const u = getUser()
  console.error(`[opengym-mcp] serving profile ${u.name} (${u.id})`)
} catch (e) {
  console.error(`[opengym-mcp] ${e.message}`)
  // Don't exit — keep the tool listings up so the user sees a useful error after fixing their
  // env and restarting.
}

const server = createMcpServer(TOOLS)

const transport = new StdioServerTransport()
await server.connect(transport)
// Process stays alive serving JSON-RPC over stdio until the LLM client disconnects.
