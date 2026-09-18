export type Preset = { method: string; path: string; headers: string[]; body?: string }
export type Example = { name: string; code: string; presets: Record<string, Preset> }

const app = (routes: string) => `import { Hono } from 'hono'
import { JevRouter } from 'hono-jev-router'

const app = new Hono({ router: new JevRouter() })

${routes.trim()}

export default app
`

const BROWSER = [
  'User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language: ja,en-US;q=0.9,en;q=0.8',
  'Sec-Fetch-Dest: document',
  'Sec-Fetch-Mode: navigate',
  'Referer: https://www.google.com/',
  'Cookie: theme=dark',
]

const WHO: Record<string, Preset> = {
  'Human Browser': { method: 'GET', path: '/docs', headers: BROWSER },
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

const JSON_HEADERS = ['Content-Type: application/json', 'Accept: application/json']

const contact = (message: string): Preset => ({
  method: 'POST',
  path: '/contact',
  headers: JSON_HEADERS,
  body: JSON.stringify({ message }, null, 2),
})

export const EXAMPLES: Example[] = [
  {
    name: 'Who is asking?',
    code: app(`
app.on('jev', 'a request from an AI agent', (c) => {
  return c.text('# Documentation', 200, {
    'Content-Type': 'text/markdown',
  })
})

app.on('jev', 'a request from a human browser', (c) => {
  return c.html('<h1>Documentation</h1><p>Hello, human.</p>')
})

app.on('jev', 'suspicious automated traffic', (c) => {
  return c.text('Forbidden', 403)
})
`),
    presets: WHO,
  },
  {
    name: 'Plain routing',
    code: app(`
// The usual routing of a web app, written in words.
// The first route that matches wins, so the broad one goes last.

app.on('jev', 'the top page', (c) => c.html('<h1>Welcome</h1>'))

app.on('jev', 'creating a new post', async (c) => {
  return c.json({ created: await c.req.json() }, 201)
})

app.on('jev', 'showing one post', (c) => {
  return c.json({ id: c.req.path.split('/').pop(), title: 'Hello' })
})

app.on('jev', 'deleting something', (c) => c.json({ deleted: true }))

app.on('jev', 'all get request', (c) => c.text('all!'))
`),
    presets: {
      'GET /': { method: 'GET', path: '/', headers: ['Accept: text/html'] },
      'POST /posts': {
        method: 'POST',
        path: '/posts',
        headers: JSON_HEADERS,
        body: JSON.stringify({ title: 'Hello', body: 'My first post' }, null, 2),
      },
      'GET /posts/123': {
        method: 'GET',
        path: '/posts/123',
        headers: ['Accept: application/json'],
      },
      'DELETE /posts/123': { method: 'DELETE', path: '/posts/123', headers: [] },
      'GET /about': { method: 'GET', path: '/about', headers: ['Accept: text/html'] },
    },
  },
  {
    name: 'By intent',
    code: app(`
// Same method, same path. The body decides.
// Topics first, then the mood, then everything else.

app.on('jev', 'a question about billing or payments', (c) => {
  return c.json({ queue: 'billing' })
})

app.on('jev', 'someone who wants to cancel', (c) => {
  return c.json({ queue: 'retention' })
})

app.on('jev', 'an angry customer', (c) => {
  return c.json({ queue: 'priority', reply: 'We are very sorry.' })
})

app.on('jev', 'any other message', (c) => c.json({ queue: 'general' }))
`),
    presets: {
      Angry: contact('This is the third time your app lost my data. Unacceptable!'),
      Billing: contact('I was charged twice this month. Can you check my invoice?'),
      Cancel: contact('How do I close my account? I do not need it anymore.'),
      Hello: contact('Hi! Do you have a dark mode?'),
    },
  },
  {
    name: '日本語',
    code: app(`
// Descriptions can be in any language.

app.on('jev', '怪しい自動化されたアクセス', (c) => c.text('だめです', 403))

app.on('jev', 'AIエージェントからのリクエスト', (c) => {
  return c.text('# ドキュメント', 200, {
    'Content-Type': 'text/markdown; charset=UTF-8',
  })
})

app.on('jev', '全てのリクエスト', (c) => c.text('all!'))
`),
    presets: WHO,
  },
]
