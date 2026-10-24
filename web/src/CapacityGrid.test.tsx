import { screen, waitFor, within } from '@testing-library/react'
import { delay, http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'

import type { CapacityGrid as Grid } from '@/api/generated/model'
import { renderWithProviders } from '@/test/render'
import { server } from '@/test/server'

import { CapacityGrid } from './CapacityGrid'

const weeks = ['2025-12-29', '2026-01-05', '2026-01-12']

function grid(names: string[], overrides: Partial<Grid> = {}): Grid {
  return {
    from: '2025-12-29',
    to: '2026-01-18',
    weeks,
    people: names.map((name, i) => ({
      id: i + 1,
      name,
      weeklyHours: 40,
      weeks: weeks.map((weekStart) => ({ weekStart, allocatedHours: 20, capacityHours: 40 })),
    })),
    ...overrides,
  }
}

function serve(body: Grid | ((from: string) => Grid), wait = 0) {
  server.use(
    http.get('*/capacity', async ({ request }) => {
      await delay(wait)
      const from = new URL(request.url).searchParams.get('from') ?? ''
      return HttpResponse.json(typeof body === 'function' ? body(from) : body)
    }),
  )
}

function rowOf(name: string) {
  const row = screen.getByRole('rowheader', { name: new RegExp(name) }).closest('tr')
  if (!row) throw new Error(`no row for ${name}`)
  return within(row)
}

describe('CapacityGrid', () => {
  it('shows a skeleton, then people down the side and weeks across the top', async () => {
    serve(grid(['Ana Ferreira', 'Bjørn Þórsson']))
    renderWithProviders(<CapacityGrid from="2025-12-29" to="2026-01-16" />)

    expect(screen.getByRole('status', { name: 'Loading capacity' })).toBeInTheDocument()
    expect(await screen.findByRole('rowheader', { name: /Bjørn Þórsson/ })).toBeInTheDocument()
    const headers = screen.getAllByRole('columnheader').map((th) => th.textContent)
    expect(headers).toEqual(['Person', 'Week of 29 Dec 2025', 'Week of 5 Jan 2026', 'Week of 12 Jan'])
    expect(rowOf('Ana Ferreira').getAllByRole('cell')[0]).toHaveTextContent('20 / 40')
  })

  it('marks over-allocation with words, including any hours on zero capacity', async () => {
    const data = grid(['Ana Ferreira', 'Eli Nakamura'])
    data.people[0]!.weeks[1] = { weekStart: '2026-01-05', allocatedHours: 48, capacityHours: 40 }
    data.people[1]!.weeklyHours = 0
    data.people[1]!.weeks = weeks.map((weekStart, i) => ({
      weekStart,
      allocatedHours: i === 0 ? 12 : 0,
      capacityHours: 0,
    }))
    serve(data)
    renderWithProviders(<CapacityGrid from="2025-12-29" to="2026-01-16" />)

    const ana = (await screen.findByRole('rowheader', { name: /Ana Ferreira/ })).closest('tr')!
    const [, week2] = within(ana).getAllByRole('cell')
    expect(week2).toHaveTextContent('48 / 40, over by 8 h')

    const eli = rowOf('Eli Nakamura').getAllByRole('cell')
    expect(eli[0]).toHaveTextContent('12 / 0, over by 12 h')
    expect(eli[1]).toHaveTextContent('0 / 0')
    expect(eli[1]).not.toHaveTextContent('over')
  })

  it("shows the server's message and recovers on retry", async () => {
    server.use(
      http.get(
        '*/capacity',
        () =>
          HttpResponse.json(
            { code: 'internal', message: 'Something went wrong on our side.' },
            { status: 500 },
          ),
        { once: true },
      ),
    )
    const { user } = renderWithProviders(<CapacityGrid from="2025-12-29" to="2026-01-16" />)

    expect(await screen.findByText('Something went wrong on our side.')).toBeInTheDocument()
    serve(grid(['Ana Ferreira']))
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('rowheader', { name: /Ana Ferreira/ })).toBeInTheDocument()
    expect(screen.queryByText('Something went wrong on our side.')).not.toBeInTheDocument()
  })

  it('says so when there is nobody to show', async () => {
    serve(grid([]))
    renderWithProviders(<CapacityGrid from="2025-12-29" to="2026-01-16" />)
    expect(await screen.findByText('No people to plan yet')).toBeInTheDocument()
  })

  it('keeps the previous range visible while the next one loads', async () => {
    serve((from) => grid([from === '2025-12-29' ? 'Ana Ferreira' : 'Mei Chen']), 50)
    const { rerender } = renderWithProviders(<CapacityGrid from="2025-12-29" to="2026-01-16" />)
    await screen.findByRole('rowheader', { name: /Ana Ferreira/ })

    rerender(<CapacityGrid from="2026-01-05" to="2026-01-23" />)
    expect(screen.getByText('Updating…')).toBeInTheDocument()
    expect(screen.getByRole('rowheader', { name: /Ana Ferreira/ })).toBeInTheDocument()
    expect(await screen.findByRole('rowheader', { name: /Mei Chen/ })).toBeInTheDocument()
    expect(screen.queryByText('Updating…')).not.toBeInTheDocument()
  })

  it('never lets a late response for an old range replace the current one', async () => {
    // The first range answers after the second one.
    serve((from) => grid([from === '2025-12-29' ? 'Late Old Range' : 'Current Range']))
    server.use(
      http.get('*/capacity', async ({ request }) => {
        if (new URL(request.url).searchParams.get('from') !== '2025-12-29') return undefined
        await delay(80)
        return HttpResponse.json(grid(['Late Old Range']))
      }),
    )
    const { rerender } = renderWithProviders(<CapacityGrid from="2025-12-29" to="2026-01-16" />)
    rerender(<CapacityGrid from="2026-01-05" to="2026-01-23" />)

    expect(await screen.findByRole('rowheader', { name: /Current Range/ })).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 120))
    await waitFor(() => {
      expect(screen.getByRole('rowheader', { name: /Current Range/ })).toBeInTheDocument()
    })
    expect(screen.queryByText('Late Old Range')).not.toBeInTheDocument()
  })
})
