'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const net = require('node:net')
const { isLocalHost, paperStatus, printNetwork, toBuffer } = require('../lib/printing.js')
const { cleanUrl, loadConfig } = require('../lib/config.js')
const os = require('node:os')
const fs = require('node:fs')
const path = require('node:path')

test('only accepts byte arrays', () => {
  assert.deepEqual([...toBuffer([27, 64, 255])], [27, 64, 255])
  assert.throws(() => toBuffer([]))
  assert.throws(() => toBuffer([256]))
  assert.throws(() => toBuffer('hello'))
})

test('only reaches printers on the shop network', () => {
  for (const host of ['192.168.1.50', '10.0.0.9', '172.20.1.1', '127.0.0.1']) assert.equal(isLocalHost(host), true, host)
  for (const host of ['8.8.8.8', '172.32.0.1', 'printer.example.com', '192.168.1.999', '']) assert.equal(isLocalHost(host), false, host)
})

test('reads the paper sensor reply', () => {
  assert.equal(paperStatus(0x12), 'ok')
  assert.equal(paperStatus(0x12 | 0x0c), 'low')
  assert.equal(paperStatus(0x12 | 0x60), 'out')
  assert.equal(paperStatus(0xff), 'unknown')
})

function fakePrinter(reply) {
  return new Promise((resolve) => {
    const received = []
    const server = net.createServer((socket) => {
      socket.on('data', (chunk) => {
        received.push(...chunk)
        if (reply !== undefined && chunk[0] === 0x10) socket.write(Buffer.from([reply]))
      })
    })
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, received }))
  })
}

test('sends the receipt to a network printer after the paper check', async () => {
  const { server, port, received } = await fakePrinter(0x12)
  await printNetwork({ host: '127.0.0.1', port, data: Buffer.from([27, 64, 65, 10]) })
  await new Promise((resolve) => setTimeout(resolve, 50))
  server.close()
  assert.deepEqual(received.slice(0, 3), [0x10, 0x04, 4])
  assert.deepEqual(received.slice(3), [27, 64, 65, 10])
})

test('still prints when the printer does not answer the paper check', async () => {
  const { server, port, received } = await fakePrinter(undefined)
  await printNetwork({ host: '127.0.0.1', port, data: Buffer.from([65]), statusTimeout: 100 })
  await new Promise((resolve) => setTimeout(resolve, 50))
  server.close()
  assert.deepEqual(received.slice(3), [65])
})

test('refuses to print when the printer is out of paper', async () => {
  const { server, port } = await fakePrinter(0x12 | 0x60)
  await assert.rejects(printNetwork({ host: '127.0.0.1', port, data: Buffer.from([65]) }), /out of paper/)
  server.close()
})

test('says the printer is not answering when nothing listens', async () => {
  const { server, port } = await fakePrinter(0x12)
  server.close()
  await assert.rejects(printNetwork({ host: '127.0.0.1', port, data: Buffer.from([65]), connectTimeout: 500 }), /not answering/)
})

test('config keeps the shop system on https and /admin', () => {
  assert.equal(cleanUrl('https://skinmatrixgh.com'), 'https://skinmatrixgh.com/admin/')
  assert.equal(cleanUrl('http://localhost:5182/admin/'), 'http://localhost:5182/admin/')
  assert.equal(cleanUrl('http://evil.example.com/admin/'), null)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'till-'))
  const config = loadConfig(dir, { env: {}, argv: [] })
  assert.equal(config.url, 'https://skinmatrixgh.web.app/admin/')
  assert.ok(fs.existsSync(path.join(dir, 'till-config.json')))
  assert.equal(loadConfig(dir, { env: { SKINMATRIX_TILL_URL: 'http://localhost:5182/admin/' }, argv: [] }).url, 'http://localhost:5182/admin/')
})

const { pickScreens, describeScreens } = require('../lib/screens.js')
const monitor = (id, touch, width = 1920, height = 1080, x = 0) => ({ id, touchSupport: touch, bounds: { x, y: 0, width, height }, label: `M${id}` })

test('automatic choice is reversed: customer view on the touch-reporting screen, else on the main display', () => {
  const touchSecond = [monitor(1, 'unavailable'), monitor(2, 'available', 1366, 768, 1920)]
  const picked = pickScreens(touchSecond, { primaryId: 1 })
  assert.deepEqual([picked.till.id, picked.customer.id, picked.reason], [1, 2, 'touch'])
  const unknown = [monitor(1, 'unknown'), monitor(2, 'unknown', 1024, 768, 1920)]
  const guessed = pickScreens(unknown, { primaryId: 1 })
  assert.deepEqual([guessed.till.id, guessed.customer.id, guessed.reason], [2, 1, 'guess'])
})

test('a screen chosen in Till setup wins, and one monitor means no customer screen', () => {
  const two = [monitor(1, 'unknown'), monitor(2, 'unknown', 1024, 768, 1920)]
  const chosen = pickScreens(two, { tillId: 1, customerId: 2, primaryId: 1 })
  assert.deepEqual([chosen.till.id, chosen.customer.id, chosen.reason], [1, 2, 'chosen'])
  const half = pickScreens(two, { customerId: 2, primaryId: 1 })
  assert.deepEqual([half.till.id, half.customer.id], [1, 2])
  const unplugged = pickScreens([monitor(1, 'available')], { tillId: 2, customerId: 1 })
  assert.equal(unplugged.customer, null)
  assert.equal(unplugged.reason, 'one-screen')
  const rows = describeScreens(two, chosen)
  assert.deepEqual(rows.map((row) => row.role), ['till', 'customer'])
})

test('a saved choice survives Windows giving the monitors new ids', () => {
  const { fingerprint } = require('../lib/screens.js')
  const named = (id, label, width, height, x) => ({ id, label, touchSupport: 'unknown', bounds: { x, y: 0, width, height } })
  const before = [named(1, 'POS touch', 1920, 1080, 0), named(2, 'Customer 10in', 1024, 768, 1920)]
  const saved = { tillId: 1, customerId: 2, tillAt: fingerprint(before[0]), customerAt: fingerprint(before[1]) }
  const after = [named(11, 'POS touch', 1920, 1080, 0), named(12, 'Customer 10in', 1024, 768, 1920)]
  const picked = pickScreens(after, { ...saved, primaryId: 12 })
  assert.deepEqual([picked.till.id, picked.customer.id, picked.reason], [11, 12, 'chosen'])
  // Rearranged in Windows display settings, same monitors: found by name and size.
  const moved = [named(21, 'Customer 10in', 1024, 768, -1024), named(22, 'POS touch', 1920, 1080, 0)]
  const again = pickScreens(moved, { ...saved, primaryId: 21 })
  assert.deepEqual([again.till.id, again.customer.id], [22, 21])
})
