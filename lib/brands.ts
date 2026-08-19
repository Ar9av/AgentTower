/**
 * Resolves the things AgentTower displays — MCP servers, tool calls, agent
 * types, session providers, integrations — onto a cached svgl logo slug.
 *
 * The slugs live in lib/brand-manifest.ts, which `npm run icons` regenerates
 * from https://api.svgl.app. Anything we cannot place resolves to `null` so the
 * caller can fall back to a lucide glyph rather than render a broken image.
 */
import { BRAND_MANIFEST, isBrandName, type BrandName } from './brand-manifest'

export type { BrandName }
export { BRAND_MANIFEST, isBrandName }

/**
 * Tokens that carry no brand meaning in an MCP server name. `claude` and `ai`
 * are here because hosted connectors are namespaced `claude_ai_<Service>` —
 * keeping them would make every connector resolve to the Claude logo.
 */
const NOISE = new Set([
  'mcp', 'claude', 'ai', 'plugin', 'server', 'servers', 'official', 'remote',
  'local', 'connector', 'tool', 'tools', 'io', 'com', 'app', 'inc', 'the',
])

/**
 * Ordered substring → slug rules, matched against the de-noised server name
 * with separators removed. Order is significant: longer, more specific keys
 * must come first so `googledrive` never falls through to `google`, and
 * `github` never falls through to `git`.
 */
const ALIASES: ReadonlyArray<readonly [string, BrandName]> = [
  // Multi-word services first
  ['googledrive', 'googledrive'],
  ['gdrive', 'googledrive'],
  ['googlecalendar', 'googlecalendar'],
  ['gcal', 'googlecalendar'],
  ['googlesheets', 'googlesheets'],
  ['googlemaps', 'googlemaps'],
  ['googlecloud', 'gcp'],
  ['stackoverflow', 'stackoverflow'],
  ['sourcegraph', 'sourcegraph'],
  ['cloudflare', 'cloudflare'],
  ['planetscale', 'planetscale'],
  ['huggingface', 'huggingface'],
  ['openrouter', 'openrouter'],
  ['opencode', 'opencode'],
  ['openclaw', 'openclaw'],
  ['kilocode', 'kilocode'],
  ['langchain', 'langchain'],
  ['playwright', 'playwright'],
  ['puppeteer', 'chrome'],
  ['firecrawl', 'firecrawl'],
  ['antigravity', 'antigravity'],
  ['windsurf', 'windsurf'],
  ['copilot', 'copilot'],
  ['amazonq', 'amazonq'],

  // Single-token services
  ['github', 'github'],
  ['gitlab', 'gitlab'],
  ['slack', 'slack'],
  ['discord', 'discord'],
  ['telegram', 'telegram'],
  ['notion', 'notion'],
  ['linear', 'linear'],
  ['jira', 'atlassian'],
  ['confluence', 'atlassian'],
  ['atlassian', 'atlassian'],
  ['asana', 'asana'],
  ['trello', 'trello'],
  ['clickup', 'clickup'],
  ['todoist', 'todoist'],
  ['obsidian', 'obsidian'],
  ['figma', 'figma'],
  ['sentry', 'sentry'],
  ['posthog', 'posthog'],
  ['mintlify', 'mintlify'],
  ['apollo', 'apollo'],
  ['dodopayments', 'dodopayments'],
  ['stripe', 'stripe'],
  ['shopify', 'shopify'],
  ['salesforce', 'salesforce'],
  ['twilio', 'twilio'],
  ['resend', 'resend'],
  ['raycast', 'raycast'],
  ['gmail', 'gmail'],
  ['youtube', 'youtube'],
  ['spotify', 'spotify'],
  ['reddit', 'reddit'],
  ['linkedin', 'linkedin'],
  ['twitter', 'x'],
  ['supabase', 'supabase'],
  ['firebase', 'firebase'],
  ['postgres', 'postgres'],
  ['postgresql', 'postgres'],
  ['mysql', 'mysql'],
  ['mongodb', 'mongodb'],
  ['mongo', 'mongodb'],
  ['redis', 'redis'],
  ['sqlite', 'sqlite'],
  ['neon', 'neon'],
  ['turso', 'turso'],
  ['upstash', 'upstash'],
  ['qdrant', 'qdrant'],
  ['prisma', 'prisma'],
  ['vercel', 'vercel'],
  ['netlify', 'netlify'],
  ['railway', 'railway'],
  ['render', 'render'],
  ['aws', 'aws'],
  ['azure', 'azure'],
  ['gcp', 'gcp'],
  ['docker', 'docker'],
  ['kubernetes', 'kubernetes'],
  ['k8s', 'kubernetes'],
  ['terraform', 'terraform'],
  ['grafana', 'grafana'],
  ['datadog', 'datadog'],
  ['ngrok', 'ngrok'],
  ['postman', 'postman'],
  ['swagger', 'swagger'],
  ['graphql', 'graphql'],
  ['chromium', 'chrome'],
  ['chrome', 'chrome'],
  ['browser', 'chrome'],
  ['vscode', 'vscode'],
  ['jetbrains', 'jetbrains'],
  ['neovim', 'neovim'],
  ['vim', 'vim'],
  ['npm', 'npm'],
  ['python', 'python'],
  ['node', 'nodejs'],
  ['nextjs', 'nextjs'],
  ['tailwind', 'tailwind'],
  ['git', 'git'],
  ['n8n', 'n8n'],

  // Model and agent vendors
  ['anthropic', 'anthropic'],
  ['openai', 'openai'],
  ['codex', 'codex'],
  ['cursor', 'cursor'],
  ['gemini', 'gemini'],
  ['deepseek', 'deepseek'],
  ['mistral', 'mistral'],
  ['perplexity', 'perplexity'],
  ['ollama', 'ollama'],
  ['cohere', 'cohere'],
  ['cerebras', 'cerebras'],
  ['replicate', 'replicate'],
  ['groq', 'groq'],
  ['qwen', 'qwen'],
  ['kimi', 'kimi'],
  ['manus', 'manus'],
  ['grok', 'grok'],
  ['xai', 'xai'],
  ['zed', 'zed'],
  ['warp', 'warp'],
  ['google', 'google'],
  ['microsoft', 'microsoft'],
  ['apple', 'apple'],
]

/** Split on any non-alphanumeric run and on camelCase humps, then de-noise. */
function tokenize(raw: string): string[] {
  return raw
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(t => t && !NOISE.has(t))
}

/** Scan the alias table against a free-form name. */
function lookup(raw: string): BrandName | null {
  const compact = tokenize(raw).join('')
  if (!compact) return null
  for (const [key, slug] of ALIASES) if (compact.includes(key)) return slug
  return null
}

/**
 * The meaningful words in a name, vendor namespacing stripped —
 * `plugin_dodopayments_dodo-knowledge` → `['dodopayments', 'dodo', 'knowledge']`.
 * Used to build svgl search terms when a name matches nothing we already cache.
 */
export function brandKeywords(raw: string): string[] {
  return tokenize(raw)
}

/**
 * Stable cache key for a name that has no static asset. Kept filesystem-safe
 * because it becomes a filename in the learned-icon store.
 */
export function brandCacheKey(raw: string): string | null {
  const key = tokenize(raw).join('-')
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(key) ? key : null
}

/** `mcp__claude_ai_Slack__slack_send_message` → `{ server, tool }`. */
export function parseMcpTool(toolName: string): { server: string; tool: string } | null {
  const m = /^mcp__([^_].*?)__(.+)$/.exec(toolName)
  if (!m) return null
  return { server: m[1], tool: m[2] }
}

/**
 * Human-readable MCP server name. When the server maps onto a known brand we
 * use that brand's own name — `plugin_cloudflare_cloudflare-api` is "Cloudflare",
 * not "Cloudflare Cloudflare Api". Otherwise we tidy up the raw identifier,
 * keeping its original casing so `Claude_Code_iOS_Simulator` stays "iOS".
 */
export function prettyMcpServer(server: string): string {
  const brand = lookup(server)
  if (brand) return BRAND_MANIFEST[brand].title

  const seen = new Set<string>()
  const words = server
    .split(/[^A-Za-z0-9]+/)
    .filter(w => w && !NOISE.has(w.toLowerCase()))
    .filter(w => { const k = w.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true })
    .map(w => (w === w.toLowerCase() ? w.charAt(0).toUpperCase() + w.slice(1) : w))
  return words.length ? words.join(' ') : server
}

/** The vendor logo for an MCP server, or the MCP mark when we can't place it. */
export function brandForMcpServer(server: string): BrandName {
  return lookup(server) ?? 'mcp'
}

/**
 * The logo for any tool call. MCP tools resolve through their server; a handful
 * of built-ins have an obvious mark of their own. Everything else is `null` and
 * keeps whatever lucide glyph the caller already uses.
 */
export function brandForTool(toolName: string): BrandName | null {
  const mcp = parseMcpTool(toolName)
  if (mcp) return brandForMcpServer(mcp.server)
  if (toolName === 'Bash' || toolName === 'Shell') return 'bash'
  return null
}

/** Session providers as stored on sessions and projects. */
const PROVIDERS: Record<string, BrandName> = {
  claude: 'claude',
  codex: 'codex',
  openai: 'openai',
  gemini: 'gemini',
  cursor: 'cursor',
  copilot: 'copilot',
  antigravity: 'antigravity',
  windsurf: 'windsurf',
  opencode: 'opencode',
}

export function brandForProvider(provider: string | null | undefined): BrandName {
  if (!provider) return 'claude'
  return PROVIDERS[provider.toLowerCase()] ?? lookup(provider) ?? 'claude'
}

/**
 * The logo for a subagent type (`posthog:error-analyzer`, `claude-code-guide`,
 * `Explore`). Generic Claude Code agents have no vendor of their own, so they
 * resolve to `null` and the caller keeps the Claude mark.
 */
export function brandForAgentType(agentType: string | null | undefined): BrandName | null {
  if (!agentType) return null
  // A plugin-scoped agent is named `<plugin>:<agent>` — the plugin is the brand.
  const scope = agentType.includes(':') ? agentType.split(':')[0] : agentType
  return lookup(scope) ?? lookup(agentType)
}

/** Integrations and anything else identified by a free-form label. */
export function brandForLabel(label: string): BrandName | null {
  return lookup(label)
}
