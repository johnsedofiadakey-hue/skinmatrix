import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const entry = (path) => fileURLToPath(new URL(path, import.meta.url))

// Vite only serves admin/index.html for "/admin/"; send the bare "/admin" there too (Firebase uses rewrites).
function adminTrailingSlash() {
  const redirect = (req, res, next) => {
    if (req.url === '/admin' || req.url?.startsWith('/admin?')) {
      res.statusCode = 302
      res.setHeader('Location', req.url.replace('/admin', '/admin/'))
      res.end()
      return
    }
    next()
  }
  return {
    name: 'admin-trailing-slash',
    configureServer: (server) => { server.middlewares.use(redirect) },
    configurePreviewServer: (server) => { server.middlewares.use(redirect) },
  }
}

// Builds /admin/sw.js (from src/admin/sw-template.js) with the list of built files the till keeps for offline use:
// everything the shop system and the customer screen load, but not the storefront's own files.
function adminServiceWorker() {
  return {
    name: 'admin-service-worker',
    apply: 'build',
    generateBundle(_, bundle) {
      const files = new Set()
      const visit = (name) => {
        const chunk = bundle[name]
        if (!chunk || files.has(name)) return
        files.add(name)
        if (chunk.type !== 'chunk') return
        for (const css of chunk.viteMetadata?.importedCss || []) files.add(css)
        for (const next of [...chunk.imports, ...chunk.dynamicImports]) visit(next)
      }
      for (const [name, chunk] of Object.entries(bundle)) {
        if (chunk.type === 'chunk' && chunk.isEntry && ['admin', 'display'].includes(chunk.name)) visit(name)
      }
      const precache = [...files].filter((name) => /\.(js|css)$/.test(name)).map((name) => `/${name}`).sort()
      precache.push('/assets/skinmatrix-logo.png', '/icons/icon-192.png', '/favicon.ico')
      const version = createHash('sha256').update(precache.join('\n')).digest('hex').slice(0, 12)
      const template = readFileSync(entry('./src/admin/sw-template.js'), 'utf8')
      this.emitFile({ type: 'asset', fileName: 'admin/sw.js', source: template.replace('__VERSION__', version).replace('__PRECACHE__', JSON.stringify(precache)) })
    },
  }
}

export default defineConfig({
  plugins: [react(), adminTrailingSlash(), adminServiceWorker()],
  build: {
    rollupOptions: {
      // Two isolated entries: the public storefront and the staff operations prototype.
      input: {
        main: entry('./index.html'),
        admin: entry('./admin/index.html'),
        // The customer-facing second screen at the till (no sign-in, no Firebase).
        display: entry('./admin/display.html'),
      },
    },
  },
  test: {
    include: ['src/**/*.test.js'],
    environment: 'node',
  },
})
