import { createError, readBody } from 'h3'
import {
  intermediarySettingsReadiness,
  normalizeIntermediarySettings,
} from '#shared/intermediary-settings'
import {
  asRecord,
  requireCrmSession,
  requireOrganizationAdmin,
  throwDbError,
} from '~~/server/utils/crm'
import {
  applyIntermediaryCooperatingLenderSelection,
  applyIntermediaryLenderSelection,
  resolveIntermediaryLenders,
} from '~~/server/utils/intermediary-lenders'

function expectedRevision(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw createError({ statusCode: 400, statusMessage: 'Nieprawidłowa rewizja ustawień.' })
  }
  return parsed
}

function conflict(): never {
  throw createError({
    statusCode: 409,
    statusMessage: 'Dane pośrednika zmieniły się w innym panelu. Odśwież stronę przed ponownym zapisem.',
  })
}

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  if (session.organizationKind !== 'intermediary') {
    throw createError({ statusCode: 404, statusMessage: 'Intermediary settings are not available' })
  }
  requireOrganizationAdmin(session)

  const body = asRecord(await readBody(event))
  const requestedRevision = expectedRevision(body.expectedRevision)
  const rawSettings = asRecord(body.settings)
  const rawRelationship = asRecord(rawSettings.relationship)
  const hasExplicitLenderSelection = Object.prototype.hasOwnProperty.call(
    rawRelationship,
    'lenderBankIds',
  )
  const hasExplicitCooperatingLenderSelection = Object.prototype.hasOwnProperty.call(
    rawRelationship,
    'cooperatingLenderBankIds',
  )
  const submittedSettings = normalizeIntermediarySettings(rawSettings)

  const [{ data: existing, error: existingError }, lenders] = await Promise.all([
    session.dataApi
      .from('organization_intermediary_settings')
      .select('organization_id, settings, revision')
      .eq('organization_id', session.organizationId)
      .maybeSingle(),
    resolveIntermediaryLenders(session.dataApi),
  ])

  throwDbError(existingError)
  if ((existing?.revision ?? 0) !== requestedRevision) conflict()
  const existingSettings = existing
    ? normalizeIntermediarySettings(existing.settings)
    : null
  const preservesUnchangedLegacySnapshot = Boolean(
    hasExplicitLenderSelection
    && submittedSettings.relationship.lenderBankIds.length === 0
    && existingSettings?.relationship.lenderBankIds.length === 0
    && existingSettings.relationship.lenderNames.length > 0
    && JSON.stringify(submittedSettings.relationship.lenderNames)
      === JSON.stringify(existingSettings.relationship.lenderNames),
  )
  const preservesUnchangedLegacyCooperatingSnapshot = Boolean(
    hasExplicitCooperatingLenderSelection
    && submittedSettings.relationship.cooperatingLenderBankIds.length === 0
    && existingSettings?.relationship.cooperatingLenderBankIds.length === 0
    && existingSettings.relationship.cooperatingLenderNames.length > 0
    && JSON.stringify(submittedSettings.relationship.cooperatingLenderNames)
      === JSON.stringify(existingSettings.relationship.cooperatingLenderNames),
  )

  let settings = submittedSettings
  if (!hasExplicitLenderSelection || preservesUnchangedLegacySnapshot) {
    settings = {
      ...settings,
      relationship: {
        ...settings.relationship,
        lenderBankIds: [...(existingSettings?.relationship.lenderBankIds ?? [])],
        lenderNames: [...(existingSettings?.relationship.lenderNames ?? [])],
      },
    }
  } else {
    const representedSelection = applyIntermediaryLenderSelection(settings, lenders)
    if (representedSelection.invalidIds.length) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Wybrano instytucję, której nie ma w aktualnym katalogu banków.',
      })
    }
    settings = representedSelection.settings
  }

  if (!hasExplicitCooperatingLenderSelection || preservesUnchangedLegacyCooperatingSnapshot) {
    const fallbackBankIds = existingSettings?.relationship.cooperatingLenderBankIds
      ?? (settings.relationship.isTiedMortgageIntermediary
        ? settings.relationship.lenderBankIds
        : [])
    const fallbackNames = existingSettings?.relationship.cooperatingLenderNames
      ?? (settings.relationship.isTiedMortgageIntermediary
        ? settings.relationship.lenderNames
        : [])
    settings = {
      ...settings,
      relationship: {
        ...settings.relationship,
        cooperatingLenderBankIds: [...fallbackBankIds],
        cooperatingLenderNames: [...fallbackNames],
      },
    }
  } else {
    const cooperatingSelection = applyIntermediaryCooperatingLenderSelection(settings, lenders)
    if (cooperatingSelection.invalidIds.length) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Wybrano partnera, którego nie ma w aktualnym katalogu banków.',
      })
    }
    settings = cooperatingSelection.settings
  }

  const { data, error } = existing
    ? await session.dataApi
        .from('organization_intermediary_settings')
        .update({ settings, updated_by: session.userId })
        .eq('organization_id', session.organizationId)
        .eq('revision', requestedRevision)
        .select('settings, revision, updated_at')
        .maybeSingle()
    : await session.dataApi
        .from('organization_intermediary_settings')
        .insert({
          organization_id: session.organizationId,
          settings,
          created_by: session.userId,
          updated_by: session.userId,
        })
        .select('settings, revision, updated_at')
        .maybeSingle()

  if (error?.code === '23505') conflict()
  throwDbError(error)
  if (!data) conflict()

  const normalized = normalizeIntermediarySettings(data.settings)
  return {
    data: normalized,
    lenders,
    readiness: intermediarySettingsReadiness(normalized),
    isConfigured: true,
    revision: data.revision,
    updatedAt: data.updated_at,
    canEdit: true,
  }
})
