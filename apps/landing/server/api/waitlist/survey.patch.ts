import { serverSupabaseServiceRole } from '#supabase/server'
import { createError, readBody } from 'h3'

interface SurveyBody {
  email?: unknown
  surveyToken?: unknown
  answers?: Record<string, unknown>
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function stringArray(value: unknown) {
  if (!Array.isArray(value)) return null
  return value.filter((item): item is string => typeof item === 'string').slice(0, 20)
}

function optionalString(value: unknown, maxLength = 2000) {
  if (typeof value !== 'string') return null
  return value.trim().slice(0, maxLength) || null
}

export default defineEventHandler(async (event) => {
  const body = await readBody<SurveyBody>(event)

  if (!body) {
    throw createError({ statusCode: 400, statusMessage: 'Treść ankiety jest wymagana.' })
  }

  const email = typeof body?.email === 'string'
    ? body.email.trim().toLowerCase()
    : ''
  const surveyToken = typeof body?.surveyToken === 'string'
    ? body.surveyToken
    : ''

  if (!emailPattern.test(email) || !uuidPattern.test(surveyToken)) {
    throw createError({ statusCode: 400, statusMessage: 'Sesja ankiety jest nieprawidłowa.' })
  }

  const answers = body.answers && typeof body.answers === 'object' ? body.answers : {}
  const supabase = serverSupabaseServiceRole(event)
  const { data, error } = await supabase
    .from('waitlist')
    .update({
      survey_domain: stringArray(answers.domain),
      survey_usecase: stringArray(answers.usecase),
      survey_priority: optionalString(answers.priority, 300),
      survey_contrib: optionalString(answers.contrib, 300),
      survey_notes: optionalString(answers.notes),
      survey_completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('email', email)
    .eq('survey_token', surveyToken)
    .select('id')
    .maybeSingle()

  if (error) {
    throw createError({ statusCode: 500, statusMessage: 'Nie udało się zapisać ankiety.' })
  }
  if (!data) {
    throw createError({ statusCode: 404, statusMessage: 'Sesja ankiety wygasła. Zacznij ponownie.' })
  }

  return { completed: true }
})
