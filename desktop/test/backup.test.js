'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { appendLog, readUnsent, saveUnsent, csvLine } = require('../lib/backup.js')

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'till-backup-'))
const sale = (id) => ({ requestId: id, at: Date.UTC(2026, 10, 11, 9), clientTotal: 12500, localNumber: `A-${id}`, lines: [{ productId: 'p1', quantity: 2 }], items: [{ name: 'Serum', quantity: 2 }], payment: { method: 'cash' }, status: 'waiting' })

test('saves and reads back the unsent sales, newest copy wins', () => {
  const one = temp()
  const two = temp()
  saveUnsent([one], { uid: 'staff_1', name: 'Ama', sales: [sale('a')], pending: [] })
  saveUnsent([one, two], { uid: 'staff_1', name: 'Ama', sales: [sale('a'), sale('b')], pending: [{ name: 'recordNoSale', data: { requestId: 'n1' } }] })
  const back = readUnsent([one, two], 'staff_1')
  assert.deepEqual(back.sales.map((entry) => entry.requestId), ['a', 'b'])
  assert.equal(back.pending.length, 1)
  assert.equal(readUnsent([one], 'someone_else'), null)
  assert.equal(fs.readdirSync(one).some((name) => name.endsWith('.tmp')), false)
})

test('an empty list is saved too, so sent sales are not brought back', () => {
  const dir = temp()
  saveUnsent([dir], { uid: 'u1', sales: [sale('a')], pending: [] })
  saveUnsent([dir], { uid: 'u1', sales: [], pending: [] })
  assert.deepEqual(readUnsent([dir], 'u1').sales, [])
})

test('a damaged copy is ignored in favour of a good one', () => {
  const bad = temp()
  const good = temp()
  fs.writeFileSync(path.join(bad, 'unsent-u1.json'), '{"kind":"skinmatrix-unsent","uid":"u1","sales":[')
  saveUnsent([good], { uid: 'u1', sales: [sale('a')], pending: [] })
  assert.equal(readUnsent([bad, good], 'u1').sales.length, 1)
})

test('one folder failing (USB unplugged) still saves the other; all failing is an error', () => {
  const dir = temp()
  const blocker = path.join(temp(), 'file')
  fs.writeFileSync(blocker, 'x')
  const result = saveUnsent([dir, path.join(blocker, 'inside')], { uid: 'u1', sales: [sale('a')], pending: [] })
  assert.equal(result.folders.length, 1)
  assert.equal(result.failed.length, 1)
  assert.throws(() => saveUnsent([path.join(blocker, 'inside')], { uid: 'u1', sales: [], pending: [] }), /could not be saved/)
})

test('refuses odd staff ids (no writing outside the folder)', () => {
  const dir = temp()
  assert.throws(() => saveUnsent([dir], { uid: '../evil', sales: [], pending: [] }), /Unknown staff/)
  assert.throws(() => readUnsent([dir], '..\\evil'), /Unknown staff/)
})

test('the log is a monthly CSV with a header, only ever added to', () => {
  const dir = temp()
  const row = { event: 'made', at: Date.UTC(2026, 10, 11, 9, 30), localNumber: 'A-1', cashier: 'Ama', items: '2 x Serum', total: 12500, payment: 'cash' }
  appendLog([dir], [row])
  appendLog([dir], [{ ...row, event: 'sent', saleNumber: '1042' }])
  const text = fs.readFileSync(path.join(dir, 'offline-sales-2026-11.csv'), 'utf8')
  assert.ok(text.startsWith('﻿Time (GMT),What happened'))
  const lines = text.trim().split('\r\n')
  assert.equal(lines.length, 3)
  assert.match(lines[1], /made,A-1,,Ama,2 x Serum,125\.00,cash/)
  assert.match(lines[2], /sent,A-1,1042/)
  assert.throws(() => appendLog([dir], [{ event: 'hack' }]), /Unknown log entry/)
})

test('CSV cells cannot run as Excel formulas and keep commas and quotes', () => {
  assert.equal(csvLine(['=HYPERLINK("x")', 'a,b', 'Say "hi"']), `"'=HYPERLINK(""x"")","a,b","Say ""hi"""\r\n`)
})
