// Makes the till app open by itself whenever the shop computer comes on: at sign-in, after waking from sleep or
// hibernate (the power button), and when the screen is unlocked. Windows only.
//
// "Start with Windows" (the login item) only runs at sign-in, and waking from hibernate is not a sign-in, so a
// Windows scheduled task does the rest. It runs as the signed-in user (no administrator needed). If the app is
// already open, the new copy just brings the open one to the front (single-instance lock in main.js).
'use strict'
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFile } = require('node:child_process')

const TASK_NAME = 'SkinMatrix Till (open on wake)'

const xmlText = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// The wake event: Windows logs "The system has returned from a low power state" (Power-Troubleshooter, event 1).
const WAKE_QUERY = `<QueryList><Query Id="0" Path="System"><Select Path="System">*[System[Provider[@Name='Microsoft-Windows-Power-Troubleshooter'] and EventID=1]]</Select></Query></QueryList>`

function taskXml({ exe, user, wakeEvent = true }) {
  const who = `<UserId>${xmlText(user)}</UserId>`
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.3" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>Opens SkinMatrix Till when this computer starts, wakes from sleep or hibernate, or is unlocked.</Description></RegistrationInfo>
  <Triggers>
    <LogonTrigger><Enabled>true</Enabled>${who}<Delay>PT5S</Delay></LogonTrigger>
    <SessionStateChangeTrigger><Enabled>true</Enabled>${who}<StateChange>SessionUnlock</StateChange></SessionStateChangeTrigger>
    <SessionStateChangeTrigger><Enabled>true</Enabled>${who}<StateChange>ConsoleConnect</StateChange></SessionStateChangeTrigger>${wakeEvent ? `
    <EventTrigger><Enabled>true</Enabled><Subscription>${xmlText(WAKE_QUERY)}</Subscription><Delay>PT5S</Delay></EventTrigger>` : ''}
  </Triggers>
  <Principals><Principal id="Author">${who}<LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>Parallel</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Enabled>true</Enabled>
  </Settings>
  <Actions Context="Author"><Exec><Command>"${xmlText(exe)}"</Command><Arguments>--opened-by-windows</Arguments></Exec></Actions>
</Task>
`
}

const run = (file, args) => new Promise((resolve, reject) => {
  execFile(file, args, { windowsHide: true, timeout: 20000 }, (error, stdout, stderr) => (error ? reject(new Error(String(stderr || stdout || error.message).trim())) : resolve(stdout)))
})

// Creates (or replaces) the task. Tries with the wake event first; some locked-down PCs refuse event triggers for
// normal users, and then unlock + sign-in still cover a wake that asks for the password.
async function installTask({ exe, user = `${process.env.USERDOMAIN || os.hostname()}\\${process.env.USERNAME || os.userInfo().username}`, tempDir = os.tmpdir(), schtasks = 'schtasks.exe' } = {}) {
  const file = path.join(tempDir, `skinmatrix-till-task-${process.pid}.xml`)
  const attempt = async (wakeEvent) => {
    // Task Scheduler reads task files as UTF-16 with a byte-order mark.
    fs.writeFileSync(file, Buffer.from(`﻿${taskXml({ exe, user, wakeEvent })}`, 'utf16le'))
    try { await run(schtasks, ['/Create', '/TN', TASK_NAME, '/XML', file, '/F']) } finally { try { fs.unlinkSync(file) } catch { /* gone */ } }
  }
  try {
    await attempt(true)
    return { ok: true, wake: true }
  } catch (first) {
    try {
      await attempt(false)
      return { ok: true, wake: false, note: first.message }
    } catch (second) {
      return { ok: false, error: second.message }
    }
  }
}

const removeTask = ({ schtasks = 'schtasks.exe' } = {}) => run(schtasks, ['/Delete', '/TN', TASK_NAME, '/F']).then(() => true, () => false)

module.exports = { TASK_NAME, taskXml, installTask, removeTask }
