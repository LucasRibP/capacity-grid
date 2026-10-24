import { useCallback, useMemo } from 'react'

import { useLocationSearch, writeSearchParams } from '@/lib/locationSearch'

import { normalizeRange, type Range } from './range'

/**
 * The range lives in `?from=&to=`, so reloads, links and the back button keep it. A range the API would reject is
 * fixed before any request and `notice` says what was shown instead; the URL keeps what was asked for until the
 * next navigation, so the notice stays visible.
 */
export function useRangeParam() {
  const search = useLocationSearch()
  const { range, notice } = useMemo(() => {
    const params = new URLSearchParams(search)
    return normalizeRange(params.get('from'), params.get('to'))
  }, [search])

  const setRange = useCallback((next: Range) => {
    writeSearchParams((params) => {
      params.set('from', next.from)
      params.set('to', next.to)
    }, 'push')
  }, [])

  return { range, notice, setRange }
}
