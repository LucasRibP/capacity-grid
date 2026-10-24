import { delay, http, HttpResponse } from 'msw'

import type { Error as ApiErrorBody, UpdatePerson } from '../generated/model'
import { mockPeople } from './capacity'

function errorResponse(status: number, body: ApiErrorBody) {
  return HttpResponse.json(body, { status })
}

/**
 * Mirrors the contract's validation and keeps the change, so the background refetch after a save agrees with it.
 * Weekly hours of 13 fail with a 500, to try the failed-save path in the browser.
 */
export const updatePersonHandler = http.patch('*/people/:id', async ({ params, request }) => {
  await delay()
  const person = mockPeople.find((p) => String(p.id) === params.id)
  if (!person) return errorResponse(404, { code: 'not_found', message: 'This person no longer exists.' })
  const body = (await request.json()) as Partial<UpdatePerson> | null
  const hours = body?.weeklyHours
  if (typeof hours !== 'number' || hours < 0 || hours > 168) {
    return errorResponse(400, {
      code: 'validation_failed',
      message: 'Weekly hours must be between 0 and 168.',
    })
  }
  if (hours === 13) {
    return errorResponse(500, { code: 'internal', message: 'Something went wrong on our side. Try again.' })
  }
  person.weeklyHours = hours
  return HttpResponse.json(person)
})
