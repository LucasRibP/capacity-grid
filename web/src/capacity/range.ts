import { addWeeks, endOfIsoWeek, isIsoDate, startOfIsoWeek, weekStartsBetween } from '@/lib/dates'

export type Range = { from: string; to: string }

/** The API rejects more than a quarter; the UI never asks for more. */
export const MAX_WEEKS = 13

export const DEFAULT_RANGE: Range = { from: '2025-12-29', to: '2026-01-16' }

export type NormalizedRange = { range: Range; notice?: string }

/** Last day the API accepts for a range starting on `from`: the Sunday of its 13th ISO week. */
export function lastAllowedDay(from: string): string {
  return endOfIsoWeek(addWeeks(startOfIsoWeek(from), MAX_WEEKS - 1))
}

/**
 * Turns whatever came in (a URL, a picker) into a range the API accepts, and says what changed so the manager is
 * never shown a different range than they asked for without being told.
 */
export function normalizeRange(from: string | null, to: string | null): NormalizedRange {
  if (from === null && to === null) return { range: DEFAULT_RANGE }
  if (from === null || to === null || !isIsoDate(from) || !isIsoDate(to)) {
    return {
      range: DEFAULT_RANGE,
      notice: 'That link had an invalid date range, so the default range is shown.',
    }
  }
  const [start, end] = from <= to ? [from, to] : [to, from]
  if (weekStartsBetween(start, end).length > MAX_WEEKS) {
    return {
      range: { from: start, to: lastAllowedDay(start) },
      notice: `Ranges are limited to ${String(MAX_WEEKS)} weeks, so only the first ${String(MAX_WEEKS)} are shown.`,
    }
  }
  return { range: { from: start, to: end } }
}

export function shiftRange(range: Range, weeks: number): Range {
  return { from: addWeeks(range.from, weeks), to: addWeeks(range.to, weeks) }
}
