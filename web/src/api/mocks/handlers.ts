import { getCapacityMock } from '../generated/endpoints/capacity/capacity.msw'
import { getPeopleMock } from '../generated/endpoints/people/people.msw'
import { getSystemMock } from '../generated/endpoints/system/system.msw'
import { capacityHandler } from './capacity'

// Schema-valid but random data generated from the contract. Put hand-written handlers that need
// realistic data (every person carrying every week, latency, failures) BEFORE these: MSW uses the
// first handler that matches.
export const handlers = [capacityHandler, ...getCapacityMock(), ...getPeopleMock(), ...getSystemMock()]
