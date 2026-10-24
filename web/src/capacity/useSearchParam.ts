import { useCallback, useMemo } from 'react'

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
