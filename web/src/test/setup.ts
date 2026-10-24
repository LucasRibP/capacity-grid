import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterAll, afterEach, beforeAll } from 'vitest'

import { server } from './server'

// jsdom has no layout: every element measures 0×0, so the virtualized grid would render no rows. Give elements a
// viewport-sized client box; tests use a handful of people, so they all fit.
Object.defineProperties(HTMLElement.prototype, {
  clientWidth: { configurable: true, get: () => 1280 },
  clientHeight: { configurable: true, get: () => 800 },
})

// Any request without a handler fails the test: no silent network calls.
beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' })
})
afterEach(() => {
  cleanup()
  server.resetHandlers()
})
afterAll(() => {
  server.close()
})
