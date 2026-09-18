import { EXAMPLES, type Example, type Preset } from './examples'
import { highlight } from './highlight'

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

const applyPreset = (preset: Preset) => {
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

$('send').addEventListener('click', send)

const code = $<HTMLTextAreaElement>('code')
const highlighted = $('highlight')
const render = () => {
  highlighted.innerHTML = highlight(code.value)
}
const syncScroll = () => {
  highlighted.scrollTop = code.scrollTop
  highlighted.scrollLeft = code.scrollLeft
}
code.addEventListener('input', () => {
  render()
  // Browsers keep the left padding scrolled out after a long line. Reset it at the start of a line.
  if (code.selectionStart === 0 || code.value[code.selectionStart - 1] === '\n') {
    code.scrollLeft = 0
  }
  syncScroll()
})
code.addEventListener('scroll', syncScroll)
code.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    e.preventDefault()
    code.setRangeText('  ', code.selectionStart, code.selectionEnd, 'end')
    render()
  }
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    void send()
  }
})

const buttons = (container: HTMLElement, names: string[], onSelect: (name: string) => void) => {
  container.replaceChildren(
    ...names.map((name) => {
      const button = document.createElement('button')
      button.textContent = name
      button.addEventListener('click', () => {
        container
          .querySelectorAll('button')
          .forEach((b) => b.classList.toggle('active', b === button))
        onSelect(name)
      })
      return button
    })
  )
  container.querySelector('button')?.click()
}

const applyExample = (example: Example) => {
  code.value = example.code
  code.scrollLeft = 0
  render()
  $('result').style.display = 'none'
  buttons($('presets'), Object.keys(example.presets), (name) => applyPreset(example.presets[name]))
}

buttons(
  $('examples'),
  EXAMPLES.map((example) => example.name),
  (name) => applyExample(EXAMPLES.find((example) => example.name === name)!)
)
