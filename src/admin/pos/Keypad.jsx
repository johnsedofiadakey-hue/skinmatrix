import { useEffect, useRef } from 'react'
import { Icon } from '../components/ui.jsx'

// A big on-screen number pad for the touch till. The value is a plain string the parent keeps
// ("120.5"); the physical keyboard works too while the pad is on screen.
//   kind: 'money' (digits and one decimal point, two decimals at most) | 'digits' | 'percent' (0–100)
export function Keypad({ value, onChange, kind = 'money', maxLength = 12, onEnter, keyboard = true }) {
  const valueRef = useRef(value)
  valueRef.current = value
  const press = (key) => {
    const current = valueRef.current || ''
    if (key === 'back') return onChange(current.slice(0, -1))
    if (key === 'clear') return onChange('')
    if (key === '.') {
      if (kind !== 'money' || current.includes('.')) return undefined
      return onChange(current ? `${current}.` : '0.')
    }
    if (!/^\d$/.test(key)) return undefined
    if (current.length >= maxLength) return undefined
    if (kind === 'money' && /\.\d{2}$/.test(current)) return undefined
    const next = current === '0' && kind !== 'digits' ? key : current + key
    if (kind === 'percent' && Number(next) > 100) return undefined
    return onChange(next)
  }
  const pressRef = useRef(press)
  pressRef.current = press
  const enterRef = useRef(onEnter)
  enterRef.current = onEnter

  useEffect(() => {
    if (!keyboard) return undefined
    const onKey = (event) => {
      const tag = event.target?.tagName
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || event.ctrlKey || event.metaKey || event.altKey) return
      if (/^\d$/.test(event.key) || event.key === '.') { event.preventDefault(); pressRef.current(event.key) }
      else if (event.key === 'Backspace') { event.preventDefault(); pressRef.current('back') }
      else if (event.key === 'Delete') { event.preventDefault(); pressRef.current('clear') }
      else if (event.key === 'Enter' && enterRef.current) { event.preventDefault(); enterRef.current() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [keyboard])

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', kind === 'money' ? '.' : 'clear', '0', 'back']
  return <div className="keypad" role="group" aria-label="Number pad">
    {keys.map((key) => <button type="button" key={key} className={`key ${key === 'back' || key === 'clear' ? 'key-soft' : ''}`}
      onClick={() => press(key)} aria-label={key === 'back' ? 'Delete last digit' : key === 'clear' ? 'Clear' : key === '.' ? 'Decimal point' : key}>
      {key === 'back' ? <Icon name="backspace" size={24} /> : key === 'clear' ? 'C' : key}
    </button>)}
  </div>
}

// "120.5" -> "GHS 120.50" style display text for the amount being keyed in.
export const keyedMoney = (text) => {
  if (!text) return '0.00'
  const [whole, part = ''] = text.split('.')
  const cedis = Number(whole || 0).toLocaleString('en-US')
  return text.includes('.') ? `${cedis}.${part.padEnd(2, '0')}` : `${cedis}.00`
}
