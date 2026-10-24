import { delay, http, HttpResponse } from 'msw'

import { MAX_WEEKS } from '@/capacity/range'
import { endOfIsoWeek, isIsoDate, startOfIsoWeek, weekStartsBetween } from '@/lib/dates'

import type { CapacityGrid, Error as ApiErrorBody, PersonCapacity } from '../generated/model'

// Shaped like the seed: shared first names, non-ASCII letters, one person with 0 weekly hours.
export const mockPeople: { id: number; name: string; weeklyHours: number }[] = [
  { id: 1, name: 'Ana Ferreira', weeklyHours: 40 },
  { id: 2, name: 'Ana Lima', weeklyHours: 32 },
  { id: 3, name: 'Bjørn Þórsson', weeklyHours: 32 },
  { id: 4, name: 'Chiara Rossi', weeklyHours: 40 },
  { id: 5, name: 'Eli Nakamura', weeklyHours: 0 },
  { id: 6, name: 'Fatima Haddad', weeklyHours: 24 },
  { id: 7, name: 'Jonas Öberg', weeklyHours: 40 },
  { id: 8, name: 'Mei Chen', weeklyHours: 36 },
  { id: 9, name: 'Olu Adeyemi', weeklyHours: 40 },
  { id: 10, name: 'Søren Dahl', weeklyHours: 20 },
]

// Deterministic per person and week, so the grid looks the same on every reload.
function allocatedHours(personId: number, weekStart: string): number {
  if (personId === 6) return 0 // someone with nothing planned
  let hash = personId * 31
  for (const char of weekStart) hash = (hash * 33 + char.charCodeAt(0)) % 9973
  return (hash % 13) * 4 // 0 to 48 h, in half-day steps
}

function errorResponse(status: number, body: ApiErrorBody) {
  return HttpResponse.json(body, { status })
}

export function buildCapacityGrid(from: string, to: string): CapacityGrid {
  const weeks = weekStartsBetween(from, to)
  const people: PersonCapacity[] = mockPeople.map((person) => ({
    ...person,
    weeks: weeks.map((weekStart) => ({
      weekStart,
      allocatedHours: allocatedHours(person.id, weekStart),
      capacityHours: person.weeklyHours,
    })),
  }))
  return { from: startOfIsoWeek(from), to: endOfIsoWeek(to), weeks, people }
}

/** Mirrors the contract's validation, so the UI meets the same 400s it will get from the API. */
export const capacityHandler = http.get('*/capacity', async ({ request }) => {
  await delay()
  const params = new URL(request.url).searchParams
  const from = params.get('from') ?? ''
  const to = params.get('to') ?? ''
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) {
    return errorResponse(400, {
      code: 'validation_failed',
      message: 'Pick a start date before the end date.',
    })
  }
  if (weekStartsBetween(from, to).length > MAX_WEEKS) {
    return errorResponse(400, { code: 'range_too_large', message: 'Pick a range of 13 weeks or fewer.' })
  }
  return HttpResponse.json(buildCapacityGrid(from, to))
})
