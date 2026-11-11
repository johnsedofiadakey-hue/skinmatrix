# SkinMatrix Till (desktop app)

A small Electron app for the shop counter. It opens the shop system (`https://skinmatrixgh.web.app/admin/`) full screen and adds the hardware a browser cannot reach:

- **Receipt printer**: ESC/POS bytes go straight to the printer with no print window.
  - USB printers: through the Windows print spooler (RAW).
  - Network printers: TCP port 9100, with a paper-out check first.
- **Cash drawer**: plugged into the printer's DK port. It opens after cash sales and refunds, and with "Open drawer (no sale)".
- **Customer screen**: opened full screen on the second monitor at start-up. It never takes keyboard focus, so barcode scans keep going into the POS.

The page itself keeps working offline: its service worker serves `/admin/`, and offline sales wait in the till's queue. The app adds no data and holds no secrets.

## Build the Windows installer

```bash
cd desktop
npm install
npm run dist:win     # release/SkinMatrix Till Setup 1.0.0.exe (unsigned)
```

Copy the installer to the till PC and run it. The app starts with Windows (`startOnLogin`).

## Settings

The settings file is `%APPDATA%\SkinMatrix Till\till-config.json`:

| Key | Default | Meaning |
| --- | --- | --- |
| `url` | `https://skinmatrixgh.web.app/admin/` | Shop system address. `.web.app` is used because some mobile networks' DNS blocks the `.com`. |
| `fullscreen` | `true` | Start full screen (F11 switches). |
| `kiosk` | `false` | Lock the till full screen. |
| `customerDisplay` | `"auto"` | Open the customer screen on the second monitor (`"off"` to disable). |
| `startOnLogin` | `true` | Start with Windows. |

Printer, drawer and customer-screen choices are set in the shop system under **Till setup**. They are saved per computer.

Keys:
- F5: reload.
- F11: full screen.
- Ctrl+Shift+D: show or hide the customer screen.

## Development

```bash
npm run dev    # against http://localhost:5182/admin/ (npm run dev:local + emulators in the main project)
npm test       # printing transports and config
```

## Hardware notes

- **Printer drivers.** Most 80 mm thermal printers (Epson TM-T20/T82, Xprinter, Rongta) accept RAW jobs through their standard Windows driver. If a printer driver refuses RAW, install the printer as **Generic / Text Only** on its USB port and choose that printer in Till setup.
- **Drawer pin.** The drawer pulse goes to pin 2 by default; some drawers use pin 5 (Till setup → Drawer pin).
- **Not yet tested.** Nothing has been tried on the shop's actual printer, drawer or second screen. The first install needs a test receipt and a drawer test.
