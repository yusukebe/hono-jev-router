import type { Context, Next } from 'hono'
import type { Result, Router } from 'hono/router'
import { TrieRouter } from 'hono/router/trie-router'

export type JevState = {
  method: string
  url: string
  headers: Record<string, string>
  body?: string
}

export type JevInput = {
  state: JevState
  /** Semantic route descriptions, in registration order */
  routes: string[]
}

export type JevResult = {
  /** The chosen route description */
  route: string
  confidence: number
  /** Route description -> probability */
  probabilities: Record<string, number>
}

export type JevRouterOptions = {
  /** TypeSafe API key. Pass a function to read it from `c.env`. */
  apiKey?: string | ((c: Context) => string)
  baseURL?: string
  /**
   * Reach Jev some other way than the TypeSafe REST API, e.g. Workers AI:
   * `async (c, request) => (await c.env.AI.run('typesafe/jev', request, { gateway: { id: 'default' } })).result`
   */
  run?: (c: Context, request: JevRequest) => Promise<JevResponse>
  /** Replace the whole decision, e.g. delegate it to an RPC binding */
  choose?: (c: Context, input: JevInput) => Promise<JevResult>
  /** Below this confidence no semantic route matches. Default: 0 */
  threshold?: number
  /** Default: 4096 */
  maxBodyLength?: number
}

const METHOD = 'JEV'
const INSTRUCTIONS = 'Which description best matches this HTTP request?'

export type JevRequest = {
  state: JevState
  questions: Record<
    string,
    { type: 'choice'; instructions: string; criteria: Record<string, string> }
  >
}

export type JevResponse = {
  answers: Record<
    string,
    { choice: string; confidence: number; probabilities: Record<string, number> }
  >
}

/** How the request reaches Jev, e.g. `(req) => env.AI.run('typesafe/jev', req)` */
export type JevRun = (request: JevRequest) => Promise<JevResponse>

/** Calls the TypeSafe REST API directly */
export const fetchJev =
  (options: { apiKey?: string; baseURL?: string }): JevRun =>
  async (request) => {
    const res = await fetch(`${options.baseURL ?? 'https://api.typesafe.ai'}/v1/systemone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${options.apiKey}` },
      body: JSON.stringify({ model: 'jev-latest', ...request }),
    })
    if (!res.ok) {
      throw new Error(`Jev request failed: ${res.status} ${await res.text()}`)
    }
    return res.json()
  }

/** Ask Jev (Choice) which route description matches the request state. */
export const chooseWithJev = async (input: JevInput, run: JevRun): Promise<JevResult> => {
  // Option names are visible to the model, so keep them neutral and map back
  const keys = input.routes.map((_, i) => `route_${i + 1}`)
  const { answers } = await run({
    state: input.state,
    questions: {
      route: {
        type: 'choice',
        instructions: INSTRUCTIONS,
        criteria: Object.fromEntries(keys.map((key, i) => [key, input.routes[i]])),
      },
    },
  })
  const answer = answers.route
  return {
    route: input.routes[keys.indexOf(answer.choice)],
    confidence: answer.confidence,
    probabilities: Object.fromEntries(
      keys.map((key, i) => [input.routes[i], answer.probabilities[key] ?? 0])
    ),
  }
}

const TEXT_CONTENT_TYPE = /^text\/|json|xml|x-www-form-urlencoded/

// Cache the body as an ArrayBuffer: Hono derives text(), json(), formData() and blob() from it
// without loss, so handlers can still read the body, even a binary one.
const readBody = async (c: Context, maxLength: number) => {
  const buffer = await c.req.arrayBuffer()
  const contentType = c.req.header('content-type') ?? 'text/plain'
  if (!TEXT_CONTENT_TYPE.test(contentType)) {
    return `[${buffer.byteLength} bytes of ${contentType}]`
  }
  return new TextDecoder().decode(buffer.slice(0, maxLength))
}

/**
 * Routes registered with `app.on('jev', '<description>', handler)` are matched by meaning.
 * Everything else (paths, middleware) is delegated to a TrieRouter.
 *
 * `match()` has to be synchronous, so it returns one dispatcher handler
 * which asks Jev and then runs the chosen handler.
 */
export class JevRouter<T> implements Router<T> {
  name = 'JevRouter'
  #inner = new TrieRouter<T>()
  #routes: { description: string; handler: T }[] = []
  #options: JevRouterOptions
  #dispatcher: T

  constructor(options: JevRouterOptions = {}) {
    this.#options = options
    // Hono registers handlers as `[handler, routerRoute]`
    const route = { basePath: '/', path: '*', method: METHOD, handler: this.#dispatch }
    this.#dispatcher = [this.#dispatch, route] as T
  }

  add(method: string, path: string, handler: T) {
    if (method === METHOD) {
      this.#routes.push({ description: path.replace(/^\//, ''), handler })
      return
    }
    this.#inner.add(method, path, handler)
  }

  match(method: string, path: string): Result<T> {
    const result = this.#inner.match(method, path)
    if (this.#routes.length === 0) {
      return result
    }
    const matched = result[0] as [T, Record<string, string>][]
    return [[...matched, [this.#dispatcher, Object.create(null)]]]
  }

  #dispatch = async (c: Context, next: Next) => {
    const { choose, run, apiKey, baseURL, threshold = 0, maxBodyLength = 4096 } = this.#options
    const req = c.req.raw
    const body = req.body ? await readBody(c, maxBodyLength) : undefined
    const input: JevInput = {
      state: {
        method: req.method,
        url: req.url,
        headers: Object.fromEntries(req.headers),
        ...(body ? { body } : {}),
      },
      routes: this.#routes.map((r) => r.description),
    }
    const result = choose
      ? await choose(c, input)
      : await chooseWithJev(
          input,
          run
            ? (request) => run(c, request)
            : fetchJev({ apiKey: typeof apiKey === 'function' ? apiKey(c) : apiKey, baseURL })
        )
    c.set('jev', result)
    const route = this.#routes.find((r) => r.description === result.route)
    if (!route || result.confidence < threshold) {
      return next()
    }
    const [handler] = route.handler as [(c: Context, next: Next) => Promise<Response>]
    return handler(c, next)
  }
}
