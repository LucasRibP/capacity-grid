import { Search, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

import { MAX_SEARCH_LENGTH, normalizeSearch, useSearchParam } from './useSearchParam'

export const SEARCH_DEBOUNCE_MS = 300

/**
 * Name search box. The input answers every keystroke; only the query in the URL (and so the request) waits until
 * typing pauses for 300 ms. Clearing applies at once.
 */
export function PeopleSearch() {
  const { q, setQ } = useSearchParam()
  const [text, setText] = useState(q)
  const inputRef = useRef<HTMLInputElement>(null)

  // The URL can change without typing (back button, "Clear search" in the empty grid): show what it says, unless
  // the box already means the same thing.
  const [shownQ, setShownQ] = useState(q)
  if (q !== shownQ) {
    setShownQ(q)
    if (normalizeSearch(text) !== q) setText(q)
  }

  useEffect(() => {
    const next = normalizeSearch(text)
    if (next === q) return
    const timer = setTimeout(() => {
      setQ(next)
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
    }
  }, [text, q, setQ])

  const clear = () => {
    setText('')
    setQ('')
    inputRef.current?.focus()
  }

  return (
    <div role="search" className="relative w-full sm:ml-auto sm:w-64">
      <Search
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        ref={inputRef}
        type="search"
        aria-label="Search people"
        placeholder="Search people"
        autoComplete="off"
        spellCheck={false}
        maxLength={MAX_SEARCH_LENGTH}
        value={text}
        onChange={(event) => {
          setText(event.target.value)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && text) {
            event.preventDefault()
            clear()
          }
        }}
        className="pr-8 pl-8 [&::-webkit-search-cancel-button]:hidden"
      />
      {text && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Clear search"
          onClick={clear}
          className="absolute top-1/2 right-0.5 -translate-y-1/2"
        >
          <X aria-hidden />
        </Button>
      )}
    </div>
  )
}
