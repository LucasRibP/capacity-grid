import { setupServer } from 'msw/node'

import { handlers } from '../api/mocks/handlers'

// Defaults are generated from the contract. Override per test with `server.use(...)`.
export const server = setupServer(...handlers)
