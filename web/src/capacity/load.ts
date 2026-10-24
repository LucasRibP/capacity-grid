export type WeekLoad = {
  /** Share of capacity used, for the fill bar: 0 to 1. Over-allocated weeks are full. */
  fill: number
  over: boolean
  /** Hours above capacity; 0 when not over. */
  overBy: number
}

/**
 * How full a person's week is. Any allocation on a zero-capacity week is over-allocation (Eli Nakamura has 0 weekly
 * hours and still gets assignments), and no division happens when capacity is zero.
 */
export function weekLoad(allocatedHours: number, capacityHours: number): WeekLoad {
  const over = allocatedHours > capacityHours
  if (over) return { fill: 1, over, overBy: allocatedHours - capacityHours }
  return { fill: capacityHours > 0 ? allocatedHours / capacityHours : 0, over, overBy: 0 }
}

/** Hours with at most one decimal: 40, 37.5. */
export function formatHours(hours: number): string {
  return String(Math.round(hours * 10) / 10)
}

/** Contract bounds for `UpdatePerson.weeklyHours`; the editor checks them before sending. */
export const MIN_WEEKLY_HOURS = 0
export const MAX_WEEKLY_HOURS = 168

/** The typed hours as a number, or undefined when they are not a number within the contract's bounds. */
export function parseWeeklyHours(text: string): number | undefined {
  const trimmed = text.trim().replace(',', '.')
  if (trimmed === '') return undefined
  const hours = Number(trimmed)
  if (!Number.isFinite(hours) || hours < MIN_WEEKLY_HOURS || hours > MAX_WEEKLY_HOURS) return undefined
  return hours
}
