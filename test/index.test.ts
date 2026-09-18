import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Hono } from 'hono'
import { JevRouter, type JevRequest } from '../src/index.ts'

// Stands in for Jev: a route matches when its description mentions the User-Agent or the method
const run = async (_c: unknown, request: JevRequest) => {
  const { method, headers } = request.state
  const ua = headers['user-agent']
  const answers = Object.fromEntries(
    Object.entries(request.questions).map(([key, { instructions }]) => {
      const description = instructions.match(/"(.*)"/)?.[1] ?? ''
      const matches = description.includes(ua) || description.includes(`any ${method}`)
      return [key, { noul: matches ? 0.9 : 0.1 }]
    })
  )
  return { answers }
}

const createApp = (threshold?: number) => {
  const app = new Hono<{ Variables: { jev: { route: string } } }>({
    router: new JevRouter({ run, threshold }),
  })
  app.use(async (c, next) => {
    await next()
    c.header('x-middleware', 'ran')
  })
  app.get('/health', (c) => c.text('ok'))
  app.on('jev', 'a request from agent', (c) => c.text(`agent ${c.req.method} ${c.req.path}`))
  app.on('jev', 'a request from browser', (c) => c.text(`browser: ${c.get('jev').route}`))
  return app
}

test('routes by meaning', async () => {
  const app = createApp()
  const agent = await app.request('/docs', {
    method: 'POST',
    body: 'hi',
    headers: { 'User-Agent': 'agent' },
  })
  assert.equal(await agent.text(), 'agent POST /docs')
  const browser = await app.request('/docs', { headers: { 'User-Agent': 'browser' } })
  assert.equal(await browser.text(), 'browser: a request from browser')
  assert.equal(browser.headers.get('x-middleware'), 'ran')
})

test('path routes still work', async () => {
  const res = await createApp().request('/health', { headers: { 'User-Agent': 'agent' } })
  assert.equal(await res.text(), 'ok')
})

test('the first registered route that matches wins', async () => {
  const app = new Hono({ router: new JevRouter({ run }) })
  app.on('jev', 'any GET request', (c) => c.text('all!'))
  app.on('jev', 'a request from browser', (c) => c.text('browser'))
  const get = await app.request('/', { headers: { 'User-Agent': 'browser' } })
  assert.equal(await get.text(), 'all!')
  const post = await app.request('/', { method: 'POST', headers: { 'User-Agent': 'browser' } })
  assert.equal(await post.text(), 'browser')
})

test('falls through to notFound when no route reaches the threshold', async () => {
  const unknown = await createApp().request('/docs', { headers: { 'User-Agent': 'unknown' } })
  assert.equal(unknown.status, 404)
  const strict = await createApp(0.95).request('/docs', { headers: { 'User-Agent': 'agent' } })
  assert.equal(strict.status, 404)
})

test('handlers can still read the body, even a binary one', async () => {
  const app = new Hono({ router: new JevRouter({ run }) })
  app.on('jev', 'a request from agent', async (c) => c.body(await c.req.arrayBuffer()))
  app.on('jev', 'a request from json', async (c) => c.json(await c.req.json()))

  const bytes = new Uint8Array([0xff, 0xd8, 0x00, 0xfe, 0x80])
  const binary = await app.request('/upload', {
    method: 'POST',
    body: bytes,
    headers: { 'User-Agent': 'agent', 'Content-Type': 'image/jpeg' },
  })
  assert.deepEqual(new Uint8Array(await binary.arrayBuffer()), bytes)

  const json = await app.request('/api', {
    method: 'POST',
    body: JSON.stringify({ hello: 'jev' }),
    headers: { 'User-Agent': 'json', 'Content-Type': 'application/json' },
  })
  assert.deepEqual(await json.json(), { hello: 'jev' })
})

test('only textual bodies are shown to Jev', async () => {
  const bodies: Record<string, string | undefined> = {}
  const app = new Hono({
    router: new JevRouter({
      run: (c, request) => {
        bodies[request.state.headers['content-type']] = request.state.body
        return run(c, request)
      },
    }),
  })
  app.on('jev', 'anything', (c) => c.text('ok'))

  const xlsx = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  const contentTypes = [
    'Application/JSON; charset=utf-8',
    'application/ld+json',
    'image/svg+xml',
    'application/x-www-form-urlencoded',
    xlsx,
    'application/octet-stream',
  ]
  await Promise.all(
    contentTypes.map((contentType) =>
      app.request('/', { method: 'POST', body: 'hello', headers: { 'Content-Type': contentType } })
    )
  )
  assert.deepEqual(bodies, {
    'Application/JSON; charset=utf-8': 'hello',
    'application/ld+json': 'hello',
    'image/svg+xml': 'hello',
    'application/x-www-form-urlencoded': 'hello',
    [xlsx]: `[5 bytes of ${xlsx}]`,
    'application/octet-stream': '[5 bytes of application/octet-stream]',
  })
})
