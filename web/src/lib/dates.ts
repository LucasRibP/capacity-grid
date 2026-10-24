// Dates travel as `YYYY-MM-DD` strings. Every computation goes through UTC midnight, so the result never depends
// on the browser's timezone (`new Date('2025-12-29')` printed in local time is Dec 28 in Brazil).

const DAY_MS = 86_400_000
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

function toUtc(date: string): Date {
  const match = ISO_DATE.exec(date)
  if (!match) throw new RangeError(`Not a YYYY-MM-DD date: ${date}`)
  const [, y, m, d] = match
  const utc = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)))
  if (utc.toISOString().slice(0, 10) !== date) throw new RangeError(`Not a calendar date: ${date}`)
  return utc
}

function fromUtc(utc: Date): string {
  return utc.toISOString().slice(0, 10)
}

export function isIsoDate(value: string): boolean {
  try {
    toUtc(value)
    return true
  } catch {
    return false
  }
}

export function addDays(date: string, days: number): string {
  return fromUtc(new Date(toUtc(date).getTime() + days * DAY_MS))
}

export function addWeeks(date: string, weeks: number): string {
  return addDays(date, weeks * 7)
}

/** Monday of the ISO week (Monday to Sunday) that contains `date`. */
export function startOfIsoWeek(date: string): string {
  const daysSinceMonday = (toUtc(date).getUTCDay() + 6) % 7
  return addDays(date, -daysSinceMonday)
}

/** Sunday of the ISO week that contains `date`. */
export function endOfIsoWeek(date: string): string {
  return addDays(startOfIsoWeek(date), 6)
}

/** Mondays of every ISO week touched by `from`..`to`, ascending. Empty when `from` is after `to`. */
export function weekStartsBetween(from: string, to: string): string[] {
  const last = startOfIsoWeek(to)
  const weeks: string[] = []
  for (let week = startOfIsoWeek(from); week <= last; week = addWeeks(week, 1)) weeks.push(week)
  return weeks
}

const dayMonth = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const dayMonthYear = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})

/** "29 Dec", or "29 Dec 2025" with the year. */
export function formatDay(date: string, withYear = false): string {
  return (withYear ? dayMonthYear : dayMonth).format(toUtc(date))
}

export function yearOf(date: string): string {
  return date.slice(0, 4)
}
