import { describe, expect, it } from 'vitest'

import { addWeeks, endOfIsoWeek, formatDay, isIsoDate, startOfIsoWeek, weekStartsBetween } from './dates'

describe('ISO weeks across the 2025/2026 boundary', () => {
  it('starts the week of New Year on Monday 29 December', () => {
    expect(startOfIsoWeek('2026-01-01')).toBe('2025-12-29')
    expect(startOfIsoWeek('2025-12-29')).toBe('2025-12-29')
    expect(startOfIsoWeek('2026-01-04')).toBe('2025-12-29')
    expect(endOfIsoWeek('2025-12-29')).toBe('2026-01-04')
  })

  it('adds weeks across the year in both directions', () => {
    expect(addWeeks('2025-12-29', 1)).toBe('2026-01-05')
    expect(addWeeks('2026-01-05', -1)).toBe('2025-12-29')
    expect(addWeeks('2025-12-22', 2)).toBe('2026-01-05')
  })

  it('lists every week touched by the default range', () => {
    expect(weekStartsBetween('2025-12-29', '2026-01-16')).toEqual(['2025-12-29', '2026-01-05', '2026-01-12'])
    expect(weekStartsBetween('2026-01-16', '2025-12-29')).toEqual([])
  })

  it('formats the day it was given, not the one before', () => {
    expect(formatDay('2025-12-29')).toBe('29 Dec')
    expect(formatDay('2026-01-05', true)).toBe('5 Jan 2026')
  })
})

describe('isIsoDate', () => {
  it('accepts calendar dates only', () => {
    expect(isIsoDate('2024-02-29')).toBe(true)
    expect(isIsoDate('2025-02-29')).toBe(false)
    expect(isIsoDate('2025-1-5')).toBe(false)
    expect(isIsoDate('garbage')).toBe(false)
  })
})
