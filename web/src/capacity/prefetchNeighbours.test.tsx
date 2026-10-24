import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { delay, http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getGetCapacityQueryKey } from '@/api/generated/endpoints/capacity/capacity'
import type { CapacityGrid } from '@/api/generated/model'
import { buildCapacityGrid } from '@/api/mocks/capacity'
import { App } from '@/App'
import { renderWithProviders } from '@/test/render'
import { server } from '@/test/server'

import { SEARCH_DEBOUNCE_MS } from './PeopleSearch'

const current = { from: '2025-12-29', to: '2026-01-11' }
const previous = { from: '2025-12-22', to: '2026-01-04' }
const next = { from: '2026-01-05', to: '2026-01-18' }
const afterNext = { from: '2026-01-12', to: '2026-01-25' }

type Request = { from: string; to: string; q: string }

/** Answers every capacity request from the mock data, after `wait` ms, and records it. */
function serveCapacity({ wait = 0, answer = () => true }: { wait?: number; answer?: () => boolean } = {}) {
  const requests: Request[] = []
  server.use(
    http.get('*/capacity', async ({ request }) => {
      const params = new URL(request.url).searchParams
      const asked = { from: params.get('from')!, to: params.get('to')!, q: params.get('q') ?? '' }
      requests.push(asked)
      await delay(answer() ? wait : 'infinite')
      return HttpResponse.json(buildCapacityGrid(asked.from, asked.to, asked.q))
    }),
  )
  return requests
}

function countOf(requests: Request[], range: { from: string; to: string }, q = '') {
  return requests.filter((r) => r.from === range.from && r.to === range.to && r.q === q).length
}

function open(search: string) {
  window.history.replaceState(null, '', `/${search}`)
  return renderWithProviders(<App />)
}

function weekHeaders() {
  return screen
    .getAllByRole('columnheader')
    .slice(1)
    .map((th) => th.textContent.replace(/^Week of\s*/, ''))
}

async function waitForNeighbours(requests: Request[], q = '') {
  await waitFor(() => {
    expect(countOf(requests, previous, q)).toBe(1)
    expect(countOf(requests, next, q)).toBe(1)
  })
}

describe('prefetching the neighbouring weeks', () => {
  it('asks for one week back and one forward once, after the grid loads', async () => {
    const requests = serveCapacity({ wait: 20 })
    open(`?from=${current.from}&to=${current.to}`)

    expect(await screen.findAllByRole('rowheader')).not.toHaveLength(0)
    await waitForNeighbours(requests)
    // Nothing else, and no repeat once the neighbours have answered and the grid re-renders.
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(requests).toHaveLength(3)
    expect(requests[0]).toEqual({ ...current, q: '' })
  })

  it('shows the next week at once, without a loading or updating state', async () => {
    const requests = serveCapacity({ wait: 50 })
    const { user, queryClient } = open(`?from=${current.from}&to=${current.to}`)
    await screen.findAllByRole('rowheader')
    await waitForNeighbours(requests)
    await waitFor(() => {
      expect(queryClient.getQueryData(getGetCapacityQueryKey(next))).toBeDefined()
    })

    await user.click(screen.getByRole('button', { name: 'Next week' }))

    expect(weekHeaders()).toEqual(['5 Jan 2026', '12 Jan'])
    expect(screen.queryByText('Updating…')).not.toBeInTheDocument()
    expect(screen.queryByRole('status', { name: 'Loading capacity' })).not.toBeInTheDocument()
    // The new range's own neighbours: the one after it is fetched, the range just left is already cached.
    await waitFor(() => {
      expect(countOf(requests, afterNext)).toBe(1)
    })
    expect(countOf(requests, current)).toBe(1)
  })

  it('keeps the search in the neighbours, so stepping a week keeps the results', async () => {
    const requests = serveCapacity()
    open(`?from=${current.from}&to=${current.to}&q=ana`)
    await screen.findAllByRole('rowheader')
    await waitForNeighbours(requests, 'ana')
    expect(requests.every((r) => r.q === 'ana')).toBe(true)
  })

  it('prefetches 13-week neighbours of a 13-week range, and never anything longer', async () => {
    const requests = serveCapacity()
    open('?from=2026-01-05&to=2026-04-05')
    await screen.findAllByRole('rowheader')
    await waitFor(() => {
      expect(countOf(requests, { from: '2025-12-29', to: '2026-03-29' })).toBe(1)
      expect(countOf(requests, { from: '2026-01-12', to: '2026-04-12' })).toBe(1)
    })
    expect(requests).toHaveLength(3)
  })

  describe('while a search is being typed', () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('waits for the search instead of prefetching for the old one', async () => {
      let releaseNext: () => void = () => undefined
      const nextAnswered = new Promise<void>((resolve) => {
        releaseNext = resolve
      })
      const requests: Request[] = []
      server.use(
        http.get('*/capacity', async ({ request }) => {
          const params = new URL(request.url).searchParams
          const asked = { from: params.get('from')!, to: params.get('to')!, q: params.get('q') ?? '' }
          requests.push(asked)
          // The far range loads slowly, so it settles while the search below is still being debounced.
          if (asked.from === '2026-03-02') await nextAnswered
          return HttpResponse.json(buildCapacityGrid(asked.from, asked.to, asked.q))
        }),
      )
      window.history.replaceState(null, '', '/?from=2026-02-23&to=2026-03-08')
      renderWithProviders(<App />)
      const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) })
      await screen.findAllByRole('rowheader')
      await waitFor(() => {
        expect(requests).toHaveLength(3)
      })

      // Its prefetch has not answered yet, so the next week is still loading when the typing starts.
      await user.click(screen.getByRole('button', { name: 'Next week' }))
      expect(screen.getByText('Updating…')).toBeInTheDocument()
      await user.type(screen.getByRole('searchbox', { name: 'Search people' }), 'ana')
      await act(async () => {
        releaseNext()
        await nextAnswered
      })
      await waitFor(() => {
        expect(screen.queryByText('Updating…')).not.toBeInTheDocument()
      })
      const beforeDebounce = requests.length
      await act(() => new Promise((resolve) => setTimeout(resolve, 50)))
      expect(requests).toHaveLength(beforeDebounce)

      act(() => {
        vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS)
      })
      await waitFor(() => {
        expect(countOf(requests, { from: '2026-02-23', to: '2026-03-08' }, 'ana')).toBe(1)
        expect(countOf(requests, { from: '2026-03-09', to: '2026-03-22' }, 'ana')).toBe(1)
      })
      // Between the old range settling and the debounce ending, nothing was prefetched for the old search.
      expect(requests.slice(beforeDebounce).every((r) => r.q === 'ana')).toBe(true)
      expect(countOf(requests, { from: '2026-03-09', to: '2026-03-22' })).toBe(0)
    })
  })

  describe('and saving weekly hours', () => {
    const anaKey = (range: { from: string; to: string }) => getGetCapacityQueryKey(range)

    async function saveAnaAt(user: ReturnType<typeof userEvent.setup>, hours: string) {
      await user.click(screen.getByRole('button', { name: /Weekly hours for Ana Ferreira/ }))
      const input = screen.getByRole('textbox', { name: 'Weekly hours for Ana Ferreira' })
      await user.clear(input)
      await user.type(input, `${hours}{Enter}`)
    }

    function capacityOfAna(grid: CapacityGrid | undefined) {
      const ana = grid?.people.find((p) => p.id === 1)
      return ana && { weeklyHours: ana.weeklyHours, weeks: ana.weeks.map((w) => w.capacityHours) }
    }

    it('patches the prefetched ranges too, so the next week shows the saved hours at once', async () => {
      let saved = false
      // After the save, the revalidation never answers: what the cache holds comes from the save itself.
      const requests = serveCapacity({ answer: () => !saved })
      server.use(
        http.patch('*/people/:id', () => {
          saved = true
          return HttpResponse.json({ id: 1, name: 'Ana Ferreira', weeklyHours: 36 })
        }),
      )
      const { user, queryClient } = open(`?from=${current.from}&to=${current.to}`)
      await screen.findAllByRole('rowheader')
      await waitForNeighbours(requests)
      await waitFor(() => {
        expect(queryClient.getQueryData(anaKey(next))).toBeDefined()
      })

      await saveAnaAt(user, '36')
      expect(
        await screen.findByRole('button', { name: /Weekly hours for Ana Ferreira: 36/ }),
      ).toBeInTheDocument()

      for (const range of [previous, next]) {
        expect(capacityOfAna(queryClient.getQueryData<CapacityGrid>(anaKey(range)))).toEqual({
          weeklyHours: 36,
          weeks: [36, 36],
        })
      }
      await user.click(screen.getByRole('button', { name: 'Next week' }))
      expect(weekHeaders()).toEqual(['5 Jan 2026', '12 Jan'])
      const row = screen.getByRole('rowheader', { name: /Ana Ferreira/ }).closest('tr')!
      for (const cell of within(row).getAllByRole('cell')) expect(cell).toHaveTextContent(/ \/ 36/)
    })

    it('does not prefetch while the save is pending, and revalidates the neighbours after it', async () => {
      let releaseSave: () => void = () => undefined
      const saveAnswered = new Promise<void>((resolve) => {
        releaseSave = resolve
      })
      const requests = serveCapacity()
      server.use(
        http.patch('*/people/:id', async () => {
          await saveAnswered
          return HttpResponse.json({ id: 1, name: 'Ana Ferreira', weeklyHours: 36 })
        }),
      )
      const { user, queryClient } = open(`?from=${current.from}&to=${current.to}`)
      await screen.findAllByRole('rowheader')
      await waitForNeighbours(requests)

      await saveAnaAt(user, '36')
      expect(screen.getByRole('button', { name: /Saving/ })).toBeDisabled()
      // The grid refetches and settles while the save is in flight (e.g. a focus refetch). The neighbours are now
      // stale, yet they wait for the save.
      await act(() => queryClient.invalidateQueries({ queryKey: getGetCapacityQueryKey() }))
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(countOf(requests, current)).toBe(2)
      expect(countOf(requests, previous)).toBe(1)
      expect(countOf(requests, next)).toBe(1)

      await act(async () => {
        releaseSave()
        await saveAnswered
      })
      await waitFor(() => {
        expect(countOf(requests, previous)).toBe(2)
        expect(countOf(requests, next)).toBe(2)
      })
    })
  })
})
