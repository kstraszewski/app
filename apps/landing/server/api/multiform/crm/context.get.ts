import { getQuery } from 'h3'
import {
  loadCrmMultiformContext,
  parseCrmMultiformSelection,
} from '../../../utils/multiform-crm'

export default defineEventHandler(async (event) => {
  const selection = parseCrmMultiformSelection(getQuery(event))
  const context = await loadCrmMultiformContext(event, selection)

  return {
    organization: {
      slug: context.session.organizationSlug,
      name: context.session.organizationName,
    },
    case: context.case,
    applicants: context.applicants,
    applicationIds: context.applicationIds,
    offerIds: context.offerIds,
    contractApplicationId: context.contractApplicationId,
    applications: context.applications,
    offer: context.offer,
    bank: {
      id: context.offer.bankId,
      name: context.offer.bankName,
    },
    product: {
      id: context.offer.productId,
      versionId: context.offer.productVersionId,
      versionKey: context.offer.versionKey,
      name: context.offer.productName,
    },
    templateIds: context.templateIds,
    documentRequirements: context.documentRequirements,
    checklist: context.checklist,
    documents: context.publicDocuments,
    selectedOfferValidation: context.validation,
    selectedApplicationsValidation: context.validation,
  }
})
