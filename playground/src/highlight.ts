// A tiny highlighter for the editor overlay. Good enough for a Hono app, not a JS parser.
const KEYWORDS =
  'import|from|export|default|const|let|var|return|async|await|new|if|else|function|class|extends|throw|try|catch|for|of|in|while|true|false|null|undefined'

const TOKEN = new RegExp(
  [
    '(\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/)', // 1: comment
    '(\'(?:\\\\.|[^\'\\\\\\n])*\'|"(?:\\\\.|[^"\\\\\\n])*"|`(?:\\\\.|[^`\\\\])*`)', // 2: string
    `\\b(${KEYWORDS})\\b`, // 3: keyword
    '\\b(\\d[\\d_.]*)\\b', // 4: number
  ].join('|'),
  'g'
)

// The string right after `.on('jev',` is a semantic route description
const BEFORE_DESCRIPTION = /\.on\(\s*['"]jev['"]\s*,\s*$/i

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' }
const escapeHtml = (s: string) => s.replace(/[&<>]/g, (ch) => ESCAPES[ch])

export const highlight = (code: string) => {
  let html = ''
  let last = 0
  for (const match of code.matchAll(TOKEN)) {
    const [token, comment, string, keyword] = match
    html += escapeHtml(code.slice(last, match.index))
    last = match.index + token.length
    const kind = comment
      ? 'comment'
      : string
        ? BEFORE_DESCRIPTION.test(code.slice(0, match.index))
          ? 'description'
          : 'string'
        : keyword
          ? 'keyword'
          : 'number'
    html += `<span class="t-${kind}">${escapeHtml(token)}</span>`
  }
  // The trailing newline keeps the <pre> as tall as the textarea
  return `${html}${escapeHtml(code.slice(last))}\n`
}
