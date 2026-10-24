import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'

import { useLocationSearch, writeSearchParams } from '@/lib/locationSearch'

/** The contract's limit on `q`; longer input is cut rather than rejected by the API. */
export const MAX_SEARCH_LENGTH = 100

/** Trimmed, with runs of whitespace collapsed; '' means no filter. */
export function normalizeSearch(raw: string | null | undefined) {
  return (raw ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_SEARCH_LENGTH).trim()
}

/**
 * The name search lives in `?q=` next to the range, so reloads and links keep it. Changing it replaces the current
 * history entry: a search is a filter on the page, and one entry per debounced pause would bury the back button.
 */
export function useSearchParam() {
  const search = useLocationSearch()
  const q = useMemo(() => normalizeSearch(new URLSearchParams(search).get('q')), [search])

  const setQ = useCallback((next: string) => {
    const value = normalizeSearch(next)
    writeSearchParams((params) => {
      if (value) params.set('q', value)
      else params.delete('q')
    }, 'replace')
  }, [])

  return { q, setQ }
}

// Whether the search box holds text that has not reached `?q=` yet (the debounce is running). The box and the grid
// are siblings, so the box publishes it here instead of threading it through the page.
let searchPending = false
const pendingListeners = new Set<() => void>()

function setSearchPending(pending: boolean) {
  if (pending === searchPending) return
  searchPending = pending
  for (const listener of pendingListeners) listener()
}

function subscribePending(listener: () => void) {
  pendingListeners.add(listener)
  return () => {
    pendingListeners.delete(listener)
  }
}

/** True while a typed search is waiting for its debounce; the request is about to change. */
export function useSearchPending() {
  return useSyncExternalStore(subscribePending, () => searchPending)
}

/** Called by the search box with whether its text is ahead of the URL. Unmounting clears it. */
export function usePublishSearchPending(pending: boolean) {
  useEffect(() => {
    setSearchPending(pending)
  }, [pending])
  useEffect(
    () => () => {
      setSearchPending(false)
    },
    [],
  )
}
