import { getQuery } from 'h3'
import { loadConsentDefinitions } from '~~/server/utils/consents'
import {
  hasAdministrativePermission,
  requireCrmSession,
} from '~~/server/utils/crm'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const activeOnly = getQuery(event).active === '1'
  const [definitions, hasManagePermission, hasPublishPermission, hasAuditPermission] = await Promise.all([
    loadConsentDefinitions(session, { activeOnly }),
    hasAdministrativePermission(session, 'compliance.consents.definitions.manage'),
    hasAdministrativePermission(session, 'compliance.consents.definitions.publish'),
    hasAdministrativePermission(session, 'compliance.consents.audit.read'),
  ])

  return {
    role: session.role,
    canManage: hasManagePermission,
    canPublish: hasPublishPermission,
    canAudit: hasAuditPermission,
    definitions,
  }
})
