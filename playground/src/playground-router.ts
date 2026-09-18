// What user code gets as 'hono-jev-router' inside the Dynamic Worker:
// the same JevRouter, but Jev is reached through the JEV binding (the API key stays in the host)
import type { Context } from 'hono'
import { JevRouter as BaseJevRouter, type JevRouterOptions } from '../../src/index'

export const RESULT_HEADER = 'x-jev-result'
export const ERROR_HEADER = 'x-jev-error'

export class JevRouter<T> extends BaseJevRouter<T> {
  constructor(options: JevRouterOptions = {}) {
    super({
      choose: async (c: Context, input) => {
        const result = await c.env.JEV.choose(input).catch((e: Error) => {
          c.header(ERROR_HEADER, encodeURIComponent(e.message))
          throw e
        })
        // Report the match to the playground
        c.header(RESULT_HEADER, encodeURIComponent(JSON.stringify(result)))
        return result
      },
      ...options,
    })
  }
}
