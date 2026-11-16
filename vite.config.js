import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { handleRequest } from './src/server/api.js'

function apiPlugin() {
  const handle = (req, res, next) => {
    handleRequest(req, res).then(handled => {
      if (handled === false) next()
    }).catch(error => {
      res.statusCode = 500
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ message: error.message || 'Server error' }))
    })
  }
  return {
    name: 'aaua-api',
    configureServer(server) { server.middlewares.use(handle) },
    configurePreviewServer(server) { server.middlewares.use(handle) },
  }
}

export default defineConfig({
  plugins: [apiPlugin(), react()],
  build: {
    outDir: 'dist'
  }
})
