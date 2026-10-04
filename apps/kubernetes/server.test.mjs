import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { createServer } from 'node:http'
import test from 'node:test'
import { createApp as createServerApp } from './server.mjs'
const createApp = (options) => createServerApp({ uiDist: new URL('../../packages/ui/public', import.meta.url).pathname, ...options })

async function listen(server) {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return `http://127.0.0.1:${server.address().port}`
}

function cleanup(t, ...servers) {
  t.after(() => servers.forEach((server) => { server.closeAllConnections(); server.close() }))
}

test('discovers desired replicas, including zero and a nonzero ordinal start', async (t) => {
  for (const spec of [{ replicas: 3 }, { replicas: 0 }, { replicas: 2, ordinals: { start: 4 } }]) {
    const server = createApp({ discover: async () => spec })
    cleanup(t, server)
    const base = await listen(server)
    const response = await fetch(`${base}/api/backends`)
    const endpoints = await response.json()
    assert.equal(endpoints.length, spec.replicas)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    if (spec.replicas) assert.equal(endpoints[0].url, `/instances/${spec.ordinals?.start || 0}`)
  }
})

test('refreshes after scale changes and fails closed on discovery errors', async (t) => {
  let count = 2
  const server = createApp({ discover: async () => ({ replicas: count }) })
  cleanup(t, server)
  const base = await listen(server)
  assert.equal((await (await fetch(`${base}/api/backends`)).json()).length, 2)
  count = 4
  await new Promise(resolve => setTimeout(resolve, 3050))
  assert.equal((await (await fetch(`${base}/api/backends`)).json()).length, 4)
  const failing = createApp({ discover: async () => { throw new Error('Kubernetes unavailable') } })
  cleanup(t, failing)
  assert.equal((await fetch(`${await listen(failing)}/api/backends`)).status, 503)
})

test('routes writes to the chosen instance, strips credentials, rejects missing instances and foreign origins', async (t) => {
  let received
  const upstream = createServer(async (request, response) => {
    const body = []
    for await (const chunk of request) body.push(chunk)
    received = { path: request.url, method: request.method, headers: request.headers, body: Buffer.concat(body).toString() }
    response.setHeader('Content-Type', 'application/json')
    response.end('{"version":"test"}')
  })
  const target = await listen(upstream)
  const server = createApp({ discover: async () => ({ replicas: 3 }), resolveTarget: () => ({ target, local: true }) })
  cleanup(t, server, upstream)
  const base = await listen(server)
  assert.equal((await fetch(`${base}/instances/2/proxies/AllNodes`, {
    method: 'PUT', body: '{"name":"node-a"}', headers: { Authorization: 'Bearer example', Cookie: 'session=example' },
  })).status, 200)
  assert.equal(received.path, '/proxies/AllNodes')
  assert.equal(received.method, 'PUT')
  assert.equal(received.body, '{"name":"node-a"}')
  assert.equal(received.headers.authorization, undefined)
  assert.equal(received.headers.cookie, undefined)
  assert.equal((await fetch(`${base}/instances/3/version`)).status, 404)
  assert.equal((await fetch(`${base}/instances/0/version`, { headers: { Origin: 'https://foreign.example' } })).status, 503)
})

test('preserves paths when forwarding to another Pod and carries WebSocket upgrades', { timeout: 5000 }, async (t) => {
  let upgradePath
  const upstream = createServer((request, response) => response.end(request.url))
  upstream.on('upgrade', (request, socket) => {
    upgradePath = request.url
    const accept = createHash('sha1').update(request.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64')
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`)
    socket.write(Buffer.from([0x81, 2, 111, 107]))
    socket.on('data', () => socket.end(Buffer.from([0x88, 0])))
    t.after(() => socket.destroy())
  })
  const target = await listen(upstream)
  const server = createApp({ discover: async () => ({ replicas: 3 }), resolveTarget: () => ({ target, local: false }) })
  cleanup(t, server, upstream)
  const base = await listen(server)
  assert.equal(await (await fetch(`${base}/instances/2/version`)).text(), '/instances/2/version')
  const socket = new WebSocket(base.replace('http:', 'ws:') + '/instances/2/traffic')
  t.after(() => socket.close())
  const [message] = await once(socket, 'message')
  assert.equal(message.data, 'ok')
  assert.equal(upgradePath, '/instances/2/traffic')
  socket.close()
})
