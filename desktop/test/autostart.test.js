'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { TASK_NAME, taskXml, installTask } = require('../lib/autostart.js')

test('the task opens the app at sign-in, unlock and on waking, as the user, with no time limit', () => {
  const xml = taskXml({ exe: 'C:\\Users\\Shop & Co\\AppData\\Local\\Programs\\skinmatrix-till\\SkinMatrix Till.exe', user: 'TILL\\Shop' })
  assert.match(xml, /<LogonTrigger>/)
  assert.match(xml, /<StateChange>SessionUnlock<\/StateChange>/)
  assert.match(xml, /Power-Troubleshooter/)
  assert.match(xml, /EventID=1/)
  assert.match(xml, /<LogonType>InteractiveToken<\/LogonType>/)
  assert.match(xml, /<RunLevel>LeastPrivilege<\/RunLevel>/)
  assert.match(xml, /<ExecutionTimeLimit>PT0S<\/ExecutionTimeLimit>/)
  assert.match(xml, /<DisallowStartIfOnBatteries>false/)
  assert.match(xml, /Shop &amp; Co/) // escaped
  assert.doesNotMatch(xml, /<Select Path="System">/) // the event query is escaped inside the XML
  assert.doesNotMatch(taskXml({ exe: 'x.exe', user: 'u', wakeEvent: false }), /EventTrigger/)
})

// A stand-in for schtasks.exe: records its arguments and the task file, and can refuse wake-event tasks.
function fakeSchtasks(dir, { refuseEvent = false, refuseAll = false } = {}) {
  const log = path.join(dir, 'calls.log')
  const script = path.join(dir, 'schtasks.sh')
  fs.writeFileSync(script, `#!/bin/sh
xml="$5"
echo "$@" >> "${log}"
cp "$xml" "${dir}/last.xml"
${refuseAll ? 'echo "ERROR: Access is denied." >&2; exit 1' : ''}
${refuseEvent ? `if iconv -f UTF-16 -t UTF-8 "$xml" | grep -q EventTrigger; then echo "ERROR: Access is denied." >&2; exit 1; fi` : ''}
exit 0
`)
  fs.chmodSync(script, 0o755)
  return { script, log }
}

test('creates the task from a UTF-16 file and cleans the file up', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'till-task-'))
  const { script, log } = fakeSchtasks(dir)
  const result = await installTask({ exe: 'C:\\Till\\SkinMatrix Till.exe', user: 'TILL\\Shop', tempDir: dir, schtasks: script })
  assert.deepEqual(result, { ok: true, wake: true })
  assert.match(fs.readFileSync(log, 'utf8'), new RegExp(`/Create /TN ${TASK_NAME.replace(/[()]/g, '\\$&')} /XML .* /F`))
  const saved = fs.readFileSync(path.join(dir, 'last.xml'))
  assert.equal(saved[0], 0xff) // UTF-16 LE byte-order mark
  assert.equal(saved[1], 0xfe)
  assert.match(saved.toString('utf16le'), /SkinMatrix Till\.exe/)
  assert.equal(fs.readdirSync(dir).some((name) => name.startsWith('skinmatrix-till-task-')), false)
})

test('falls back to sign-in and unlock when the PC refuses the wake event', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'till-task-'))
  const { script } = fakeSchtasks(dir, { refuseEvent: true })
  const result = await installTask({ exe: 'C:\\Till\\SkinMatrix Till.exe', user: 'TILL\\Shop', tempDir: dir, schtasks: script })
  assert.equal(result.ok, true)
  assert.equal(result.wake, false)
})

test('reports when Windows refuses the task altogether', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'till-task-'))
  const { script } = fakeSchtasks(dir, { refuseAll: true })
  const result = await installTask({ exe: 'C:\\Till\\SkinMatrix Till.exe', user: 'TILL\\Shop', tempDir: dir, schtasks: script })
  assert.equal(result.ok, false)
  assert.match(result.error, /Access is denied/)
})
