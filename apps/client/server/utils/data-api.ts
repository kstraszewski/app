import type { DataApiClient } from '@openexpert/data-api'
import type { H3Event } from 'h3'
import { serverBackendDataClient } from './platform-data'

interface ClientDataApiEventContext {
  _openexpertClientBackendData?: DataApiClient<any>
}

export function serverDataBackend(event: H3Event): DataApiClient<any> {
  const context = event.context as ClientDataApiEventContext
  if (context._openexpertClientBackendData) {
    return context._openexpertClientBackendData
  }
  const client = serverBackendDataClient(event)
  context._openexpertClientBackendData = client
  return client
}
