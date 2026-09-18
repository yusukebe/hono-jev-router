# hono-jev-router

Route HTTP requests by meaning.

`hono-jev-router` is an experimental router for [Hono](https://hono.dev). Instead of a method and a path, you describe a request in plain words, and [Jev](https://typesafe.ai) by TypeSafe AI decides which description fits the incoming request.

```ts
import { Hono } from 'hono'
import { JevRouter } from 'hono-jev-router'

const app = new Hono({
  router: new JevRouter({ apiKey: process.env.TYPESAFE_API_KEY }),
})

app.on('jev', 'a request from an AI agent', (c) => {
  return c.text('# Documentation', 200, { 'Content-Type': 'text/markdown' })
})

app.on('jev', 'a request from a human browser', (c) => {
  return c.html('<h1>Documentation</h1>')
})

app.on('jev', 'suspicious automated traffic', (c) => {
  return c.text('Forbidden', 403)
})

export default app
```

> [!WARNING]
> This is an experiment. Every semantically routed request calls a model, so it adds latency and cost, and the answer is a probability, not a guarantee.

## Install

```bash
npm i hono-jev-router
```

## How it works

```
HTTP Request → JevRouter → Jev: "does the request match this description?" → first match → handler → Response
```

- `app.on('jev', '<description>', handler)` registers a semantic route.
- The method, URL, headers and body of the request are sent to Jev with one yes/no ([Noul](https://docs.typesafe.ai/primitives/noul)) question per description. They are evaluated in parallel in a single call.
- Like a normal router, **the first registered route that matches wins**. A route matches when its probability reaches the `threshold`.
- The handler is a normal Hono handler: `c.req.method` and `c.req.path` are those of the real request.
- If no description matches, the request falls through, usually to `app.notFound()`.
- Everything else works as usual. Path routes and middleware are handled by Hono's `TrieRouter`, and a path route that returns a response wins before Jev is asked.

```ts
app.use(logger())
app.get('/health', (c) => c.text('ok')) // Jev is not called

// Order matters: put specific descriptions first, broad ones last
app.on('jev', 'suspicious automated traffic', (c) => c.text('Forbidden', 403))
app.on('jev', 'any GET request', (c) => c.text('Hello!'))
```

## The result

The decision is available as `c.get('jev')`.

```ts
import type { JevResult } from 'hono-jev-router'

const app = new Hono<{ Variables: { jev: JevResult } }>({ router: new JevRouter({ apiKey }) })

app.on('jev', 'a request from an AI agent', (c) => {
  const { route, confidence, probabilities } = c.get('jev')
  // route: 'a request from an AI agent'
  // confidence: 0.94
  // probabilities: { 'a request from an AI agent': 0.94, 'a request from a human browser': 0.2 }
  return c.json({ route, confidence, probabilities })
})
```

The probabilities are independent of each other, so they do not add up to 1.

## Options

```ts
new JevRouter({
  apiKey, // string | (c) => string
  baseURL, // default: 'https://api.typesafe.ai'
  threshold, // a route matches when its probability is at least this. default: 0.5
  maxBodyLength, // how much of the request body Jev sees. default: 4096
  run, // reach Jev some other way
  choose, // replace the whole decision
})
```

### `threshold`

Raise it to make every route stricter. Requests that match nothing fall through:

```ts
const app = new Hono({ router: new JevRouter({ apiKey, threshold: 0.8 }) })

app.notFound((c) => c.text('Not sure what you are', 404))
```

### `apiKey`

Your TypeSafe API key as a string:

```ts
new JevRouter({ apiKey: process.env.TYPESAFE_API_KEY })
```

On Cloudflare Workers, `process.env` holds your variables and secrets only when the `nodejs_compat` flag is on and the compatibility date is `2025-04-01` or later. Otherwise pass a function. It receives the Context, so the key can come from `c.env`:

```ts
new JevRouter({ apiKey: (c) => c.env.TYPESAFE_API_KEY })
```

### `run`: Workers AI / AI Gateway

Jev is available on Cloudflare as [`typesafe/jev`](https://developers.cloudflare.com/ai/models/typesafe/jev/), so you can use the AI binding instead of an API key:

```ts
type Bindings = { AI: Ai }

const app = new Hono<{ Bindings: Bindings }>({
  router: new JevRouter({
    run: async (c, request) => {
      // If 'typesafe/jev' is not in your generated types yet, cast `c.env.AI`
      const { result } = await c.env.AI.run('typesafe/jev', request, {
        gateway: { id: 'default' },
      })
      return result
    },
  }),
})
```

### `choose`

Replaces the decision itself. It receives the request state, the descriptions and the threshold, and returns a `JevResult`. Useful for tests, caching, or delegating to something that holds the credentials:

```ts
new JevRouter({
  choose: (c, input) => c.env.JEV.choose(input), // input: { state, routes, threshold }
})
```

## Author

Yusuke Wada <https://github.com/yusukebe>

## License

MIT
