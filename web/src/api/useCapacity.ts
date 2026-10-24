import { keepPreviousData } from '@tanstack/react-query'

import { useGetCapacity } from './generated/endpoints/capacity/capacity'

export type CapacityRange = { from: string; to: string }

/**
 * The capacity grid for a range. The cache is keyed by range, so a slow response for an old range lands in its
 * own entry and never replaces the one on screen; leaving a range aborts its request (the generated client
 * forwards TanStack's signal). While a new range loads, the previous one stays visible (`isPlaceholderData`).
 */
export function useCapacity(range: CapacityRange) {
  return useGetCapacity(range, { query: { placeholderData: keepPreviousData } })
}
