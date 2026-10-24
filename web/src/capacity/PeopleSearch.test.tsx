import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { delay, http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildCapacityGrid, mockPeople } from '@/api/mocks/capacity'
import { App } from '@/App'
import { renderWithProviders } from '@/test/render'
import { server } from '@/test/server'

import { SEARCH_DEBOUNCE_MS } from './PeopleSearch'

const range = '?from=2025-12-29&to=2026-01-11'

/** The `q` ('' when absent) of every capacity request for the range on screen, in order. Prefetches of the
 * neighbouring weeks are left out. */
function recordSearches() {
  const searches: string[] = []
  const onRequest = ({ request }: { request: Request }) => {
    const url = new URL(request.url)
    if (url.pathname.endsWith('/capacity') && url.searchParams.get('from') === '2025-12-29') {
      searches.push(url.searchParams.get('q') ?? '')
    }
  }
  server.events.on('request:start', onRequest)
  return searches
}

function setup(search = range) {
  window.history.replaceState(null, '', `/${search}`)
  const searches = recordSearches()
  const rendered = renderWithProviders(<App />)
  // Fake timers drive the debounce; userEvent has to move them too, or its own pauses would never end.
  const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) })
  return { ...rendered, user, searches }
}

async function names() {
  const rows = await screen.findAllByRole('rowheader')
  return rows.map((row) => row.textContent)
}

describe('people search', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })
  afterEach(() => {
    server.events.removeAllListeners()
    vi.useRealTimers()
  })

  it('sends one request once typing pauses for 300 ms, and keeps the search in the URL', async () => {
    const { user, searches } = setup()
    expect(await names()).toHaveLength(mockPeople.length)

    const box = screen.getByRole('searchbox', { name: 'Search people' })
    await user.type(box, 'soren hag')
    // The box follows every keystroke; the grid has not been asked yet.
    expect(box).toHaveValue('soren hag')
    act(() => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 50)
    })
    expect(searches).toEqual([''])

    act(() => {
      vi.advanceTimersByTime(50)
    })
    await waitFor(async () => {
      expect(await names()).toEqual([expect.stringContaining('Søren Hagen')])
    })
    expect(searches).toEqual(['', 'soren hag'])
    expect(new URLSearchParams(window.location.search).get('q')).toBe('soren hag')
  })

  it('opens a link with a search already applied', async () => {
    const { searches } = setup(`${range}&q=%20%C3%B8berg%20`)
    expect(await names()).toEqual([expect.stringContaining('Jonas Öberg')])
    expect(screen.getByRole('searchbox', { name: 'Search people' })).toHaveValue('øberg')
    expect(searches).toEqual(['øberg'])
  })

  it('says when no one matches, and clearing shows everyone again', async () => {
    const { user } = setup(`${range}&q=zzz`)
    expect(await screen.findByText('No one matches “zzz”')).toBeInTheDocument()
    expect(screen.queryByText('No people to plan yet')).not.toBeInTheDocument()

    const emptyState = screen.getByText('No one matches “zzz”').parentElement!
    await user.click(within(emptyState).getByRole('button', { name: 'Clear search' }))

    expect(await names()).toHaveLength(mockPeople.length)
    expect(screen.getByRole('searchbox', { name: 'Search people' })).toHaveValue('')
    expect(window.location.search).toBe(range)
  })

  it('patches a searched grid after saving weekly hours, without waiting for the refetch', async () => {
    let saved = false
    server.use(
      http.get('*/capacity', async ({ request }) => {
        // The revalidation after the save never answers: what changes on screen comes from the save itself.
        if (saved) await delay('infinite')
        const params = new URL(request.url).searchParams
        return HttpResponse.json(
          buildCapacityGrid(params.get('from')!, params.get('to')!, params.get('q') ?? ''),
        )
      }),
      http.patch('*/people/:id', () => {
        saved = true
        return HttpResponse.json({ id: 1, name: 'Ana Ferreira', weeklyHours: 36 })
      }),
    )
    const { user } = setup(`${range}&q=ana`)
    expect(await names()).toEqual([
      expect.stringContaining('Ana Ferreira'),
      expect.stringContaining('Ana Lima'),
    ])

    await user.click(screen.getByRole('button', { name: /Weekly hours for Ana Ferreira/ }))
    const input = screen.getByRole('textbox', { name: 'Weekly hours for Ana Ferreira' })
    await user.clear(input)
    await user.type(input, '36{Enter}')

    expect(
      await screen.findByRole('button', { name: /Weekly hours for Ana Ferreira: 36/ }),
    ).toBeInTheDocument()
    const row = screen.getByRole('rowheader', { name: /Ana Ferreira/ }).closest('tr')!
    for (const cell of within(row).getAllByRole('cell')) expect(cell).toHaveTextContent(/\/ 36/)
    expect(await names()).toHaveLength(2)
  })
})
