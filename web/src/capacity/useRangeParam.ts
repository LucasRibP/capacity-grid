import { useCallback, useMemo, useSyncExternalStore } from 'react'

import { normalizeRange, type Range } from './range'

// pushState fires no event, so writes notify subscribers themselves.
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  window.addEventListener('popstate', listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('popstate', listener)
  }
}

function pushRange(range: Range) {
  const url = new URL(window.location.href)
  url.searchParams.set('from', range.from)
  url.searchParams.set('to', range.to)
  window.history.pushState(null, '', url)
  for (const listener of listeners) listener()
}

/**
 * The range lives in `?from=&to=`, so reloads, links and the back button keep it. A range the API would reject is
 * fixed before any request and `notice` says what was shown instead; the URL keeps what was asked for until the
 * next navigation, so the notice stays visible.
 */
export function useRangeParam() {
  const search = useSyncExternalStore(subscribe, () => window.location.search)
  const { range, notice } = useMemo(() => {
    const params = new URLSearchParams(search)
    return normalizeRange(params.get('from'), params.get('to'))
  }, [search])

  const setRange = useCallback((next: Range) => {
    pushRange(next)
  }, [])

  return { range, notice, setRange }
}
