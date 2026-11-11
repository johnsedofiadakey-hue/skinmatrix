import { describe, expect, it } from 'vitest'
import { tillWarnings } from './risks.js'

const DAY = 24 * 60 * 60 * 1000
const now = Date.UTC(2026, 10, 11, 10)
const sale = (ageDays, status = 'waiting') => ({ requestId: `r${ageDays}`, at: now - ageDays * DAY, status })

describe('tillWarnings', () => {
  it('is quiet when all is well', () => {
    expect(tillWarnings({ online: true, offlineSales: [], backup: { available: true }, clockSkew: 30000, now })).toEqual([])
  })

  it('warns about a wrong clock in either direction', () => {
    expect(tillWarnings({ online: true, clockSkew: 20 * 60000, now })[0].text).toMatch(/20 minutes fast/)
    expect(tillWarnings({ online: true, clockSkew: -3 * 3600000, now })[0].text).toMatch(/3 hours slow/)
  })

  it('warns as unsent sales get old while offline, urgently near the 7-day limit', () => {
    expect(tillWarnings({ online: false, offlineSales: [sale(1)], now })).toEqual([])
    const two = tillWarnings({ online: false, offlineSales: [sale(2), sale(0)], now })
    expect(two[0]).toMatchObject({ key: 'age', tone: 'warn' })
    expect(two[0].text).toMatch(/2 days old/)
    expect(tillWarnings({ online: false, offlineSales: [sale(6)], now })[0].tone).toBe('bad')
    expect(tillWarnings({ online: false, offlineSales: [sale(8)], now })[0].text).toMatch(/more than 7 days/)
  })

  it('ignores refused sales and the age while online (they are being sent)', () => {
    expect(tillWarnings({ online: false, offlineSales: [sale(4, 'problem')], now })).toEqual([])
    expect(tillWarnings({ online: true, offlineSales: [sale(4)], now })).toEqual([])
  })

  it('shows a backup failure only when there is something to back up', () => {
    const backup = { available: true, error: 'Disk full' }
    expect(tillWarnings({ online: false, offlineSales: [], backup, now })).toEqual([])
    expect(tillWarnings({ online: false, offlineSales: [sale(0)], backup, now })[0]).toMatchObject({ key: 'backup', text: 'Disk full' })
  })
})
