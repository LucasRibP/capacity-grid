import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App'
import './styles.css'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
})

async function enableMocking() {
  if (!import.meta.env.DEV || import.meta.env.VITE_API_MOCK !== 'true') return
  try {
    const { worker } = await import('./api/mocks/browser')
    await worker.start({ onUnhandledFrame: 'bypass' })
  } catch (error) {
    // Some embedded browsers block service workers; fall back to the real API instead of a blank page.
    console.error('MSW could not start, using the real API', error)
  }
}

void enableMocking().then(() => {
  const root = document.getElementById('root')
  if (!root) throw new Error('#root not found')
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </StrictMode>,
  )
})
