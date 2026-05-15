import type { ParsedMessage } from './types'

export function sessionToMarkdown(messages: ParsedMessage[], sessionId: string): string {
  const lines: string[] = [
    `# Session ${sessionId}`,
    ``,
    `> Exported ${new Date().toLocaleString()} · ${messages.filter(m => !m.isMeta).length} messages`,
    ``,
    `---`,
    ``,
  ]

  for (const msg of messages) {
    if (msg.isMeta) continue
    if (msg.uuid.startsWith('__optimistic__')) continue

    const role = msg.type === 'user' ? 'You' : 'Claude'
    const ts = new Date(msg.timestamp).toLocaleString()
    lines.push(`## ${role}  ·  ${ts}`, ``)

    for (const block of msg.content) {
      if (block.type === 'text' && block.text) {
        lines.push(block.text, ``)
      } else if (block.type === 'thinking' && block.thinking) {
        lines.push(`> **[Thinking]**`, `>`, ...block.thinking.split('\n').map(l => `> ${l}`), ``)
      } else if (block.type === 'tool_use') {
        lines.push(
          `**Tool: \`${block.tool_name ?? 'unknown'}\`**`,
          ``,
          `\`\`\`json`,
          JSON.stringify(block.tool_input, null, 2),
          `\`\`\``,
          ``,
        )
      } else if (block.type === 'tool_result') {
        const text = block.tool_result?.map(b => b.text ?? '').join('\n') ?? ''
        const label = block.is_error ? '**[Tool Error]**' : '**[Tool Result]**'
        lines.push(label, ``, `\`\`\``, text || '(empty)', `\`\`\``, ``)
      } else if (block.type === 'image') {
        lines.push(`*[Image attachment]*`, ``)
      }
    }

    lines.push(`---`, ``)
  }

  return lines.join('\n')
}
