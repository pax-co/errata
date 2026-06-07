import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'

const CALLBACK_PORT = 3000
const CALLBACK_PATH = '/openrouter-oauth-callback'

let callbackServer: Server | null = null
let callbackServerStarting: Promise<void> | null = null

function isAllowedReturnTarget(url: URL) {
  return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    && (url.protocol === 'http:' || url.protocol === 'https:')
}

function sendHtml(res: ServerResponse, status: number, body: string) {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' })
  res.end(`<!doctype html><html><head><title>Errata OpenRouter OAuth</title></head><body>${body}</body></html>`)
}

function handleCallback(req: IncomingMessage, res: ServerResponse, defaultReturnTo: string) {
  const url = new URL(req.url ?? '/', `http://localhost:${CALLBACK_PORT}`)

  if (url.pathname === `${CALLBACK_PATH}/health`) {
    res.writeHead(200, {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
    })
    res.end(JSON.stringify({ ok: true }))
    return
  }

  if (url.pathname !== CALLBACK_PATH) {
    sendHtml(res, 404, '<p>Not found.</p>')
    return
  }

  const code = url.searchParams.get('code')
  const error = url.searchParams.get('error')
  const returnTo = url.searchParams.get('return_to') || defaultReturnTo

  let target: URL
  try {
    target = new URL(returnTo)
  } catch {
    sendHtml(res, 400, '<p>Invalid Errata return URL.</p>')
    return
  }

  if (!isAllowedReturnTarget(target)) {
    sendHtml(res, 400, '<p>Invalid Errata return host.</p>')
    return
  }

  target.searchParams.set('openrouter_oauth', '1')
  if (code) target.searchParams.set('code', code)
  if (error) target.searchParams.set('openrouter_oauth_error', error)

  res.writeHead(302, { location: target.toString() })
  res.end()
}

export function ensureOpenRouterOAuthCallbackBridge() {
  if (callbackServer?.listening || callbackServerStarting) {
    return callbackServerStarting ?? Promise.resolve()
  }

  const appPort = Number(process.env.PORT || 7739)
  const defaultReturnTo = `http://localhost:${Number.isFinite(appPort) && appPort > 0 ? appPort : 7739}/`
  const server = createServer((req, res) => handleCallback(req, res, defaultReturnTo))
  callbackServer = server

  callbackServerStarting = new Promise<void>((resolve) => {
    server.once('error', (err: NodeJS.ErrnoException) => {
      callbackServer = null
      callbackServerStarting = null
      if (err.code === 'EADDRINUSE') {
        console.warn('[openrouter] OAuth callback bridge skipped: localhost:3000 is already in use.')
        resolve()
        return
      }
      console.warn('[openrouter] OAuth callback bridge failed:', err)
      resolve()
    })
    server.listen(CALLBACK_PORT, () => {
      callbackServerStarting = null
      console.info(`[openrouter] OAuth callback bridge listening at http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`)
      resolve()
    })
  })

  return callbackServerStarting
}
