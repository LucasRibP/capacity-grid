import { http as mswHttp, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'

import { server } from '../test/server'
import { ApiError, NETWORK_ERROR_STATUS, http } from './http'

describe('http', () => {
  it('turns a contract error body into an ApiError the UI can show', async () => {
    server.use(
      mswHttp.patch('*/api/people/:id', () =>
        HttpResponse.json({ code: 'not_found', message: 'no person with id 9' }, { status: 404 }),
      ),
    )

    const error = await http('/people/9', { method: 'PATCH' }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 404, code: 'not_found', message: 'no person with id 9' })
  })

  it('still fails cleanly when the body is not JSON (e.g. a proxy error page)', async () => {
    server.use(
      mswHttp.get('*/api/capacity', () => new HttpResponse('<html>Bad Gateway</html>', { status: 502 })),
    )

    const error = await http('/capacity').catch((e: unknown) => e)

    expect(error).toMatchObject({
      status: 502,
      code: 'unknown',
      message: "Couldn't reach the server. Check your connection and try again.",
    })
  })

  it('says the same when there is no response at all', async () => {
    server.use(mswHttp.patch('*/api/people/:id', () => HttpResponse.error()))

    const error = await http('/people/9', { method: 'PATCH' }).catch((e: unknown) => e)

    expect(error).toMatchObject({ status: NETWORK_ERROR_STATUS, code: 'unknown' })
    expect(error).toHaveProperty('message', "Couldn't reach the server. Check your connection and try again.")
  })

  it('does not hide a non-contract server error behind a status code', async () => {
    server.use(mswHttp.get('*/api/capacity', () => new HttpResponse('oops', { status: 500 })))

    const error = await http('/capacity').catch((e: unknown) => e)

    expect(error).toHaveProperty('message', 'Something went wrong on our side. Try again.')
  })

  it('lets an abort through untouched so TanStack Query can cancel', async () => {
    const controller = new AbortController()
    controller.abort()

    const error = await http('/capacity', { signal: controller.signal }).catch((e: unknown) => e)

    expect(error).not.toBeInstanceOf(ApiError)
    expect(error).toHaveProperty('name', 'AbortError')
  })
})
