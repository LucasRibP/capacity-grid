/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "true" serves the API from MSW mocks in the browser (dev only). */
  readonly VITE_API_MOCK?: string
}
