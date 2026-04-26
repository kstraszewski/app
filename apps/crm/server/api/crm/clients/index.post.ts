import { readBody } from 'h3'
import {
  asRecord,
  recordCrmActivity,
  requireCrmSession,
  requiredText,
  stringArrayValue,
  textValue,
  throwDbError,
} from '~~/server/utils/crm'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const body = asRecord(await readBody(event))
  const primaryPerson = asRecord(body.primary_person)
  const displayName = textValue(body.display_name)
    ?? [textValue(primaryPerson.first_name), textValue(primaryPerson.last_name)].filter(Boolean).join(' ')
    ?? textValue(body.primary_email)
    ?? textValue(body.primary_phone)

  if (!displayName) {
    requiredText(body.display_name, 'display_name')
  }

  const { data: client, error } = await session.supabase
    .from('crm_clients')
    .insert({
      organization_id: session.organizationId,
      owner_user_id: textValue(body.owner_user_id) ?? session.userId,
      display_name: displayName,
      status_code: textValue(body.status_code) ?? 'lead',
      lead_source: textValue(body.lead_source) ?? null,
      primary_email: textValue(body.primary_email) ?? textValue(primaryPerson.email) ?? null,
      primary_phone: textValue(body.primary_phone) ?? textValue(primaryPerson.phone) ?? null,
      tags: stringArrayValue(body.tags),
      notes: textValue(body.notes) ?? null,
      metadata: asRecord(body.metadata),
    })
    .select('*')
    .single()

  throwDbError(error)

  let people: unknown[] = []
  if (client && (Object.keys(primaryPerson).length || textValue(body.primary_email) || textValue(body.primary_phone))) {
    const { data, error: peopleError } = await session.supabase
      .from('crm_client_people')
      .insert({
        organization_id: session.organizationId,
        client_id: client.id,
        role: textValue(primaryPerson.role) ?? 'primary',
        first_name: textValue(primaryPerson.first_name) ?? null,
        last_name: textValue(primaryPerson.last_name) ?? null,
        display_name: textValue(primaryPerson.display_name) ?? displayName,
        email: textValue(primaryPerson.email) ?? textValue(body.primary_email) ?? null,
        phone: textValue(primaryPerson.phone) ?? textValue(body.primary_phone) ?? null,
        pesel: textValue(primaryPerson.pesel) ?? null,
        metadata: asRecord(primaryPerson.metadata),
      })
      .select('*')

    throwDbError(peopleError)
    people = data ?? []
  }

  await recordCrmActivity(session, {
    client_id: client.id,
    activity_type: 'client_created',
    title: 'Dodano klienta',
    body: displayName,
  })

  return { data: client, people }
})

