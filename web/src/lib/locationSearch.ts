import { useSyncExternalStore } from 'react'

// pushState and replaceState fire no event, so writes notify subscribers themselves.
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  window.addEventListener('popstate', listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('popstate', listener)
  }
}

/** The current `location.search`, re-rendering on writes below and on the back/forward buttons. */
export function useLocationSearch() {
  return useSyncExternalStore(subscribe, () => window.location.search)
}

/**
 * Changes some query parameters and keeps the rest. `push` adds a history entry (the back button undoes it);
 * `replace` rewrites the current one.
 */
export function writeSearchParams(update: (params: URLSearchParams) => void, mode: 'push' | 'replace') {
  const url = new URL(window.location.href)
  update(url.searchParams)
  if (url.href === window.location.href) return
  if (mode === 'push') window.history.pushState(null, '', url)
  else window.history.replaceState(null, '', url)
  for (const listener of listeners) listener()
}
