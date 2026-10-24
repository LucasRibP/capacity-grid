import { describe, expect, it } from 'vitest'

import { formatHours, weekLoad } from './load'

describe('weekLoad', () => {
  it('fills in proportion to capacity', () => {
    expect(weekLoad(20, 40)).toEqual({ fill: 0.5, over: false, overBy: 0 })
    expect(weekLoad(40, 40)).toEqual({ fill: 1, over: false, overBy: 0 })
  })

  it('flags allocation above capacity', () => {
    expect(weekLoad(48, 40)).toEqual({ fill: 1, over: true, overBy: 8 })
  })

  it('treats any allocation on zero capacity as over, without dividing by zero', () => {
    expect(weekLoad(12, 0)).toEqual({ fill: 1, over: true, overBy: 12 })
    expect(weekLoad(0, 0)).toEqual({ fill: 0, over: false, overBy: 0 })
  })
})

describe('formatHours', () => {
  it('keeps one decimal at most', () => {
    expect(formatHours(40)).toBe('40')
    expect(formatHours(37.5)).toBe('37.5')
    expect(formatHours(0.1 + 0.2)).toBe('0.3')
  })
})
