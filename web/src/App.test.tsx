import { screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { renderWithProviders } from '@/test/render'

import { App } from './App'

function openAt(search: string) {
  window.history.replaceState(null, '', `/${search}`)
}

async function weekHeaders() {
  await screen.findAllByRole('rowheader')
  return screen
    .getAllByRole('columnheader')
    .slice(1)
    .map((th) => th.textContent.replace(/^Week of\s*/, ''))
}

function query() {
  return Object.fromEntries(new URLSearchParams(window.location.search))
}

describe('week navigation', () => {
  beforeEach(() => {
    openAt('')
  })

  it('steps across the 2025/2026 boundary and keeps the range in the URL', async () => {
    openAt('?from=2025-12-15&to=2025-12-28')
    const { user } = renderWithProviders(<App />)
    expect(await weekHeaders()).toEqual(['15 Dec 2025', '22 Dec'])

    await user.click(screen.getByRole('button', { name: 'Next week' }))
    expect(query()).toEqual({ from: '2025-12-22', to: '2026-01-04' })
    expect(await screen.findByRole('columnheader', { name: 'Week of 29 Dec' })).toBeInTheDocument()
    expect(await weekHeaders()).toEqual(['22 Dec 2025', '29 Dec'])

    await user.click(screen.getByRole('button', { name: 'Next week' }))
    expect(await screen.findByRole('columnheader', { name: 'Week of 5 Jan 2026' })).toBeInTheDocument()
    expect(await weekHeaders()).toEqual(['29 Dec 2025', '5 Jan 2026'])

    await user.click(screen.getByRole('button', { name: 'Previous week' }))
    expect(query()).toEqual({ from: '2025-12-22', to: '2026-01-04' })
  })

  it('follows the back button', async () => {
    openAt('?from=2025-12-29&to=2026-01-04')
    const { user } = renderWithProviders(<App />)
    await user.click(await screen.findByRole('button', { name: 'Next week' }))
    expect(await screen.findByRole('columnheader', { name: 'Week of 5 Jan 2026' })).toBeInTheDocument()

    window.history.back()
    expect(await screen.findByRole('columnheader', { name: 'Week of 29 Dec 2025' })).toBeInTheDocument()
  })

  it('clamps a link longer than 13 weeks before asking the API, and says so', async () => {
    openAt('?from=2025-12-29&to=2026-12-31')
    renderWithProviders(<App />)
    expect(await weekHeaders()).toHaveLength(13)
    expect(screen.getByRole('status')).toHaveTextContent('limited to 13 weeks')
  })

  it('applies a range picked in the calendar', async () => {
    openAt('?from=2025-12-29&to=2026-01-16')
    const { user } = renderWithProviders(<App />)
    await user.click(await screen.findByRole('button', { name: /Date range/ }))
    const dialog = await screen.findByRole('dialog')

    // The first click starts a new range, the second one ends it.
    await user.click(within(dialog).getByRole('button', { name: /January 5th, 2026/ }))
    await user.click(within(dialog).getByRole('button', { name: /January 21st, 2026/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Show range' }))

    expect(query()).toEqual({ from: '2026-01-05', to: '2026-01-21' })
    expect(await screen.findByRole('columnheader', { name: 'Week of 5 Jan 2026' })).toBeInTheDocument()
    expect(await weekHeaders()).toEqual(['5 Jan 2026', '12 Jan', '19 Jan'])
  })
})
