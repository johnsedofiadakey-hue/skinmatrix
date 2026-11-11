// Till setup: a step-by-step check of this till's hardware — receipt printer, cash drawer and customer screen.
// Each step has one test button and a plain "Did it work?" question; a "No" shows what to check. The results and
// settings are saved on this computer only (each till has its own printer). See src/admin/till/device.js.
import { useEffect, useState } from 'react'
import { useOps } from '../hooks.js'
import { Card, Icon, Segmented } from '../components/ui.jsx'
import { PrintArea, printNow } from '../components/receipt.jsx'
import { bridge, canOpenDrawer, directPrinting, hasDesktopApp, openDrawer, printerProblem, printOps, setTill, useTill } from '../till/device.js'
import { ONE_SCREEN_HELP, openCustomerDisplay, swapScreens } from '../till/display.js'
import { TextSlip } from '../till/printing.jsx'
import { printerTestOps } from '../till/escpos.js'
import { fmtFull } from '../components/format.js'
import { backupAvailable, backupInfo, chooseBackupFolder, openBackupFolder } from '../till/backup.js'

// Which printer the "printer works" tick belongs to: changing the printer or paper clears it.
const printerKey = (till) => `${till.printer}|${till.printer === 'network' ? `${till.host}:${till.port}` : till.printerName}|${till.paper}`
const passed = (till, step) => {
  const check = till.checks?.[step]
  if (!check) return null
  if (step === 'printer' && check.key !== printerKey(till)) return null
  if (step === 'drawer' && check.key !== `${printerKey(till)}|${till.kickPin}`) return null
  return check
}
const markPassed = (till, step, ok) => {
  const key = step === 'drawer' ? `${printerKey(till)}|${till.kickPin}` : step === 'printer' ? printerKey(till) : 'display'
  setTill({ checks: { ...(till.checks || {}), [step]: ok ? { at: Date.now(), key } : null } })
}

// Whether the app opens by itself when the computer starts or wakes (desktop/lib/autostart.js).
function autoStartText(info) {
  const auto = info?.autoStart
  if (!auto || auto.ok === null || info.platform !== 'win32') return ''
  if (auto.off) return ' It does not open by itself (switched off in its settings).'
  if (!auto.ok) return ` It could not set itself to open on wake (${auto.error || 'Windows refused'}): open it by hand after waking the computer.`
  return auto.wake ? ' It opens by itself when the computer starts, wakes from sleep or hibernate, or is unlocked.' : ' It opens by itself when the computer starts or is unlocked (opening on wake without unlocking is blocked on this PC).'
}

export default function Till() {
  const till = useTill()
  const app = bridge()
  const [appInfo, setAppInfo] = useState(null)
  useEffect(() => { app?.info?.().then(setAppInfo).catch(() => {}) }, [app])

  const steps = [
    { id: 'printer', label: 'Receipt printer', done: Boolean(passed(till, 'printer')) },
    { id: 'drawer', label: 'Cash drawer', done: !till.drawer || Boolean(passed(till, 'drawer')), skipped: !till.drawer },
    { id: 'display', label: 'Customer screen', done: !till.display || Boolean(passed(till, 'display')), skipped: !till.display },
  ]
  const used = steps.filter((step) => !step.skipped)
  const doneCount = used.filter((step) => step.done).length

  return <div className="stack narrow till-setup">
    <section className="till-progress" aria-label="Till check">
      <div>
        <h2>{doneCount === used.length ? 'This till is ready' : `Check this till’s hardware · ${doneCount} of ${used.length} done`}</h2>
        <p className="muted small">{hasDesktopApp()
          ? <>SkinMatrix Till app{appInfo?.version ? ` ${appInfo.version}` : ''} is running{appInfo?.platform === 'win32' ? ' on Windows' : ''}. Settings here are saved on this computer only.{autoStartText(appInfo)}</>
          : <>This is a web browser, not the SkinMatrix Till app. Receipts print through the print window and the drawer cannot open by itself.</>}</p>
      </div>
      <ol className="till-steps">
        {steps.map((step, index) => <li key={step.id} className={step.skipped ? 'skipped' : step.done ? 'done' : ''}>
          <a href={`#/till`} onClick={(event) => { event.preventDefault(); document.getElementById(`till-${step.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}>
            <span className="till-step-mark">{step.skipped ? '–' : step.done ? <Icon name="check" size={16} /> : index + 1}</span>
            <span>{step.label}{step.skipped ? <small className="muted block">Not used</small> : null}</span>
          </a>
        </li>)}
      </ol>
    </section>

    <PrinterStep till={till} app={app} />
    <DrawerStep till={till} />
    <DisplayStep till={till} app={app} />

    <Card title="After each sale">
      <div className="stack">
        <label className="check big"><input type="checkbox" checked={till.autoPrint} onChange={(event) => setTill({ autoPrint: event.target.checked })} /> Print the receipt by itself after every sale</label>
        {till.drawer ? <label className="check big"><input type="checkbox" checked={till.openOnCash} onChange={(event) => setTill({ openOnCash: event.target.checked })} /> Open the cash drawer after every cash sale and cash refund</label> : null}
      </div>
    </Card>

    <BackupCard />
    <UpdatesCard app={app} info={appInfo} />
  </div>
}

// ── Backup of offline sales on this computer (desktop/lib/backup.js) ──
function BackupCard() {
  const { backup, offlineSales, toast } = useOps()
  const [info, setInfo] = useState(null)
  const available = backupAvailable()
  useEffect(() => { if (available) backupInfo().then(setInfo).catch(() => {}) }, [available])

  if (!available) {
    return <Card title={<span className="row"><Icon name="alertCircle" size={18} /> Backup on this computer</span>}>
      <p className="small muted">{hasDesktopApp()
        ? 'This version of the SkinMatrix Till app cannot keep a backup. Install version 1.4.0 or newer: offline sales are then also saved in Documents on this computer.'
        : 'Only the SkinMatrix Till app can keep a backup on the computer. In a browser, offline sales are kept in the browser only: do not clear its data.'}</p>
    </Card>
  }

  const run = async (work) => {
    try { const next = await work(); if (next) setInfo(next) } catch (error) { toast(error.message, 'error') }
  }
  return <Card title={<span className="row"><Icon name="check" size={18} /> Backup on this computer</span>}>
    <div className="stack">
      <p className="small">Every sale made without internet is also saved on this computer’s disk. If the till app’s own copy is ever lost, the sales are brought back and sent. A log of every offline sale (made, sent, refused) is kept as a spreadsheet you can open in Excel.</p>
      {backup.error ? <p className="callout bad small"><Icon name="alertCircle" /> {backup.error}</p> : null}
      <dl className="facts small">
        <div><dt>Folder</dt><dd>{info?.folders?.[0] || '…'}</dd></div>
        <div><dt>Second copy</dt><dd>{info?.second || 'None. Add a USB stick or OneDrive folder for a copy that survives a broken computer.'}</dd></div>
        <div><dt>Unsent sales</dt><dd>{offlineSales.length}{backup.savedAt ? ` · backed up ${fmtFull(backup.savedAt)}` : ''}</dd></div>
      </dl>
      <div className="row wrap">
        <button type="button" className="btn secondary" onClick={() => run(openBackupFolder)}><Icon name="folder" size={16} /> Open folder</button>
        <button type="button" className="btn ghost" onClick={() => run(() => chooseBackupFolder())}>{info?.second ? 'Change second folder' : 'Add a second folder'}</button>
        {info?.second ? <button type="button" className="btn ghost" onClick={() => run(() => chooseBackupFolder(null))}>Remove second folder</button> : null}
      </div>
    </div>
  </Card>
}

// ── 1. Receipt printer ──
function PrinterStep({ till, app }) {
  const { me, shop, toast } = useOps()
  const [printers, setPrinters] = useState(null)
  const [busy, setBusy] = useState(false)
  const [asked, setAsked] = useState(false)
  const [answer, setAnswer] = useState(null) // 'nothing' | 'garbled' | 'width'
  const [slip, setSlip] = useState(null)
  const check = passed(till, 'printer')

  const loadPrinters = () => app?.listPrinters?.().then(setPrinters).catch(() => setPrinters([]))
  useEffect(() => { loadPrinters() }, [app]) // eslint-disable-line react-hooks/exhaustive-deps

  const label = till.printer === 'network' ? `Network ${till.host || '?'}` : till.printer === 'system' ? till.printerName || '?' : 'Print window'
  const ready = till.printer === 'browser' || (till.printer === 'system' ? Boolean(till.printerName) : Boolean(till.host))
  const test = async () => {
    setBusy(true); setAnswer(null)
    const ops = printerTestOps({ shop, printer: label, paper: till.paper, by: me.name, at: Date.now() })
    try {
      const via = await printOps(ops)
      if (via === 'browser') { setSlip(ops); setTimeout(printNow, 50) }
      setAsked(true)
    } catch (error) {
      toast(printerProblem(error), 'error')
      setAsked(true); setAnswer('nothing')
    }
    setBusy(false)
  }
  const choose = (patch) => { setTill(patch); setAsked(false); setAnswer(null) }

  return <Card title={<StepTitle n={1} title="Receipt printer" ok={check} />} className="till-step" id="till-printer">
    <div className="stack">
      <div className="field"><span>How is the printer connected?</span>
        <div className="choice-grid">
          <Choice on={till.printer === 'system'} disabled={!app} icon="printer" title="USB cable" text="Plugged into this computer" onClick={() => choose({ printer: 'system' })} />
          <Choice on={till.printer === 'network'} disabled={!app} icon="wifi" title="Network" text="Ethernet or Wi-Fi, has an IP address" onClick={() => choose({ printer: 'network' })} />
          <Choice on={till.printer === 'browser'} icon="screen" title="Print window" text="Any printer, through the normal print box" onClick={() => choose({ printer: 'browser' })} />
        </div>
        {!app ? <p className="muted small">USB and network printing need the SkinMatrix Till app on this computer.</p> : null}
      </div>

      {till.printer === 'system' ? <label className="field"><span>Which printer?</span>
        <span className="row">
          <select className="grow" value={till.printerName} onChange={(event) => choose({ printerName: event.target.value })}>
            <option value="">Choose the receipt printer…</option>
            {(printers || []).map((printer) => <option key={printer.name} value={printer.name}>{printer.displayName || printer.name}{printer.isDefault ? ' (default)' : ''}</option>)}
          </select>
          <button type="button" className="btn ghost" onClick={loadPrinters}>Refresh</button>
        </span>
        <small className="muted">Not in the list? Install the printer’s driver on this computer first (it comes on a CD or the maker’s website, e.g. “POS-80”), then press Refresh.</small>
      </label> : null}

      {till.printer === 'network' ? <div className="field-row">
        <label className="field"><span>Printer IP address</span><input inputMode="decimal" placeholder="192.168.1.50" value={till.host} onChange={(event) => choose({ host: event.target.value.trim() })} />
          <small className="muted">Don’t know it? Switch the printer off, hold FEED, switch it on: it prints its settings with the IP.</small></label>
        <label className="field"><span>Port</span><input inputMode="numeric" value={till.port} onChange={(event) => choose({ port: Number(event.target.value.replace(/\D/g, '')) || 9100 })} /><small className="muted">Almost always 9100.</small></label>
      </div> : null}

      {till.printer === 'browser' ? <p className="muted small">In the print box choose the receipt printer, paper 80 mm, margins None, and turn off headers and footers. It remembers next time.</p> : null}

      <div className="field"><span>Paper roll width</span>
        <Segmented label="Paper width" value={String(till.paper)} onChange={(paper) => choose({ paper: Number(paper) })} options={[{ value: '80', label: '80 mm (wide, most shops)' }, { value: '58', label: '58 mm (narrow)' }]} />
      </div>

      <button type="button" className="btn primary large" onClick={test} disabled={busy || !ready}><Icon name="printer" size={18} /> {busy ? 'Printing…' : 'Print a test receipt'}</button>

      {asked ? <div className="till-question" role="group" aria-label="Did the test receipt print?">
        <b>Did the test receipt print correctly?</b>
        <div className="answer-grid">
          <button type="button" className="answer good" onClick={() => { markPassed(till, 'printer', true); setAsked(false); toast('Printer checked. Receipts will print like the test.') }}><Icon name="check" size={18} /> Yes, all clear</button>
          <button type="button" className={`answer ${answer === 'width' ? 'on' : ''}`} onClick={() => setAnswer('width')}>Cut off or too narrow</button>
          <button type="button" className={`answer ${answer === 'garbled' ? 'on' : ''}`} onClick={() => setAnswer('garbled')}>Strange symbols</button>
          <button type="button" className={`answer ${answer === 'nothing' ? 'on' : ''}`} onClick={() => setAnswer('nothing')}>Nothing came out</button>
        </div>
        {answer ? <Fixes kind={answer} printer={till.printer} /> : null}
      </div> : null}

      {check ? <p className="good-text small"><Icon name="check" size={14} /> Tested {fmtFull(check.at)} on {label}.</p> : null}
    </div>
    {slip ? <PrintArea><TextSlip ops={slip} /></PrintArea> : null}
  </Card>
}

function Fixes({ kind, printer }) {
  const tips = {
    width: ['Look at the ruler line of numbers. If it wraps onto two lines, choose 58 mm above. If it stops well short of the edge, choose 80 mm.', 'Then print the test again.'],
    garbled: ['The printer is using a normal “page” driver. In Windows, open Settings → Printers, choose the receipt printer → Printer properties, and use the maker’s POS driver (e.g. “POS-80C”) or “Generic / Text Only”.', 'Or choose Print window above: it works with any driver.'],
    nothing: printer === 'network'
      ? ['Is the printer switched on, with its light on, and the lid closed?', 'Is it on the same network as this computer? Check its cable or Wi-Fi.', 'Check the IP address: switch the printer off, hold FEED and switch it on to print its settings.', 'Is there paper? The shiny side faces the print head (if the roll is in backwards nothing appears).']
      : printer === 'system'
        ? ['Is the printer switched on, with its light on, and the lid closed?', 'Is the USB cable firmly in at both ends? Try another USB port.', 'Is the paper in the right way round? The shiny side faces the print head; if not, the paper comes out blank.', 'In Windows Settings → Printers, open the receipt printer and print a Windows test page. If that fails too, reinstall its driver.', 'Then press Refresh above, choose the printer again and print the test.']
        : ['Did the print box open? If not, allow pop-ups for this site.', 'In the print box, choose the receipt printer (not “Save as PDF”).', 'Is the printer on, with paper, and installed on this computer?'],
  }[kind]
  return <div className="callout warn small">
    <Icon name="alertCircle" />
    <div className="stack" style={{ gap: 6 }}><b>Check these, one at a time:</b><ol className="tips">{tips.map((tip) => <li key={tip}>{tip}</li>)}</ol></div>
  </div>
}

// ── 2. Cash drawer ──
function DrawerStep({ till }) {
  const { toast } = useOps()
  const [asked, setAsked] = useState(false)
  const [failed, setFailed] = useState(false)
  const check = passed(till, 'drawer')
  const direct = directPrinting(till)

  const test = async () => {
    setFailed(false)
    try {
      const opened = await openDrawer()
      if (!opened) { toast('Set up a USB or network printer in step 1 first. The drawer opens through it.', 'error'); return }
      setAsked(true)
    } catch (error) { toast(printerProblem(error), 'error'); setAsked(true); setFailed(true) }
  }

  return <Card title={<StepTitle n={2} title="Cash drawer" ok={check} skipped={!till.drawer} />} className="till-step" id="till-drawer">
    <div className="stack">
      <div className="field"><span>Is a cash drawer plugged into the receipt printer?</span>
        <Segmented label="Cash drawer" value={till.drawer ? 'yes' : 'no'} onChange={(value) => { setTill({ drawer: value === 'yes' }); setAsked(false) }} options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No drawer' }]} />
        <p className="muted small">The drawer’s cable (it looks like a phone plug) goes into the back of the receipt printer, in the socket marked DK or CASH DRAWER — not into the computer.</p>
      </div>
      {till.drawer ? <>
        {!direct ? <p className="callout warn small"><Icon name="alertCircle" /> The drawer opens through the printer, so set up a USB or network printer in step 1 first.</p> : null}
        <button type="button" className="btn primary large" onClick={test} disabled={!canOpenDrawer(till)}><Icon name="drawer" size={18} /> Open the drawer now</button>
        {asked ? <div className="till-question">
          <b>Did the drawer pop open?</b>
          <div className="answer-grid">
            <button type="button" className="answer good" onClick={() => { markPassed(till, 'drawer', true); setAsked(false); toast('Drawer checked.') }}><Icon name="check" size={18} /> Yes, it opened</button>
            <button type="button" className={`answer ${failed ? 'on' : ''}`} onClick={() => setFailed(true)}>No</button>
          </div>
          {failed ? <div className="callout warn small"><Icon name="alertCircle" /><div className="stack" style={{ gap: 6 }}><b>Check these, one at a time:</b><ol className="tips">
            <li>Is the drawer unlocked? Turn its key to the open (unlocked) position.</li>
            <li>Is its cable in the printer’s DK / CASH DRAWER socket, and pushed in until it clicks?</li>
            <li>Try the other connection: <button type="button" className="link-button" onClick={() => { setTill({ kickPin: till.kickPin === 2 ? 5 : 2 }); setFailed(false); setAsked(false) }}>switch to pin {till.kickPin === 2 ? 5 : 2}</button>, then open it again.</li>
            <li>Does the printer itself print (step 1)? The drawer needs the printer to be working.</li>
          </ol></div></div> : null}
        </div> : null}
        <details className="small"><summary>Advanced</summary>
          <div className="stack" style={{ paddingTop: 10 }}>
            <Segmented label="Drawer pin" value={String(till.kickPin)} onChange={(pin) => setTill({ kickPin: Number(pin) })} options={[{ value: '2', label: 'Pin 2 (most drawers)' }, { value: '5', label: 'Pin 5' }]} />
          </div>
        </details>
        {check ? <p className="good-text small"><Icon name="check" size={14} /> Tested {fmtFull(check.at)}.</p> : null}
        <p className="muted small">Opening the drawer here is a test and is not recorded. At the till, use the drawer button on the POS (it asks for a reason and records it).</p>
      </> : null}
    </div>
  </Card>
}

// ── 3. Customer screen ──
function DisplayStep({ till, app }) {
  const { toast } = useOps()
  const [asked, setAsked] = useState(false)
  const [failed, setFailed] = useState(false)
  const check = passed(till, 'display')
  const show = async (preview = false) => {
    setFailed(false)
    const result = await openCustomerDisplay({ preview })
    if (result === 'blocked') { toast('The browser blocked the customer screen. Allow pop-ups for this site, then press again.', 'error'); return }
    if (result === 'none') { toast(ONE_SCREEN_HELP, 'error'); return }
    setAsked(true)
  }
  return <Card title={<StepTitle n={3} title="Customer screen" ok={check} skipped={!till.display} />} className="till-step" id="till-display">
    <div className="stack">
      <div className="field"><span>Is there a second screen facing the customer?</span>
        <Segmented label="Customer screen" value={till.display ? 'yes' : 'no'} onChange={(value) => setTill({ display: value === 'yes' })} options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} />
      </div>
      {till.display ? <>
        <div className="callout small"><Icon name="screen" /><p><b>What customers see:</b> when nobody is buying, a slideshow of products in stock. When you scan or tap an item it appears on their screen with the total. When they pay: the amount, your MoMo number, or the cash they gave and their change. Then “Thank you”, and back to the slideshow. It never shows anything else.</p></div>
        {app?.listScreens ? <Screens onPreview={() => show(true)} /> : null}
        <button type="button" className="btn primary large" onClick={() => show(false)}><Icon name="screen" size={18} /> Show the customer screen</button>
        {!app ? <p className="muted small">In Chrome or Edge, allow “window management” when asked so it opens on the second monitor, then tap it once for full screen. The SkinMatrix Till app does this by itself.</p> : null}
        {asked ? <div className="till-question">
          <b>Can the customer see the SkinMatrix welcome screen, and not you?</b>
          <div className="answer-grid">
            <button type="button" className="answer good" onClick={() => { markPassed(till, 'display', true); setAsked(false); toast('Customer screen checked.') }}><Icon name="check" size={18} /> Yes</button>
            <button type="button" className={`answer ${failed ? 'on' : ''}`} onClick={() => setFailed(true)}>No, it’s on my screen</button>
          </div>
          {failed ? <div className="callout warn small"><Icon name="alertCircle" /><div className="stack" style={{ gap: 6 }}><b>Fix it like this:</b><ol className="tips">
            <li>{app ? 'In the list above, press “Make this the customer screen” on the screen the customer faces. Use “Show numbers” to see which is which.' : 'Drag the customer screen window onto the customer’s monitor, then tap it for full screen.'}</li>
            <li>Only one screen in the list? Press the Windows key + P on the keyboard and choose “Extend”, then come back here.</li>
          </ol></div></div> : null}
        </div> : null}
        <label className="field"><span>Welcome message</span><input value={till.displayMessage} maxLength={120} onChange={(event) => setTill({ displayMessage: event.target.value })} /></label>
        <div className="field-row">
          <label className="field"><span>Shop MoMo number <em>shown when paying by MoMo</em></span><input inputMode="tel" placeholder="024 000 0000" value={till.momoNumber} onChange={(event) => setTill({ momoNumber: event.target.value })} /></label>
          <label className="field"><span>MoMo account name</span><input value={till.momoName} onChange={(event) => setTill({ momoName: event.target.value })} /></label>
        </div>
        {check ? <p className="good-text small"><Icon name="check" size={14} /> Tested {fmtFull(check.at)}.</p> : null}
      </> : null}
    </div>
  </Card>
}

// The monitors the till app can see, which one the customer looks at, and a way to change it.
function Screens({ onPreview }) {
  const { toast } = useOps()
  const app = bridge()
  const [list, setList] = useState(null)
  const refresh = () => app.listScreens().then(setList).catch(() => setList({ screens: [], how: 'none' }))
  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, 4000) // a monitor plugged in or out shows up by itself
    return () => clearInterval(timer)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const choose = async (id) => {
    try { setList(await app.chooseCustomerScreen(id)); toast(id ? 'Saved. The customer screen is on that monitor now.' : 'Back to automatic.') } catch (error) { toast(printerProblem(error), 'error') }
  }
  if (!list) return <p className="muted small">Looking for screens…</p>
  const screens = list.screens || []
  if (screens.length < 2) return <div className="stack">
    <p className="callout warn small"><Icon name="alertCircle" /> {ONE_SCREEN_HELP}</p>
    <div className="row wrap"><button type="button" className="btn secondary" onClick={onPreview}><Icon name="screen" size={16} /> Preview it on this screen</button></div>
  </div>
  return <div className="stack">
    <ul className="screen-list">
      {screens.map((item) => <li key={item.id} className={item.role ? `is-${item.role}` : ''}>
        <span className="screen-number">{item.number}</span>
        <span className="grow"><b>{item.name}</b><span className="muted small">{item.width} × {item.height}{item.touch === 'yes' ? ' · touch' : item.touch === 'no' ? ' · no touch' : ''}</span></span>
        {item.role === 'customer' ? <span className="pill green">Customer screen</span> : item.role === 'till' ? <span className="pill blue">Till (you)</span> : null}
        {item.role !== 'customer' ? <button type="button" className="btn secondary small" onClick={() => choose(item.id)}>Make this the customer screen</button> : null}
      </li>)}
    </ul>
    <p className="muted small">{list.chosen ? 'You chose the customer screen. ' : ''}Customer view on the wrong screen? Press Swap screens (or Ctrl+Shift+S). Not sure which is which? Press Show numbers.</p>
    <div className="row wrap">
      <button type="button" className="btn primary" onClick={async () => { try { setList(await swapScreens()); toast('Swapped. The customer view is on the other screen now.') } catch (error) { toast(printerProblem(error), 'error') } }}><Icon name="swap" size={16} /> Swap screens</button>
      <button type="button" className="btn secondary" onClick={() => app.identifyScreens()}>Show numbers on the screens</button>
      {list.chosen ? <button type="button" className="btn ghost" onClick={() => choose(null)}>Back to automatic</button> : null}
    </div>
  </div>
}

function StepTitle({ n, title, ok, skipped }) {
  return <span className="step-title">
    <span className={`till-step-mark ${ok ? 'done' : ''}`}>{ok ? <Icon name="check" size={16} /> : n}</span>
    {title}
    {ok ? <span className="pill green">Working</span> : skipped ? <span className="pill grey">Not used</span> : <span className="pill amber">Not tested</span>}
  </span>
}

function Choice({ on, disabled, icon, title, text, onClick }) {
  return <button type="button" className={`choice ${on ? 'on' : ''}`} disabled={disabled} aria-pressed={on} onClick={onClick}>
    <Icon name={icon} size={22} /><b>{title}</b><span className="muted small">{text}</span>
  </button>
}

// ── Updates of the till app itself (desktop/lib/updates.js) ──
function UpdatesCard({ app, info }) {
  const { toast } = useOps()
  const [update, setUpdate] = useState(null)
  useEffect(() => { setUpdate(info?.update || null) }, [info])
  if (!app || !info) return null
  if (!info.update) {
    return <Card title="Updates of this app">
      <p className="small muted">This version updates only by installing a new copy. Install SkinMatrix Till 1.6.0 or newer once: after that, new versions arrive by themselves.</p>
    </Card>
  }
  const status = update?.status
  const text = {
    off: 'Automatic updates work only in the installed app on Windows.',
    idle: 'Checks for a new version a minute after starting, then every 4 hours.',
    checking: 'Checking for a new version…',
    current: 'This is the newest version.',
    downloading: `Downloading version ${update?.version || ''}${update?.percent ? ` (${update.percent}%)` : ''} in the background. Keep selling.`,
    ready: `Version ${update?.version || ''} is ready. It installs by itself the next time the computer wakes or the app is closed, or now with the button.`,
    error: 'Could not check for updates (no internet?). It tries again later.',
  }[status] || ''
  const check = async () => { try { setUpdate(await app.checkUpdate()) } catch (error) { toast(error.message, 'error') } }
  const install = async () => { try { await app.installUpdate() } catch (error) { toast(error.message, 'error') } }
  return <Card title="Updates of this app">
    <div className="stack">
      <p className="small">Version {info.version}. {text}</p>
      <div className="row wrap">
        {status === 'ready'
          ? <button type="button" className="btn primary" onClick={install}>Restart and update now</button>
          : status !== 'off' ? <button type="button" className="btn secondary" onClick={check} disabled={status === 'checking' || status === 'downloading'}>Check now</button> : null}
      </div>
    </div>
  </Card>
}
