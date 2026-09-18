import { jsxRenderer } from 'hono/jsx-renderer'
import { Link, Script, ViteClient } from 'vite-ssr-components/hono'

const TITLE = 'Jev Router for Hono'
const DESCRIPTION =
  'Route HTTP requests by meaning. Describe a request in plain words and Jev decides which handler answers.'

export const renderer = jsxRenderer(({ children }, c) => {
  const url = new URL(c.req.url)
  const image = new URL('/og.png', url).href
  return (
    <html lang='en'>
      <head>
        <meta charset='utf-8' />
        <meta name='viewport' content='width=device-width, initial-scale=1' />
        <title>{TITLE}</title>
        <meta name='description' content={DESCRIPTION} />
        <link rel='icon' href='/favicon.ico' />
        <meta property='og:type' content='website' />
        <meta property='og:title' content={TITLE} />
        <meta property='og:description' content={DESCRIPTION} />
        <meta property='og:url' content={url.origin} />
        <meta property='og:image' content={image} />
        <meta property='og:image:width' content='1200' />
        <meta property='og:image:height' content='630' />
        <meta name='twitter:card' content='summary_large_image' />
        <meta name='twitter:title' content={TITLE} />
        <meta name='twitter:description' content={DESCRIPTION} />
        <meta name='twitter:image' content={image} />
        <ViteClient />
        <Link href='/src/style.css' rel='stylesheet' />
        <Script src='/src/client.ts' />
      </head>
      <body>{children}</body>
    </html>
  )
})
