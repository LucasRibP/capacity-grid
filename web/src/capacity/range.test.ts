import { describe, expect, it } from 'vitest'

import { DEFAULT_RANGE, normalizeRange, shiftRange } from './range'

describe('normalizeRange', () => {
  it('uses the default range when the URL has none', () => {
    expect(normalizeRange(null, null)).toEqual({ range: DEFAULT_RANGE })
  })

  it('falls back to the default, and says so, for dates that do not exist', () => {
    const { range, notice } = normalizeRange('2025-02-30', '2025-03-10')
    expect(range).toEqual(DEFAULT_RANGE)
    expect(notice).toMatch(/invalid date range/)
  })

  it('swaps a reversed range', () => {
    expect(normalizeRange('2026-01-16', '2025-12-29')).toEqual({
      range: { from: '2025-12-29', to: '2026-01-16' },
    })
  })

  it('keeps exactly 13 weeks and clamps longer ranges to the Sunday of the 13th week', () => {
    expect(normalizeRange('2025-12-29', '2026-03-29').notice).toBeUndefined()
    const { range, notice } = normalizeRange('2025-12-31', '2026-06-30')
    expect(range).toEqual({ from: '2025-12-31', to: '2026-03-29' })
    expect(notice).toMatch(/limited to 13 weeks/)
  })
})

describe('shiftRange', () => {
  it('moves both ends a week across the year boundary', () => {
    expect(shiftRange({ from: '2025-12-22', to: '2026-01-09' }, 1)).toEqual({
      from: '2025-12-29',
      to: '2026-01-16',
    })
    expect(shiftRange({ from: '2026-01-05', to: '2026-01-11' }, -1)).toEqual({
      from: '2025-12-29',
      to: '2026-01-04',
    })
  })
})
