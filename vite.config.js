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

export default defineConfig({
  plugins: [react(), adminTrailingSlash()],
  build: {
    rollupOptions: {
      // Two isolated entries: the public storefront and the staff operations prototype.
      input: {
        main: entry('./index.html'),
        admin: entry('./admin/index.html'),
      },
    },
  },
  test: {
    include: ['src/**/*.test.js'],
    environment: 'node',
  },
})
