// Sends ESC/POS bytes to the receipt printer. Two transports:
//  - network: a printer on the shop network, raw TCP on port 9100 (Epson, Xprinter, Rongta… with Ethernet/Wi-Fi);
//  - system: a printer installed on this computer (usually USB). Windows: the print spooler with the RAW data
//    type through a small PowerShell worker; Mac/Linux: CUPS `lp -o raw`.
// The cash drawer is plugged into the printer, so opening it is just bytes sent the same way.
'use strict'
const { execFile, spawn } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const fs = require('node:fs')
const net = require('node:net')
const path = require('node:path')

const MAX_BYTES = 256 * 1024
const DLE = 0x10
const EOT = 0x04

class PrintError extends Error {}

// The page sends an array of byte values; anything else is refused.
function toBuffer(data) {
  if (!Array.isArray(data) || data.length === 0 || data.length > MAX_BYTES) throw new PrintError('Nothing to print.')
  for (const value of data) if (!Number.isInteger(value) || value < 0 || value > 255) throw new PrintError('The receipt data is not valid.')
  return Buffer.from(data)
}

// Only printers on this computer or the shop's own network (private IPv4 addresses) can be reached.
function isLocalHost(host) {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(host || ''))
  if (!match) return false
  const [a, b, c, d] = match.slice(1).map(Number)
  if ([a, b, c, d].some((part) => part > 255)) return false
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
}

// DLE EOT 4 (paper roll sensor). Fixed bits: 1 and 4 set, 0 and 7 clear.
function paperStatus(byte) {
  if ((byte & 0x93) !== 0x12) return 'unknown'
  if (byte & 0x60) return 'out'
  if (byte & 0x0c) return 'low'
  return 'ok'
}

const OFFLINE = 'The receipt printer is not answering. Check it is switched on and connected to the network.'

// Asks the printer whether it has paper (printers that do not answer still get the job), then sends the bytes.
function printNetwork({ host, port = 9100, data, connectTimeout = 4000, statusTimeout = 700 }) {
  if (!isLocalHost(host)) return Promise.reject(new PrintError('Use the printer’s IP address on the shop network, e.g. 192.168.1.50.'))
  if (!Number.isInteger(port) || port < 1 || port > 65535) return Promise.reject(new PrintError('The printer port must be a number, usually 9100.'))
  return new Promise((resolve, reject) => {
    const socket = new net.Socket()
    let settled = false
    let statusTimer = null
    const finish = (error) => {
      if (settled) return
      settled = true
      clearTimeout(statusTimer)
      socket.destroy()
      if (error) reject(error)
      else resolve()
    }
    const send = () => {
      clearTimeout(statusTimer)
      socket.removeAllListeners('data')
      socket.end(data, () => finish())
    }
    socket.setTimeout(connectTimeout, () => finish(new PrintError(OFFLINE)))
    socket.once('error', () => finish(new PrintError(OFFLINE)))
    socket.connect(port, host, () => {
      socket.once('data', (reply) => {
        if (paperStatus(reply[0]) === 'out') finish(new PrintError('The receipt printer is out of paper. Put in a new roll, then print again.'))
        else send()
      })
      statusTimer = setTimeout(send, statusTimeout)
      socket.write(Buffer.from([DLE, EOT, 4]))
    })
  })
}

// ── Printers installed on this computer ──

// Windows: one PowerShell process stays open with the winspool code loaded, so each receipt prints in a moment
// instead of starting PowerShell every time. It reads "<id>\t<printer name in base64>\t<file>" lines and answers
// "<id>\tok" or "<id>\terror\t<message>".
const WINDOWS_WORKER = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class SkinMatrixRawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFO {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }
  [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool ClosePrinter(IntPtr handle);
  [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern int StartDocPrinter(IntPtr handle, int level, [In] DOCINFO info);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool EndDocPrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool StartPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool EndPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool WritePrinter(IntPtr handle, byte[] bytes, int count, out int written);
  public static void Send(string printer, byte[] data) {
    IntPtr handle;
    if (!OpenPrinter(printer, out handle, IntPtr.Zero)) throw new Exception("Printer not found: " + printer);
    try {
      DOCINFO info = new DOCINFO();
      info.pDocName = "SkinMatrix receipt";
      info.pDataType = "RAW";
      if (StartDocPrinter(handle, 1, info) == 0) throw new Exception("The printer refused the receipt. Check the printer driver.");
      try {
        StartPagePrinter(handle);
        int written;
        if (!WritePrinter(handle, data, data.Length, out written) || written != data.Length) throw new Exception("Not all of the receipt reached the printer.");
        EndPagePrinter(handle);
      } finally { EndDocPrinter(handle); }
    } finally { ClosePrinter(handle); }
  }
}
"@
[Console]::Out.WriteLine('ready')
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  $parts = $line.Split([char]9)
  try {
    $name = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($parts[1]))
    [SkinMatrixRawPrinter]::Send($name, [System.IO.File]::ReadAllBytes($parts[2]))
    [Console]::Out.WriteLine($parts[0] + [char]9 + 'ok')
  } catch {
    $message = $_.Exception.Message -replace '[\r\n\t]', ' '
    [Console]::Out.WriteLine($parts[0] + [char]9 + 'error' + [char]9 + $message)
  }
}
`

function windowsWorker(workDir) {
  let child = null
  let buffer = ''
  const waiting = new Map()
  let ready = null

  const start = () => {
    const script = path.join(workDir, 'raw-printer.ps1')
    fs.writeFileSync(script, WINDOWS_WORKER, 'utf8')
    child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true })
    ready = new Promise((resolve, reject) => {
      const onData = (chunk) => {
        buffer += chunk.toString('utf8')
        let index
        while ((index = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, index).trim()
          buffer = buffer.slice(index + 1)
          if (line === 'ready') { resolve(); continue }
          const [id, status, message] = line.split('\t')
          const job = waiting.get(id)
          if (!job) continue
          waiting.delete(id)
          if (status === 'ok') job.resolve()
          else job.reject(new PrintError(message || 'The printer did not take the receipt.'))
        }
      }
      child.stdout.on('data', onData)
      child.once('error', (error) => reject(new PrintError(`Windows printing could not start: ${error.message}`)))
    })
    child.once('exit', () => {
      for (const job of waiting.values()) job.reject(new PrintError('The print helper stopped. Print again.'))
      waiting.clear()
      child = null
      ready = null
    })
  }

  return {
    async print(printerName, data) {
      if (!child) start()
      await ready
      const id = randomUUID()
      const file = path.join(workDir, `${id}.bin`)
      fs.writeFileSync(file, data)
      try {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => { waiting.delete(id); reject(new PrintError('The printer took too long. Check it is on, then print again.')) }, 20000)
          waiting.set(id, { resolve: () => { clearTimeout(timer); resolve() }, reject: (error) => { clearTimeout(timer); reject(error) } })
          child.stdin.write(`${id}\t${Buffer.from(printerName, 'utf8').toString('base64')}\t${file}\n`)
        })
      } finally {
        fs.rm(file, { force: true }, () => {})
      }
    },
    stop() { child?.kill() },
  }
}

// Mac and Linux (for trying the till on a laptop): CUPS raw queue.
function cupsPrinter(workDir) {
  return {
    async print(printerName, data) {
      const file = path.join(workDir, `${randomUUID()}.bin`)
      fs.writeFileSync(file, data)
      try {
        await new Promise((resolve, reject) => execFile('lp', ['-d', printerName, '-o', 'raw', file], { timeout: 20000 }, (error, _out, stderr) => (
          error ? reject(new PrintError(String(stderr || error.message).trim() || 'The printer did not take the receipt.')) : resolve()
        )))
      } finally {
        fs.rm(file, { force: true }, () => {})
      }
    },
    stop() {},
  }
}

function systemPrinter({ platform = process.platform, workDir }) {
  fs.mkdirSync(workDir, { recursive: true })
  return platform === 'win32' ? windowsWorker(workDir) : cupsPrinter(workDir)
}

module.exports = { PrintError, toBuffer, isLocalHost, paperStatus, printNetwork, systemPrinter, MAX_BYTES }
