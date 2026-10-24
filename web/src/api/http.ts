import type { Error as ApiErrorBody } from './generated/model'

/** Thrown for every non-2xx response, so TanStack Query puts it in `error`. */
export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, body: Partial<ApiErrorBody> | undefined) {
    super(body?.message ?? `Request failed with status ${String(status)}`)
    this.name = 'ApiError'
    this.status = status
    this.code = body?.code ?? 'unknown'
  }
}

/**
 * Single fetch wrapper used by every generated client (see orval.config.ts).
 * Paths in the contract are relative to the `/api` server URL; Vite proxies `/api` to the Go server.
 */
export const http = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(`/api${url}`, init)
  const text = await res.text()
  let body: unknown
  try {
    body = text ? JSON.parse(text) : undefined
  } catch {
    body = undefined // e.g. an HTML error page from a proxy
  }
  if (!res.ok) {
    throw new ApiError(res.status, body as Partial<ApiErrorBody> | undefined)
  }
  return body as T
}

/** Orval picks this up as the error type of every generated hook. */
export type ErrorType<E> = ApiError & { body?: E }
