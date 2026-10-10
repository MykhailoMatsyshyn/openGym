/* The MCP server with every openGym tool registered — shared by the stdio entry (index.js) and
   the remote HTTP entry (http.js), so both answer with exactly the same tools. */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

export function createMcpServer(tools) {
  const server = new McpServer({ name: 'opengym', version: '0.1.0' })
  for (const t of tools) {
    server.tool(t.name, t.description, t.schema, async (params) => {
      try {
        const result = t.handler(params || {})
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
      } catch (err) {
        return { isError: true, content: [{ type: 'text', text: `${err.code || 'ERROR'}: ${err.message}` }] }
      }
    })
  }
  return server
}
