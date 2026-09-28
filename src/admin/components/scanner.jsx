import { useEffect, useRef, useState } from 'react'
import { Dialog } from './ui.jsx'

// A short confirmation beep so the cashier knows a scan was read without looking at the screen.
export function beep(ok = true) {
  try {
    const context = new (window.AudioContext || window.webkitAudioContext)()
    const tone = context.createOscillator()
    const volume = context.createGain()
    tone.frequency.value = ok ? 1400 : 300
    volume.gain.value = 0.08
    tone.connect(volume).connect(context.destination)
    tone.start()
    tone.stop(context.currentTime + (ok ? 0.08 : 0.25))
    tone.onended = () => context.close()
  } catch { /* no audio: fine */ }
}

// USB and Bluetooth scanners type the code very fast and press Enter. This catches that pattern anywhere on
// the page, except while someone is typing in a text box (those boxes handle Enter themselves).
export function useHardwareScanner(onScan, enabled = true) {
  const handler = useRef(onScan)
  handler.current = onScan
  useEffect(() => {
    if (!enabled) return undefined
    let buffer = ''
    let last = 0
    const onKey = (event) => {
      const tag = event.target?.tagName
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || event.target?.isContentEditable) return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      const now = performance.now()
      const gap = now - last
      last = now
      if (event.key === 'Enter') {
        // Some Bluetooth scanners pause before Enter; accept it for a short while after the last character.
        if (buffer.length >= 4 && gap < 400) { event.preventDefault(); handler.current(buffer) }
        buffer = ''
        return
      }
      if (event.key.length !== 1) return
      // A person types slowly; a scanner sends each character within a few milliseconds.
      buffer = gap > 120 ? event.key : buffer + event.key
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled])
}

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code']

// Scan with the phone or tablet camera. Uses the browser's own barcode reader when it has one (Chrome on
// Android), otherwise loads a small reader library (iPhone Safari). Needs HTTPS and camera permission.
export function CameraScanner({ onScan, onClose, title = 'Scan a barcode' }) {
  const video = useRef(null)
  const onScanRef = useRef(onScan)
  onScanRef.current = onScan
  const [error, setError] = useState('')
  useEffect(() => {
    let stopped = false
    let stream = null
    let controls = null
    let timer = null
    const finish = (code) => {
      if (stopped || !code) return
      stopped = true
      onScanRef.current(String(code).trim())
    }
    ;(async () => {
      try {
        if ('BarcodeDetector' in window) {
          const supported = await window.BarcodeDetector.getSupportedFormats()
          const detector = new window.BarcodeDetector({ formats: FORMATS.filter((format) => supported.includes(format)) })
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
          if (stopped) return
          video.current.srcObject = stream
          await video.current.play()
          const look = async () => {
            if (stopped) return
            try {
              const codes = await detector.detect(video.current)
              if (codes.length) { finish(codes[0].rawValue); return }
            } catch { /* frame not ready */ }
            timer = setTimeout(look, 180)
          }
          look()
        } else {
          const { BrowserMultiFormatReader } = await import('@zxing/browser')
          const reader = new BrowserMultiFormatReader()
          controls = await reader.decodeFromConstraints({ video: { facingMode: { ideal: 'environment' } } }, video.current, (result) => { if (result) finish(result.getText()) })
        }
      } catch (cause) {
        const denied = cause?.name === 'NotAllowedError'
        setError(denied ? 'The camera is blocked. Allow camera access for this site in the browser settings, then try again.' : 'The camera could not start. Type the code instead, or use a barcode scanner.')
      }
    })()
    return () => {
      stopped = true
      clearTimeout(timer)
      stream?.getTracks().forEach((track) => track.stop())
      controls?.stop()
    }
  }, [])

  return <Dialog title={title} onClose={onClose}>
    <div className="stack">
      <div className="camera-frame"><video ref={video} muted playsInline /><span className="camera-target" aria-hidden="true" /></div>
      {error ? <p className="bad-text" role="alert">{error}</p> : <p className="muted small">Hold the barcode inside the box, about a hand's width from the camera. It reads automatically.</p>}
      <button type="button" className="btn ghost block" onClick={onClose}>Close</button>
    </div>
  </Dialog>
}
