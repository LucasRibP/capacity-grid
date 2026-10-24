import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { delay, http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'

import { CapacityGrid } from '@/CapacityGrid'
import { largeGrid } from '@/test/largeGrid'
import { renderWithProviders } from '@/test/render'
import { server } from '@/test/server'

import { GridTable } from './GridTable'

/** Scrolls the grid's scroll container, which jsdom cannot do on its own. */
function scrollGridTo(top: number) {
  const scroller = screen.getByRole('table').parentElement!
  Object.defineProperty(scroller, 'scrollTop', { configurable: true, value: top })
  fireEvent.scroll(scroller)
}

function personRows() {
  return screen.getAllByRole('rowheader')
}

describe('GridTable', () => {
  it('renders only the rows in view of a 3,000-person roster, and follows the scroll', () => {
    renderWithProviders(<GridTable grid={largeGrid()} busy={false} />)

    expect(personRows().length).toBeLessThan(50)
    expect(screen.getByRole('table')).toHaveAttribute('aria-rowcount', '3001')

    scrollGridTo(44 * 2000)
    expect(screen.getByRole('rowheader', { name: /Person 2001/ })).toBeInTheDocument()
    expect(screen.queryByRole('rowheader', { name: /Person 0001/ })).not.toBeInTheDocument()
    expect(personRows().length).toBeLessThan(50)
  })
})

describe('GridTable, editing a row that scrolls out of view', () => {
  /** Answers the first GET; the revalidation after a save never answers, so the grid shows the save itself. */
  function serveLargeGrid() {
    let gets = 0
    server.use(
      http.get('*/capacity', async () => {
        gets += 1
        if (gets > 1) await delay('infinite')
        return HttpResponse.json(largeGrid())
      }),
    )
  }

  async function startEditing(user: ReturnType<typeof renderWithProviders>['user'], hours: string) {
    await user.click(await screen.findByRole('button', { name: /Weekly hours for Person 0001/ }))
    const input = screen.getByRole('textbox', { name: 'Weekly hours for Person 0001' })
    await user.clear(input)
    await user.type(input, `${hours}{Enter}`)
  }

  function firstRowCells() {
    const row = screen.getByRole('rowheader', { name: /Person 0001/ }).closest('tr')!
    return within(row).getAllByRole('cell')
  }

  it('keeps a pending save, and applies it, after scrolling away and back', async () => {
    serveLargeGrid()
    let answer: () => void = () => undefined
    server.use(
      http.patch('*/people/:id', async () => {
        await new Promise<void>((resolve) => (answer = resolve))
        return HttpResponse.json({ id: 1, name: 'Person 0001', weeklyHours: 30 })
      }),
    )
    const { user } = renderWithProviders(<CapacityGrid from="2025-12-29" to="2026-03-29" />)
    await startEditing(user, '30')
    expect(screen.getByRole('button', { name: /Saving/ })).toBeDisabled()

    scrollGridTo(44 * 2000)
    expect(screen.getByRole('rowheader', { name: /Person 2001/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Saving/ })).toBeDisabled()
    // The editing row is the only one kept out of view.
    expect(screen.getByRole('rowheader', { name: /Person 0001/ })).toBeInTheDocument()
    expect(screen.queryByRole('rowheader', { name: /Person 0002/ })).not.toBeInTheDocument()

    scrollGridTo(0)
    answer()
    await waitFor(() => {
      expect(firstRowCells()[0]).toHaveTextContent('0 / 30')
    })
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('keeps a failed save, its message and the typed value after scrolling away and back', async () => {
    serveLargeGrid()
    server.use(
      http.patch('*/people/:id', () =>
        HttpResponse.json({ code: 'internal', message: 'The server is unavailable.' }, { status: 500 }),
      ),
    )
    const { user } = renderWithProviders(<CapacityGrid from="2025-12-29" to="2026-03-29" />)
    await startEditing(user, '30')
    expect(await screen.findByRole('alert')).toHaveTextContent('The server is unavailable.')

    scrollGridTo(44 * 2000)
    scrollGridTo(0)

    expect(screen.getByRole('alert')).toHaveTextContent('The server is unavailable.')
    expect(screen.getByRole('textbox', { name: 'Weekly hours for Person 0001' })).toHaveValue('30')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled()
  })
})
