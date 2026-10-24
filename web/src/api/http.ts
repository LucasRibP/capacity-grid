import type { Error as ApiErrorBody, ErrorCode } from './generated/model'

/** No response at all (offline, server down): fetch rejected. */
export const NETWORK_ERROR_STATUS = 0

/**
 * The message a manager sees when the server sent no contract error. Gateway statuses mean the proxy
 * could not reach the API, which reads the same as being offline.
 */
const fallbackMessage = (status: number): string =>
  status === NETWORK_ERROR_STATUS || status === 502 || status === 503 || status === 504
    ? "Couldn't reach the server. Check your connection and try again."
    : 'Something went wrong on our side. Try again.'

/** Thrown for every non-2xx response or failed request, so TanStack Query puts it in `error`. */
export class ApiError extends Error {
  /** HTTP status, or NETWORK_ERROR_STATUS when there was no response. */
  readonly status: number
  /** The contract's code, or `unknown` when the body is not a contract error (e.g. a proxy page). */
  readonly code: ErrorCode | 'unknown'

  constructor(status: number, body: Partial<ApiErrorBody> | undefined) {
    super(body?.message ?? fallbackMessage(status))
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
  let res: Response
  try {
    res = await fetch(`/api${url}`, init)
  } catch (error) {
    // An abort is TanStack Query cancelling a stale request; it must stay an AbortError.
    if (init?.signal?.aborted) throw error
    throw new ApiError(NETWORK_ERROR_STATUS, undefined)
  }
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
