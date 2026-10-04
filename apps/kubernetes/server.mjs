import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { get } from 'node:https'
import { fileURLToPath } from 'node:url'
import { createProxyServer } from 'httpxy'
import sirv from 'sirv'

const namespace = process.env.POD_NAMESPACE || 'egress-system'
const statefulset = process.env.STATEFULSET_NAME || 'proxy-engine'
const account = '/var/run/secrets/kubernetes.io/serviceaccount'

export function readStatefulset() {
  return new Promise((resolve, reject) => {
    const request = get(`https://kubernetes.default.svc/apis/apps/v1/namespaces/${namespace}/statefulsets/${statefulset}`, {
      ca: readFileSync(`${account}/ca.crt`),
      headers: { Authorization: `Bearer ${readFileSync(`${account}/token`, 'utf8').trim()}` },
      timeout: 3000,
    }, (response) => {
      if (response.statusCode !== 200) {
        response.resume()
        return reject(new Error('StatefulSet discovery unavailable'))
      }
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('error', reject)
      response.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString()).spec) }
        catch (error) { reject(error) }
      })
    })
    request.on('timeout', () => request.destroy(new Error('Discovery timeout')))
    request.on('error', reject)
  })
}

export function createApp({
  discover = readStatefulset,
  podName = process.env.POD_NAME,
  uiDist = process.env.UI_DIST || '/app/ui-dist',
  publicOrigin = process.env.PUBLIC_ORIGIN || 'https://proxy-engine.ccsn.dev',
  resolveTarget = (ordinal) => {
    const targetPod = `${statefulset}-${ordinal}`
    return targetPod === podName
      ? { target: 'http://127.0.0.1:9090', local: true }
      : { target: `http://${targetPod}.${statefulset}-headless.${namespace}.svc.cluster.local:8080`, local: false }
  },
} = {}) {
  const staticFiles = sirv(uiDist, { single: true, etag: true })
  const proxy = createProxyServer({ changeOrigin: true })
  let cached
  let expires = 0
  async function instances() {
    if (cached && Date.now() < expires) return cached
    const spec = await discover()
    const count = spec.replicas ?? 1
    const start = spec.ordinals?.start ?? 0
    if (!Number.isSafeInteger(count) || count < 0 || !Number.isSafeInteger(start) || start < 0) {
      throw new Error('Invalid StatefulSet replicas')
    }
    cached = Array.from({ length: count }, (_, index) => {
      const ordinal = start + index
      return { id: `managed-${statefulset}-${ordinal}`, label: `${statefulset}-${ordinal}`, url: `/instances/${ordinal}` }
    })
    expires = Date.now() + 3000
    return cached
  }
  async function route(request) {
    if (request.headers.origin && request.headers.origin !== publicOrigin) throw new Error('Invalid origin')
    const match = /^\/instances\/(0|[1-9]\d*)(\/[^#]*)?(\?[^#]*)?$/.exec(request.url)
    if (!match || !(await instances()).some((instance) => instance.url === `/instances/${match[1]}`)) return null
    const upstream = resolveTarget(Number(match[1]))
    if (upstream.local) request.url = `${match[2] || '/'}${match[3] || ''}`
    // OAuth credentials terminate at the gateway; the local Clash API has no secret.
    for (const header of ['authorization', 'cookie', 'x-auth-request-access-token', 'x-forwarded-access-token']) {
      delete request.headers[header]
    }
    return upstream
  }
  const server = createServer(async (request, response) => {
    try {
      if (request.url === '/ui') { response.writeHead(302, { Location: '/ui/' }).end(); return }
      if (request.url.startsWith('/ui/')) request.url = request.url.slice(3)
      if (request.url === '/healthz') {
        response.end('ok')
      }
      else if (request.url === '/config.js') {
        response.setHeader('Content-Type', 'application/javascript')
        response.setHeader('Cache-Control', 'no-store')
        response.end('window.__METACUBEXD_CONFIG__ = {backendDiscoveryURL:"/api/backends"};')
      }
      else if (request.url === '/api/backends') {
        response.setHeader('Content-Type', 'application/json')
        response.setHeader('Cache-Control', 'no-store')
        response.end(JSON.stringify(await instances()))
      }
      else if (request.url.startsWith('/instances/')) {
        const upstream = await route(request)
        if (!upstream) { response.writeHead(404).end(); return }
        await proxy.web(request, response, { target: upstream.target })
      }
      else if (request.url.startsWith('/api/')) {
        response.writeHead(404).end()
      }
      else staticFiles(request, response)
    }
    catch {
      if (!response.headersSent) response.writeHead(503)
      response.end('Instance unavailable')
    }
  })
  server.on('upgrade', async (request, socket, head) => {
    try {
      const upstream = await route(request)
      if (!upstream) { socket.destroy(); return }
      await proxy.ws(request, socket, { target: upstream.target }, head)
    }
    catch { socket.destroy() }
  })
  return server
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = createApp()
  server.listen(Number(process.env.PORT || 8080), '0.0.0.0')
  process.on('SIGTERM', () => {
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 10000).unref()
  })
}
