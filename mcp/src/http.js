/* Remote MCP over Streamable HTTP, for clients that only take a URL (claude.ai custom
   connectors, Claude on the phone). The api mounts it in its own process (api/server.js,
   MCP_TOKEN), so it reads the very DATA_DIR the api writes — no copy, no second service.
   Stateless: every POST gets a fresh server + transport, nothing is kept between requests,
   which is what a host that sleeps and restarts (Render free) needs. Read-only like the stdio
   entry: the tools only read state-<uid>.json and db.json. */
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createMcpServer } from './server.js'

export async function createMcpHttpHandler({ dataDir }) {
  // state.js reads OPENGYM_DATA when it is first imported.
  process.env.OPENGYM_DATA = dataDir
  const { TOOLS } = await import('./tools.js')
  const { init } = await import('./state.js')

  return async function handleMcp(req, res) {
    // A profile created after boot is picked up on the next call; until then the tools answer
    // with their own "no state" message instead of failing the request.
    try { init() } catch { /* no profile yet */ }
    const server = createMcpServer(TOOLS)
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    res.on('close', () => { transport.close(); server.close() })
    await server.connect(transport)
    await transport.handleRequest(req, res)
  }
}
