import { screen, waitFor, within } from '@testing-library/react'
import { delay, http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'

import { getGetCapacityQueryKey } from '@/api/generated/endpoints/capacity/capacity'
import type { CapacityGrid as Grid, UpdatePerson } from '@/api/generated/model'
import { CapacityGrid } from '@/CapacityGrid'
import { renderWithProviders } from '@/test/render'
import { server } from '@/test/server'

const weeks = ['2025-12-29', '2026-01-05']

// Ana is planned for 44 h in the first week: within 48 h/wk, over once capacity drops to 40.
function grid(): Grid {
  return {
    from: '2025-12-29',
    to: '2026-01-11',
    weeks,
    people: [
      {
        id: 1,
        name: 'Ana Ferreira',
        weeklyHours: 48,
        weeks: [
          { weekStart: weeks[0]!, allocatedHours: 44, capacityHours: 48 },
          { weekStart: weeks[1]!, allocatedHours: 20, capacityHours: 48 },
        ],
      },
      {
        id: 2,
        name: 'Bjørn Þórsson',
        weeklyHours: 32,
        weeks: weeks.map((weekStart) => ({ weekStart, allocatedHours: 16, capacityHours: 32 })),
      },
    ],
  }
}

/** Answers the first GET; every later one (the background revalidation) never answers. */
function serveGridOnce() {
  const calls = { get: 0, patch: [] as UpdatePerson[] }
  server.use(
    http.get('*/capacity', async () => {
      calls.get += 1
      if (calls.get > 1) await delay('infinite')
      return HttpResponse.json(grid())
    }),
  )
  return calls
}

function anaCells() {
  const row = screen.getByRole('rowheader', { name: /Ana Ferreira/ }).closest('tr')!
  return within(row).getAllByRole('cell')
}

async function openEditor(user: ReturnType<typeof renderWithProviders>['user']) {
  await user.click(await screen.findByRole('button', { name: /Weekly hours for Ana Ferreira/ }))
  const input = screen.getByRole('textbox', { name: 'Weekly hours for Ana Ferreira' })
  await user.clear(input)
  return input
}

describe('WeeklyHoursEditor', () => {
  it('updates capacity and the over-allocation highlight from the save, without refetching the grid', async () => {
    const calls = serveGridOnce()
    server.use(
      http.patch('*/people/:id', async ({ request }) => {
        calls.patch.push((await request.json()) as UpdatePerson)
        await delay(50)
        return HttpResponse.json({ id: 1, name: 'Ana Ferreira', weeklyHours: 40 })
      }),
    )
    const { user, queryClient } = renderWithProviders(<CapacityGrid from="2025-12-29" to="2026-01-09" />)
    const otherRange = getGetCapacityQueryKey({ from: '2026-03-02', to: '2026-03-13' })
    queryClient.setQueryData(otherRange, grid())
    const search = getGetCapacityQueryKey({ from: '2025-12-29', to: '2026-01-09', q: 'ana' })
    queryClient.setQueryData(search, { ...grid(), people: grid().people.slice(0, 1) })

    const input = await openEditor(user)
    await user.type(input, '40{Enter}')

    // Pessimistic: the grid keeps the old numbers while the server has not answered.
    expect(screen.getByRole('button', { name: /Saving/ })).toBeDisabled()
    expect(anaCells()[0]).toHaveTextContent('44 / 48')
    expect(anaCells()[0]).not.toHaveTextContent('over')

    await waitFor(() => {
      expect(anaCells()[0]).toHaveTextContent('44 / 40, over by 4 h')
    })
    expect(anaCells()[1]).toHaveTextContent('20 / 40')
    expect(screen.getByRole('button', { name: /Weekly hours for Ana Ferreira: 40/ })).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(calls.patch).toEqual([{ weeklyHours: 40 }])
    // The revalidation was asked for but has not answered: the new numbers came from the save itself.
    expect(calls.get).toBe(2)
    // Every cached range and name search is patched, not only the one on screen; other people are left alone.
    const other = queryClient.getQueryData<Grid>(otherRange)!
    expect(other.people[0]!.weeks.map((w) => w.capacityHours)).toEqual([40, 40])
    expect(other.people[1]!.weeklyHours).toBe(32)
    const searched = queryClient.getQueryData<Grid>(search)!
    expect(searched.people[0]!.weeks.map((w) => w.capacityHours)).toEqual([40, 40])
  })

  it('keeps the typed value and the grid on a failed save, and saves on retry', async () => {
    serveGridOnce()
    let attempts = 0
    server.use(
      http.patch('*/people/:id', () => {
        attempts += 1
        if (attempts === 1) {
          return HttpResponse.json(
            { code: 'internal', message: 'The server is unavailable.' },
            { status: 500 },
          )
        }
        return HttpResponse.json({ id: 1, name: 'Ana Ferreira', weeklyHours: 40 })
      }),
    )
    const { user } = renderWithProviders(<CapacityGrid from="2025-12-29" to="2026-01-09" />)

    const input = await openEditor(user)
    await user.type(input, '40{Enter}')

    expect(await screen.findByRole('alert')).toHaveTextContent('The server is unavailable.')
    expect(input).toHaveValue('40')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(anaCells()[0]).toHaveTextContent('44 / 48')

    await user.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => {
      expect(anaCells()[0]).toHaveTextContent('44 / 40, over by 4 h')
    })
    expect(attempts).toBe(2)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('checks the contract bounds before sending, and Escape cancels', async () => {
    serveGridOnce()
    let patches = 0
    server.use(
      http.patch('*/people/:id', () => {
        patches += 1
        return HttpResponse.json({ id: 1, name: 'Ana Ferreira', weeklyHours: 200 })
      }),
    )
    const { user } = renderWithProviders(<CapacityGrid from="2025-12-29" to="2026-01-09" />)

    const input = await openEditor(user)
    await user.type(input, '200{Enter}')
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a number of hours from 0 to 168.')
    expect(input).toHaveValue('200')

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(anaCells()[0]).toHaveTextContent('44 / 48')
    expect(patches).toBe(0)
  })
})
