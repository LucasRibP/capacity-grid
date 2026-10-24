import type { CapacityGrid } from '@/api/generated/model'
import { weekStartsBetween } from '@/lib/dates'

/** A production-sized grid: `count` people over the 13 weeks from 2025-12-29, names in sort order. */
export function largeGrid(count = 3000): CapacityGrid {
  const weeks = weekStartsBetween('2025-12-29', '2026-03-29')
  return {
    from: '2025-12-29',
    to: '2026-03-29',
    weeks,
    people: Array.from({ length: count }, (_, i) => ({
      id: i + 1,
      name: `Person ${String(i + 1).padStart(4, '0')}`,
      weeklyHours: 40,
      weeks: weeks.map((weekStart, w) => ({
        weekStart,
        allocatedHours: ((i + w) % 13) * 4,
        capacityHours: 40,
      })),
    })),
  }
}
