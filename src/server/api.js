import { prepare, run, runBatch, login, logout, userForToken, changePassword, createUser } from './store.js'
import { notifyMemo } from './mail.js'

function tokenFrom(req) {
  const header = req.headers.authorization || ''
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match ? match[1] : ''
}

function send(res, status, body) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(body))
}

function readBody(req) {
  if (req.body != null && req.body !== '') {
    if (typeof req.body === 'string') {
      try { return Promise.resolve(req.body ? JSON.parse(req.body) : {}) }
      catch { return Promise.reject(Object.assign(new Error('Invalid JSON'), { status: 400 })) }
    }
    if (typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return Promise.resolve(req.body)
  }
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', chunk => {
      size += chunk.length
      if (size > 20 * 1024 * 1024) {
        reject(Object.assign(new Error('Payload too large'), { status: 413 }))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw) return resolve({})
      try { resolve(JSON.parse(raw)) }
      catch { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })) }
    })
    req.on('error', reject)
  })
}

function fail(error) {
  const status = error.status || (error.code === 'auth/unauthenticated' ? 401 : 400)
  return { status, body: { message: error.message || 'Request failed', code: error.code || pgCode(error) } }
}

function pgCode(error) {
  if (error.code === '23505') return 'already-exists'
  if (error.code === '23503') return 'failed-precondition'
  if (error.code === '23514') return 'invalid-argument'
  return error.code
}

export async function handleRequest(req, res) {
  const url = new URL(req.url, 'http://localhost')
  if (!url.pathname.startsWith('/api/')) return false
  try {
    await prepare()
    const token = tokenFrom(req)
    if (req.method === 'POST' && url.pathname === '/api/auth/login') {
      const body = await readBody(req)
      const session = await login(body.email, body.password)
      return send(res, 200, session)
    }
    if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
      await logout(token)
      return send(res, 200, { ok: true })
    }
    if (req.method === 'GET' && url.pathname === '/api/auth/me') {
      const user = await userForToken(token)
      if (!user) return send(res, 401, { message: 'Not signed in', code: 'auth/unauthenticated' })
      return send(res, 200, { user })
    }
    if (req.method === 'POST' && url.pathname === '/api/auth/password') {
      const body = await readBody(req)
      await changePassword(token, body.password, body.next)
      return send(res, 200, { ok: true })
    }
    if (req.method === 'POST' && url.pathname === '/api/auth/users') {
      const user = await userForToken(token)
      if (!user) return send(res, 401, { message: 'Not signed in', code: 'auth/unauthenticated' })
      const body = await readBody(req)
      const created = await createUser(body)
      return send(res, 200, created)
    }
    if (req.method === 'POST' && url.pathname === '/api/mail') {
      const user = await userForToken(token)
      if (!user) return send(res, 401, { message: 'Not signed in', code: 'auth/unauthenticated' })
      const body = await readBody(req)
      const result = await notifyMemo({ event: body.event, memoId: body.memoId, comment: body.comment || '' })
      return send(res, 200, result)
    }
    if (req.method === 'POST' && url.pathname === '/api/fs') {
      const user = await userForToken(token)
      if (!user) return send(res, 401, { message: 'Not signed in', code: 'auth/unauthenticated' })
      const body = await readBody(req)
      if (body.op === 'batch') {
        await runBatch(body.ops || [])
        return send(res, 200, { ok: true })
      }
      const result = await run(body)
      return send(res, 200, result == null ? { ok: true } : result)
    }
    return send(res, 404, { message: 'Not found' })
  } catch (error) {
    const mapped = fail(error)
    if (error.code === '23505') mapped.body.message = 'This email address is already registered.'
    if (error.code === '23503') mapped.body.message = 'A related record is missing or still in use.'
    if (error.code === '23514') mapped.body.message = error.message || 'A value is not allowed.'
    return send(res, mapped.status, mapped.body)
  }
}
