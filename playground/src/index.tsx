import { WorkerEntrypoint } from 'cloudflare:workers'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { secureHeaders } from 'hono/secure-headers'
import { modules } from 'virtual:dynamic-worker-modules'
import {
  chooseWithJev,
  type JevInput,
  type JevRequest,
  type JevResponse,
  type JevResult,
} from '../../src/index'
import { ERROR_HEADER, RESULT_HEADER } from './playground-router'
import { renderer } from './renderer'

const MAX_CODE_LENGTH = 20_000
const MAX_STATE_LENGTH = 16_000
const MAX_ROUTES = 20
const MAX_REQUEST_LENGTH = 64 * 1024
const MAX_RESPONSE_LENGTH = 100 * 1024
const RUN_TIMEOUT = 10_000

// 'typesafe/jev' is not in the generated AI types yet
type JevAi = {
  run(
    model: string,
    request: JevRequest,
    options: { gateway: { id: string } }
  ): Promise<{ result: JevResponse }>
}

// The only capability user code gets. The AI binding never leaves the host.
export class JevBinding extends WorkerEntrypoint<CloudflareBindings, { ip: string }> {
  async choose(input: JevInput): Promise<JevResult> {
    const { success } = await this.env.JEV_LIMITER.limit({ key: this.ctx.props.ip })
    if (!success) {
      throw new Error('Rate limit exceeded. Try again in a minute.')
    }
    const routes = input.routes.slice(0, MAX_ROUTES).map((r) => String(r).slice(0, 300))
    if (routes.length === 0 || JSON.stringify(input.state).length > MAX_STATE_LENGTH) {
      throw new Error('Invalid Jev input')
    }
    return chooseWithJev(
      { state: input.state, routes, threshold: Number(input.threshold) || 0.5 },
      async (request) => {
        const { result } = await (this.env.AI as unknown as JevAi).run('typesafe/jev', request, {
          gateway: { id: this.env.AI_GATEWAY_ID },
        })
        return result
      }
    )
  }
}

type RunRequest = {
  code: string
  request: { method: string; path: string; headers: Record<string, string>; body?: string }
}

const HonoLogo = () => (
  <svg class='logo' xmlns='http://www.w3.org/2000/svg' viewBox='0 0 76 98' aria-label='Hono'>
    <path
      fill='url(#flame)'
      d='m11 25 7 9s9-18 22-34c17 20 36 48 36 64 0 20-19 34-37 34C17 98 0 81 0 61c0-6 3-24 11-36Z'
    />
    <path fill='#F95' d='M39 21c47 51 14 66 0 66-11 0-51-11 0-66Z' />
    <defs>
      <linearGradient id='flame' x2='0%' y2='100%'>
        <stop stop-color='#F84' />
        <stop offset='100%' stop-color='#F30' />
      </linearGradient>
    </defs>
  </svg>
)

const app = new Hono<{ Bindings: CloudflareBindings }>()

// Read at most `max` bytes, then stop the stream. User code may return an endless body.
const readText = async (res: Response, max: number) => {
  if (!res.body) {
    return ''
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  let length = 0
  while (length < max) {
    // oxlint-disable-next-line no-await-in-loop -- chunks of one stream, read in order
    const { done, value } = await reader.read()
    if (done) {
      return text
    }
    length += value.byteLength
    text += decoder.decode(value, { stream: true })
  }
  await reader.cancel()
  return `${text.slice(0, max)}\n… (truncated)`
}

const timeout = (ms: number) =>
  new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Timed out')), ms))

app.post('/run', bodyLimit({ maxSize: MAX_REQUEST_LENGTH }), async (c) => {
  // A JSON content type forces a CORS preflight, so other sites cannot make visitors run code here
  if (!c.req.header('content-type')?.startsWith('application/json')) {
    return c.json({ error: 'Content-Type must be application/json' }, 415)
  }
  const ip = c.req.header('cf-connecting-ip') ?? 'local'
  const { success } = await c.env.RUN_LIMITER.limit({ key: ip })
  if (!success) {
    return c.json({ error: 'Rate limit exceeded. Try again in a minute.' }, 429)
  }

  const { code, request } = await c.req.json<RunRequest>()
  if (typeof code !== 'string' || code.length > MAX_CODE_LENGTH) {
    return c.json({ error: 'Invalid code' }, 400)
  }

  try {
    const worker = c.env.LOADER.load({
      compatibilityDate: '2026-09-01',
      mainModule: 'app.js',
      modules: {
        'app.js': code,
        // Bare names like 'hono' need an explicit module type
        ...Object.fromEntries(Object.entries(modules).map(([name, js]) => [name, { js }])),
      },
      env: { JEV: c.executionCtx.exports.JevBinding({ props: { ip } }) },
      // No network, little CPU. The JEV binding is all it can reach.
      globalOutbound: null,
      limits: { cpuMs: 100, subRequests: 5 },
    })
    const hasBody = request.body && !['GET', 'HEAD'].includes(request.method)
    const run = worker.getEntrypoint().fetch(
      new Request(new URL(request.path, 'https://playground.example'), {
        method: request.method,
        headers: request.headers,
        body: hasBody ? request.body : undefined,
      })
    )
    const res = await Promise.race([run, timeout(RUN_TIMEOUT)])
    const headers = Object.fromEntries(res.headers)
    const jev = headers[RESULT_HEADER]
    delete headers[RESULT_HEADER]
    if (headers[ERROR_HEADER]) {
      return c.json({ error: decodeURIComponent(headers[ERROR_HEADER]) }, 502)
    }
    return c.json({
      jev: jev ? JSON.parse(decodeURIComponent(jev)) : null,
      response: {
        status: res.status,
        statusText: res.statusText,
        headers,
        body: await Promise.race([readText(res, MAX_RESPONSE_LENGTH), timeout(RUN_TIMEOUT)]),
      },
    })
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 400)
  }
})

app.get('/', secureHeaders(), renderer, (c) => {
  return c.render(
    <main>
      <header>
        <HonoLogo />
        <div>
          <h1>
            <span>Jev</span> Router <small>for Hono</small>
          </h1>
          <p class='tagline'>
            Route HTTP requests by meaning. Edit the descriptions, send a request, see who answers.
          </p>
        </div>
      </header>

      <div class='grid'>
        <section class='panel'>
          <h2>Code — runs in a Dynamic Worker</h2>
          <div class='tabs' id='examples'></div>
          <div class='editor'>
            <pre id='highlight' aria-hidden='true'></pre>
            <textarea id='code' spellcheck={false}></textarea>
          </div>
        </section>

        <section class='panel'>
          <h2>Request</h2>
          <div class='presets' id='presets'></div>
          <label for='path'>Method / Path</label>
          <div class='row'>
            <select id='method'>
              {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((method) => (
                <option>{method}</option>
              ))}
            </select>
            <input id='path' spellcheck={false} />
          </div>
          <label for='headers'>Headers</label>
          <textarea id='headers' spellcheck={false}></textarea>
          <label for='body'>Body</label>
          <textarea id='body' spellcheck={false}></textarea>
          <button id='send'>Send Request</button>
        </section>
      </div>

      <div class='grid' id='result'>
        <section class='panel'>
          <h2>Matched route</h2>
          <div id='matched'></div>
        </section>
        <section class='panel'>
          <h2>
            Response <span id='time'></span>
          </h2>
          <div id='response'></div>
        </section>
      </div>

      <footer>
        <code>npm i hono-jev-router</code>
        <a href='https://github.com/yusukebe/hono-jev-router'>GitHub</a>
        <a href='https://www.npmjs.com/package/hono-jev-router'>npm</a>
        <a href='https://hono.dev'>Hono</a>
        <a href='https://typesafe.ai'>Jev</a>
      </footer>
    </main>
  )
})

export default app
