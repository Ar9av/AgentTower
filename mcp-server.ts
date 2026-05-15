#!/usr/bin/env ts-node
/**
 * AgentTower MCP Server
 *
 * Exposes Claude Code session history as MCP tools so Claude Code can
 * query your own past conversations for context.
 *
 * Usage (stdio transport, no HTTP auth needed since it's local):
 *   npm run mcp
 *
 * Add to ~/.config/claude/settings.local.json:
 *   {
 *     "mcpServers": {
 *       "agenttower": {
 *         "command": "npx",
 *         "args": ["ts-node", "--transpile-only", "/path/to/agenttower/mcp-server.ts"]
 *       }
 *     }
 *   }
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import {
  discoverProjects,
  listSessions,
  parseJsonlFile,
  searchSessions,
  getRecentSessions,
  findSessionByPrefix,
} from './lib/claude-fs'
import { sessionToMarkdown } from './lib/export-utils'

const server = new Server(
  { name: 'agenttower', version: '1.0.0' },
  { capabilities: { tools: {} } }
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'list_projects',
      description: 'List all Claude Code projects with session counts and last-active time.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'list_recent_sessions',
      description: 'List the most recent sessions across all projects.',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max sessions to return (default 20)' },
        },
      },
    },
    {
      name: 'search_sessions',
      description: 'Full-text search across all Claude Code session history.',
      inputSchema: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string', description: 'Search query' },
          project: { type: 'string', description: 'Optional project dirName to scope the search' },
          regex: { type: 'boolean', description: 'Treat query as a regex (default false)' },
        },
      },
    },
    {
      name: 'get_session',
      description: 'Retrieve a specific session by ID (or prefix). Returns messages as markdown or JSON.',
      inputSchema: {
        type: 'object',
        required: ['session_id'],
        properties: {
          session_id: { type: 'string', description: 'Session UUID or prefix' },
          format: { type: 'string', enum: ['markdown', 'json'], description: 'Output format (default markdown)' },
        },
      },
    },
  ],
}))

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params

  if (name === 'list_projects') {
    const projects = discoverProjects()
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(projects.map(p => ({
          dirName: p.dirName,
          displayName: p.displayName,
          sessionCount: p.sessionCount,
          latestMtime: new Date(p.latestMtime).toISOString(),
          hasActive: p.hasActive,
        })), null, 2),
      }],
    }
  }

  if (name === 'list_recent_sessions') {
    const limit = typeof args?.limit === 'number' ? args.limit : 20
    const sessions = getRecentSessions(limit)
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(sessions.map(s => ({
          sessionId: s.sessionId,
          project: s.projectDisplayName,
          firstPrompt: s.firstPrompt,
          mtime: new Date(s.mtime).toISOString(),
          isActive: s.isActive,
        })), null, 2),
      }],
    }
  }

  if (name === 'search_sessions') {
    if (!args?.query || typeof args.query !== 'string') {
      throw new Error('query is required')
    }
    const results = searchSessions(args.query, {
      projectDirName: typeof args.project === 'string' ? args.project : undefined,
      regex: args.regex === true,
    })
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(results.map(r => ({
          sessionId: r.sessionId,
          project: r.projectDirName,
          context: r.context,
          timestamp: r.timestamp,
          msgUuid: r.msgUuid,
        })), null, 2),
      }],
    }
  }

  if (name === 'get_session') {
    if (!args?.session_id || typeof args.session_id !== 'string') {
      throw new Error('session_id is required')
    }
    const found = findSessionByPrefix(args.session_id)
    if (!found) {
      return { content: [{ type: 'text', text: `Session not found: ${args.session_id}` }], isError: true }
    }
    const messages = parseJsonlFile(found.filepath)
    const format = args.format === 'json' ? 'json' : 'markdown'
    const text = format === 'json'
      ? JSON.stringify(messages.slice(-100), null, 2)
      : sessionToMarkdown(messages, found.sessionId)
    return { content: [{ type: 'text', text }] }
  }

  throw new Error(`Unknown tool: ${name}`)
})

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch(err => {
  process.stderr.write(`MCP server error: ${err}\n`)
  process.exit(1)
})
