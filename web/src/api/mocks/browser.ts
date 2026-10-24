import { setupWorker } from 'msw/browser'

import { handlers } from './handlers'

// Dev-only: lets the UI run without the Go API. Enabled by VITE_API_MOCK=true in web/.env.local.
export const worker = setupWorker(...handlers)
