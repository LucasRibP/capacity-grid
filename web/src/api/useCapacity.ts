import { keepPreviousData } from '@tanstack/react-query'

import { useGetCapacity } from './generated/endpoints/capacity/capacity'

export type CapacityRange = { from: string; to: string }

/** A range, optionally narrowed to people whose name matches `q` ('' or absent means everyone). */
export type CapacityQuery = CapacityRange & { q?: string }

/**
 * The capacity grid for a range. The cache is keyed by range, so a slow response for an old range lands in its
 * own entry and never replaces the one on screen; leaving a range aborts its request (the generated client
 * forwards TanStack's signal). While a new range loads, the previous one stays visible (`isPlaceholderData`).
 * The name search is part of the key the same way, so typing never flashes the grid and a slow answer for an
 * older search never replaces a newer one. A blank search is left out, so "everyone" has a single cache entry.
 */
export function useCapacity({ from, to, q }: CapacityQuery) {
  const params = q ? { from, to, q } : { from, to }
  return useGetCapacity(params, { query: { placeholderData: keepPreviousData } })
}
