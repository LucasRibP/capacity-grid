import { keepPreviousData, useIsMutating, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

import { normalizeRange, shiftRange } from '@/capacity/range'

import { getGetCapacityQueryOptions, useGetCapacity } from './generated/endpoints/capacity/capacity'
import { getUpdatePersonMutationKey } from './generated/endpoints/people/people'

export type CapacityRange = { from: string; to: string }

/** A range, optionally narrowed to people whose name matches `q` ('' or absent means everyone). */
export type CapacityQuery = CapacityRange & { q?: string }

/** A prefetched neighbour this recent is not fetched again (also when the client's default is 0, as in tests). */
const NEIGHBOUR_STALE_MS = 30_000

// A blank search is left out, so "everyone" has a single cache entry.
function capacityParams({ from, to, q }: CapacityQuery) {
  return q ? { from, to, q } : { from, to }
}

/**
 * The capacity grid for a range. The cache is keyed by range, so a slow response for an old range lands in its
 * own entry and never replaces the one on screen; leaving a range aborts its request (the generated client
 * forwards TanStack's signal). While a new range loads, the previous one stays visible (`isPlaceholderData`).
 * The name search is part of the key the same way, so typing never flashes the grid and a slow answer for an
 * older search never replaces a newer one.
 *
 * Once the range on screen has settled, the ranges one week back and forward are prefetched under the keys the
 * week buttons will ask for, so stepping a week is instant. Pass `prefetchNeighbours: false` while the request is
 * about to change anyway (a search still being typed).
 */
export function useCapacity(query: CapacityQuery, { prefetchNeighbours = true } = {}) {
  const result = useGetCapacity(capacityParams(query), { query: { placeholderData: keepPreviousData } })
  const settled = result.isSuccess && !result.isFetching && !result.isPlaceholderData
  usePrefetchNeighbours(query, settled && prefetchNeighbours)
  return result
}

/**
 * Prefetches the ranges one week either side of `query` with the same `q`. The neighbour goes through the same
 * normalisation as a range from the URL, and one the UI would fix or reject (over 13 weeks) is skipped. Never runs
 * while a save is pending: the save's patch and revalidation come first, and the neighbours are fetched with the
 * saved value once the grid settles again.
 */
function usePrefetchNeighbours({ from, to, q }: CapacityQuery, enabled: boolean) {
  const queryClient = useQueryClient()
  const saving = useIsMutating({ mutationKey: getUpdatePersonMutationKey() }) > 0

  useEffect(() => {
    if (!enabled || saving) return
    for (const weeks of [-1, 1]) {
      const shifted = shiftRange({ from, to }, weeks)
      const { range, notice } = normalizeRange(shifted.from, shifted.to)
      if (notice) continue
      // A failed prefetch only means the week loads on click, as it did before; nothing to show for it here.
      queryClient
        .query(
          getGetCapacityQueryOptions(capacityParams({ ...range, q }), {
            query: { staleTime: NEIGHBOUR_STALE_MS },
          }),
        )
        .catch(() => undefined)
    }
  }, [enabled, saving, from, to, q, queryClient])
}
