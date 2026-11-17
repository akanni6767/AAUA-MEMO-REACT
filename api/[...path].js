import { handleRequest } from '../src/server/api.js'

export const config = {
  api: { bodyParser: false },
  maxDuration: 30,
}

export default async function handler(req, res) {
  try {
    if (!req.url || !req.url.startsWith('/api/')) {
      const parts = Array.isArray(req.query?.path) ? req.query.path : []
      req.url = '/api/' + parts.join('/')
    }
    const handled = await handleRequest(req, res)
    if (handled === false && !res.writableEnded) {
      res.statusCode = 404
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ message: 'Not found' }))
    }
  } catch (error) {
    if (res.writableEnded) return
    res.statusCode = 500
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ message: error.message || 'Server error' }))
  }
}
