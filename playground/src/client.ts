const DEFAULT_CODE = `import { Hono } from 'hono'
import { JevRouter } from 'hono-jev-router'

const app = new Hono({ router: new JevRouter() })

app.on('jev', 'a request from an AI agent', (c) => {
  return c.text('# Documentation\\n\\nHello, agent. Here is clean markdown.', 200, {
    'Content-Type': 'text/markdown',
  })
})

app.on('jev', 'a request from a human browser', (c) => {
  return c.html('<h1>Documentation</h1><p>Hello, human.</p>')
})

app.on('jev', 'suspicious automated traffic', (c) => {
  return c.text('Forbidden', 403)
})

export default app
`

type Preset = { method: string; path: string; headers: string[]; body?: string }

const PRESETS: Record<string, Preset> = {
  'Human Browser': {
    method: 'GET',
    path: '/docs',
    headers: [
      'User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
      'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language: ja,en-US;q=0.9,en;q=0.8',
      'Sec-Fetch-Dest: document',
      'Sec-Fetch-Mode: navigate',
      'Referer: https://www.google.com/',
      'Cookie: theme=dark',
    ],
  },
  'AI Agent': {
    method: 'GET',
    path: '/docs',
    headers: [
      'User-Agent: Claude-User/1.0 (+https://www.anthropic.com)',
      'Accept: text/markdown, text/plain;q=0.9, */*;q=0.1',
    ],
  },
  'Suspicious Bot': {
    method: 'POST',
    path: '/wp-login.php',
    headers: [
      'User-Agent: python-requests/2.31.0',
      'Accept: */*',
      'Content-Type: application/x-www-form-urlencoded',
    ],
    body: 'log=admin&pwd=123456',
  },
}

type JevResult = { route?: string; probabilities: Record<string, number> }
type RunResponse = {
  status: number
  statusText: string
  headers: Record<string, string>
  body: string
}
type RunResult = { error?: string; jev: JevResult | null; response: RunResponse }

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const field = (id: string) => $<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(id)

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }
const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (ch) => ESCAPES[ch])

const applyPreset = (name: string) => {
  const preset = PRESETS[name]
  field('method').value = preset.method
  field('path').value = preset.path
  field('headers').value = preset.headers.join('\n')
  field('body').value = preset.body ?? ''
}

const parseHeaders = (text: string) =>
  Object.fromEntries(
    text
      .split('\n')
      .map((line) => line.match(/^\s*([^:\s]+)\s*:\s*(.*)$/))
      .filter((match) => match !== null)
      .map(([, key, value]) => [key, value])
  )

const renderMatched = (jev: JevResult | null) => {
  if (!jev) {
    return '<div class="matched">—<small>no semantic route was involved</small></div>'
  }
  const bars = Object.entries(jev.probabilities)
    .map(([route, p]) => {
      const percent = (p * 100).toFixed(0)
      return `<div class="bar ${route === jev.route ? 'win' : ''}"><i style="width:${percent}%"></i><span><b>${escapeHtml(route)}</b><em>${percent}%</em></span></div>`
    })
    .join('')
  const matched = jev.route
    ? `“${escapeHtml(jev.route)}”<small>first route over the threshold</small>`
    : '—<small>no route reached the threshold</small>'
  return `<div class="matched">${matched}</div><div class="bars">${bars}</div>`
}

const renderResponse = (res: RunResponse) => {
  const headers = Object.entries(res.headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')
  return `<div class="status">${res.status} ${escapeHtml(res.statusText)}</div><pre class="headers">${escapeHtml(headers)}</pre><pre>${escapeHtml(res.body)}</pre>`
}

const send = async () => {
  const button = $<HTMLButtonElement>('send')
  button.disabled = true
  button.textContent = 'Asking Jev…'
  const started = performance.now()
  try {
    const res = await fetch('/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: field('code').value,
        request: {
          method: field('method').value,
          path: field('path').value || '/',
          headers: parseHeaders(field('headers').value),
          body: field('body').value,
        },
      }),
    })
    const data: RunResult = await res.json()
    $('result').style.display = 'grid'
    $('time').textContent = `· ${Math.round(performance.now() - started)}ms`
    if (data.error) {
      $('matched').innerHTML = '<div class="matched">—</div>'
      $('response').innerHTML = `<pre class="error">${escapeHtml(data.error)}</pre>`
    } else {
      $('matched').innerHTML = renderMatched(data.jev)
      $('response').innerHTML = renderResponse(data.response)
    }
  } finally {
    button.disabled = false
    button.textContent = 'Send Request'
  }
}

for (const name of Object.keys(PRESETS)) {
  const button = document.createElement('button')
  button.textContent = name
  button.addEventListener('click', () => applyPreset(name))
  $('presets').append(button)
}

$('send').addEventListener('click', send)

const code = $<HTMLTextAreaElement>('code')
code.value = DEFAULT_CODE
code.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    e.preventDefault()
    code.setRangeText('  ', code.selectionStart, code.selectionEnd, 'end')
  }
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    void send()
  }
})

applyPreset('AI Agent')
