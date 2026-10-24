import { useQueryClient } from '@tanstack/react-query'

import { getGetCapacityQueryKey } from './generated/endpoints/capacity/capacity'
import { useUpdatePerson } from './generated/endpoints/people/people'
import type { CapacityGrid, Person } from './generated/model'

/** The grid with this person's weekly hours, and so every week's capacity, replaced. Allocations stay as they are. */
export function withWeeklyHours(grid: CapacityGrid, person: Person): CapacityGrid {
  return {
    ...grid,
    people: grid.people.map((p) =>
      p.id === person.id
        ? {
            ...p,
            weeklyHours: person.weeklyHours,
            weeks: p.weeks.map((week) => ({ ...week, capacityHours: person.weeklyHours })),
          }
        : p,
    ),
  }
}

/**
 * Saves a person's weekly hours. Pessimistic: nothing in the cache changes until the server answers. Then the
 * server's value is written into every cached capacity grid (every range, not just the one on screen) and they are
 * revalidated in the background. Editing capacity never changes allocations, so the patch is exact and the grid
 * updates without waiting for the refetch.
 */
export function useUpdateWeeklyHours() {
  const queryClient = useQueryClient()
  return useUpdatePerson({
    mutation: {
      onSuccess: (person) => {
        const queryKey = getGetCapacityQueryKey()
        queryClient.setQueriesData<CapacityGrid>(
          { queryKey },
          (grid) => grid && withWeeklyHours(grid, person),
        )
        void queryClient.invalidateQueries({ queryKey })
      },
    },
  })
}
