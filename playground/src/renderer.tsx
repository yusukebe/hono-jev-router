import { jsxRenderer } from 'hono/jsx-renderer'
import { Link, Script, ViteClient } from 'vite-ssr-components/hono'

export const renderer = jsxRenderer(({ children }) => {
  return (
    <html lang='en'>
      <head>
        <meta charset='utf-8' />
        <meta name='viewport' content='width=device-width, initial-scale=1' />
        <title>Jev Router</title>
        <ViteClient />
        <Link href='/src/style.css' rel='stylesheet' />
        <Script src='/src/client.ts' />
      </head>
      <body>{children}</body>
    </html>
  )
})
