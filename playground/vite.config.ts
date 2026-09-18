import { cloudflare } from '@cloudflare/vite-plugin'
import { build } from 'esbuild'
import { defineConfig, type Plugin } from 'vite'
import ssrPlugin from 'vite-ssr-components/plugin'

// What user code can import inside the Dynamic Worker, bundled into strings
const entries = {
  hono: 'hono',
  // The package in ../src, with Jev wired to the JEV binding
  'hono-jev-router': './src/playground-router.ts',
}

const dynamicWorkerModules = (): Plugin => {
  const id = 'virtual:dynamic-worker-modules'
  return {
    name: 'dynamic-worker-modules',
    resolveId: (source) => (source === id ? `\0${id}` : undefined),
    async load(loadedId) {
      if (loadedId !== `\0${id}`) {
        return
      }
      const bundles = await Promise.all(
        Object.entries(entries).map(async ([name, entry]) => {
          const result = await build({
            entryPoints: [entry],
            bundle: true,
            format: 'esm',
            target: 'es2022',
            minify: true,
            write: false,
            metafile: true,
          })
          Object.keys(result.metafile.inputs).forEach((input) => this.addWatchFile(input))
          return [name, result.outputFiles[0].text]
        })
      )
      return `export const modules = ${JSON.stringify(Object.fromEntries(bundles))}`
    },
  }
}

export default defineConfig({
  plugins: [dynamicWorkerModules(), cloudflare(), ssrPlugin()],
})
