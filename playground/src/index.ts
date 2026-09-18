import { WorkerEntrypoint } from 'cloudflare:workers'
import { Hono } from 'hono'
import { modules } from './generated/modules'
import {
  chooseWithJev,
  type JevInput,
  type JevRequest,
  type JevResponse,
  type JevResult,
} from '../../src/index'
import { ERROR_HEADER, RESULT_HEADER } from './playground-router'

const MAX_CODE_LENGTH = 20_000
const MAX_STATE_LENGTH = 16_000
const MAX_ROUTES = 20

// The only capability user code gets. The AI binding never leaves the host.
export class JevBinding extends WorkerEntrypoint<CloudflareBindings> {
  async choose(input: JevInput): Promise<JevResult> {
    const routes = input.routes.slice(0, MAX_ROUTES).map((r) => String(r).slice(0, 300))
    if (routes.length === 0 || JSON.stringify(input.state).length > MAX_STATE_LENGTH) {
      throw new Error('Invalid Jev input')
    }
    return chooseWithJev(
      { state: input.state, routes, threshold: Number(input.threshold) || 0.5 },
      // 'typesafe/jev' is not in the generated AI types yet
      async (request) => {
        const { result } = await (this.env.AI as unknown as JevAi).run('typesafe/jev', request, {
          gateway: { id: this.env.AI_GATEWAY_ID },
        })
        return result
      }
    )
  }
}

type JevAi = {
  run(
    model: string,
    request: JevRequest,
    options: { gateway: { id: string } }
  ): Promise<{ result: JevResponse }>
}

type RunRequest = {
  code: string
  request: { method: string; path: string; headers: Record<string, string>; body?: string }
}

const app = new Hono<{ Bindings: CloudflareBindings }>()

app.post('/run', async (c) => {
  const ip = c.req.header('cf-connecting-ip') ?? 'local'
  const { success } = await c.env.RATE_LIMITER.limit({ key: ip })
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
      env: { JEV: c.executionCtx.exports.JevBinding({ props: {} }) },
      globalOutbound: null,
    })
    const hasBody = request.body && !['GET', 'HEAD'].includes(request.method)
    const res = await worker.getEntrypoint().fetch(
      new Request(new URL(request.path, 'https://playground.example'), {
        method: request.method,
        headers: request.headers,
        body: hasBody ? request.body : undefined,
      })
    )
    const headers = Object.fromEntries(res.headers)
    const jev = headers[RESULT_HEADER]
    delete headers[RESULT_HEADER]
    if (headers[ERROR_HEADER]) {
      return c.json({ error: decodeURIComponent(headers[ERROR_HEADER]) }, 502)
    }
    return c.json({
      jev: jev ? JSON.parse(decodeURIComponent(jev)) : null,
      response: { status: res.status, statusText: res.statusText, headers, body: await res.text() },
    })
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 400)
  }
})

export default app
