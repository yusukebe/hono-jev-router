import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Hono } from 'hono'
import { JevRouter, type JevRequest } from '../src/index.ts'

// Stands in for Jev: picks the route whose description mentions the User-Agent
const run = async (_c: unknown, request: JevRequest) => {
  const criteria = request.questions.route.criteria
  const ua = request.state.headers['user-agent']
  const choice = Object.keys(criteria).find((key) => criteria[key].includes(ua)) ?? 'route_1'
  const probabilities = Object.fromEntries(
    Object.keys(criteria).map((k) => [k, k === choice ? 1 : 0])
  )
  return { answers: { route: { choice, confidence: ua === 'unsure' ? 0.2 : 0.9, probabilities } } }
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

test('falls through to notFound below the threshold', async () => {
  const res = await createApp(0.5).request('/docs', { headers: { 'User-Agent': 'unsure' } })
  assert.equal(res.status, 404)
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
