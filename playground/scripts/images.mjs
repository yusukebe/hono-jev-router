// Generates public/og.png and a shareable code image, in the playground's look.
// usage: node scripts/images.mjs  (needs rsvg-convert)
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'

const C = {
  bg: '#efe9dc',
  panel: '#fbf9f3',
  text: '#1a1814',
  muted: '#6f6a5e',
  border: '#cfc7b4',
  hono: '#d9480f',
  honoSoft: '#f6dcc8',
  string: '#7a5c2e',
}
const MONO = 'Menlo, monospace'
const SERIF = "'Iowan Old Style', Palatino, Georgia, serif"
const SANS = "'Helvetica Neue', Helvetica, Arial, sans-serif"
const ADVANCE = 0.602 // Menlo: character width / font size

const KEYWORDS =
  'import|from|export|default|const|let|var|return|async|await|new|if|else|function|class'
const TOKEN = new RegExp(
  `('(?:\\\\.|[^'\\\\])*')|\\b(${KEYWORDS})\\b|\\b(\\d[\\d_.]*)\\b|(\\/\\/.*$)`,
  'g'
)
const esc = (s) => s.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch])

const flame = (x, y, width) => `
  <g transform="translate(${x} ${y}) scale(${width / 76})">
    <path fill="url(#flame)" d="m11 25 7 9s9-18 22-34c17 20 36 48 36 64 0 20-19 34-37 34C17 98 0 81 0 61c0-6 3-24 11-36Z"/>
    <path fill="#F95" d="M39 21c47 51 14 66 0 66-11 0-51-11 0-66Z"/>
  </g>`

const DEFS = `<defs><linearGradient id="flame" x2="0%" y2="100%"><stop stop-color="#F84"/><stop offset="100%" stop-color="#F30"/></linearGradient></defs>`

// One line of code as highlighted SVG. Descriptions get the orange marker behind them.
const codeLine = (line, x, y, size) => {
  const width = size * ADVANCE
  let marks = ''
  let spans = ''
  let last = 0
  for (const match of line.matchAll(TOKEN)) {
    const [token, string, keyword, , comment] = match
    spans += esc(line.slice(last, match.index))
    last = match.index + token.length
    const description = string && /\.on\(\s*'jev'\s*,\s*$/.test(line.slice(0, match.index))
    if (description) {
      marks += `<rect x="${x + match.index * width - 3}" y="${y - size * 0.98}" width="${token.length * width + 6}" height="${size * 1.36}" rx="3" fill="${C.honoSoft}"/>`
    }
    const fill = description
      ? C.hono
      : string
        ? C.string
        : comment
          ? C.muted
          : keyword
            ? C.text
            : C.string
    spans += `<tspan fill="${fill}"${keyword ? ' font-weight="700"' : ''}${comment ? ' font-style="italic"' : ''}>${esc(token)}</tspan>`
  }
  spans += esc(line.slice(last))
  return `${marks}<text x="${x}" y="${y}" font-family="${MONO}" font-size="${size}" fill="${C.text}" xml:space="preserve">${spans}</text>`
}

const codeBlock = (code, x, y, size, lineHeight) =>
  code
    .split('\n')
    .map((line, i) => codeLine(line, x, y + i * lineHeight, size))
    .join('\n')

// The code is the hero: it has to stay readable at timeline size
const og = () => {
  const code = `app.on('jev', 'a request from an AI agent', …)
app.on('jev', 'a request from a human browser', …)
app.on('jev', 'suspicious automated traffic', …)`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">${DEFS}
  <rect width="1200" height="630" fill="${C.bg}"/>
  ${flame(88, 64, 34)}
  <text x="136" y="100" font-family="${SERIF}" font-size="44" fill="${C.text}"><tspan font-style="italic">Jev</tspan> Router <tspan font-size="24" fill="${C.hono}" dx="6">for Hono</tspan></text>
  ${codeBlock(code, 88, 262, 34, 92)}
  <text x="88" y="560" font-family="${SANS}" font-size="32" fill="${C.muted}">Route HTTP requests by meaning.</text>
</svg>`
}

// For sharing on X: a framed card with nothing but the code, as large as the longest line allows
const share = (code) => {
  const width = 1600
  const margin = 56
  const pad = 52
  const lines = code.split('\n')
  const longest = Math.max(...lines.map((line) => line.length))
  const size = Math.floor((width - (margin + pad) * 2) / longest / ADVANCE)
  const lineHeight = Math.round(size * 1.55)
  const cardHeight = pad * 2 + size + (lines.length - 1) * lineHeight
  const height = margin + cardHeight + 96
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${DEFS}
  <rect width="${width}" height="${height}" fill="${C.bg}"/>
  <rect x="${margin}" y="${margin}" width="${width - margin * 2}" height="${cardHeight}" rx="4" fill="${C.panel}" stroke="${C.text}" stroke-width="2.5"/>
  ${codeBlock(code, margin + pad, margin + pad + size * 0.82, size, lineHeight)}
  ${flame(margin, height - 68, 24)}
  <text x="${margin + 38}" y="${height - 42}" font-family="${MONO}" font-size="25" fill="${C.muted}">hono-jev-router</text>
</svg>`
}

const SHARE_CODE = `import { Hono } from 'hono'
import { JevRouter } from 'hono-jev-router'

const app = new Hono({ router: new JevRouter() })

app.on('jev', 'a request from an AI agent', (c) => {
  return c.text('# Documentation', 200, {
    'Content-Type': 'text/markdown',
  })
})

app.on('jev', 'a request from a human browser', (c) => {
  return c.html('<h1>Documentation</h1><p>Hello, human.</p>')
})

export default app`

const render = (svg, out, width) => {
  writeFileSync(`${out}.svg`, svg)
  execFileSync('rsvg-convert', ['-w', String(width), `${out}.svg`, '-o', `${out}.png`])
  console.log(`${out}.png`)
}

mkdirSync('images', { recursive: true })
render(og(), 'images/og', 1200)
copyFileSync('images/og.png', 'public/og.png')
render(share(SHARE_CODE), 'images/code', 3200)
