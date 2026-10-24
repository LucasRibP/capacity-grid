import { http as mswHttp, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'

import { server } from '../test/server'
import { ApiError, http } from './http'

describe('http', () => {
  it('turns a contract error body into an ApiError the UI can show', async () => {
    server.use(
      mswHttp.patch('*/api/people/:id', () =>
        HttpResponse.json({ code: 'not_found', message: 'Person 9 does not exist.' }, { status: 404 }),
      ),
    )

    const error = await http('/people/9', { method: 'PATCH' }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 404, code: 'not_found', message: 'Person 9 does not exist.' })
  })

  it('still fails cleanly when the body is not JSON (e.g. a proxy error page)', async () => {
    server.use(
      mswHttp.get('*/api/capacity', () => new HttpResponse('<html>Bad Gateway</html>', { status: 502 })),
    )

    const error = await http('/capacity').catch((e: unknown) => e)

    expect(error).toMatchObject({ status: 502, code: 'unknown' })
  })
})
