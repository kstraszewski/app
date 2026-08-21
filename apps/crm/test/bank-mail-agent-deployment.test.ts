import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import test from 'node:test'

interface ServiceBinding {
  type?: string
  service?: string
  format?: string
  env?: string
}

interface ServiceDefinition {
  root?: string
  framework?: string
  buildCommand?: string
  bindings?: ServiceBinding[]
}

interface RewriteDefinition {
  source?: string
  destination?: { service?: string }
}

interface VercelServicesConfig {
  services?: Record<string, ServiceDefinition>
  rewrites?: RewriteDefinition[]
}

const crmRoot = new URL('../', import.meta.url)

async function loadVercelConfig(): Promise<VercelServicesConfig> {
  const parsed = JSON.parse(await readFile(new URL('vercel.json', crmRoot), 'utf8'))
  return parsed as VercelServicesConfig
}

test('deploys bank-mail EVE as a private service of the CRM Nuxt project', async () => {
  const config = await loadVercelConfig()
  const bankMailService = config.services?.['bank-mail-eve']

  assert.deepEqual(bankMailService, {
    root: 'services/bank-mail-agent',
    buildCommand: 'OPENEXPERT_EVE_DISABLE_NITRO_TSCONFIG=1 eve build',
    framework: 'eve',
  })
  await access(new URL('services/bank-mail-agent/agent/agent.ts', crmRoot))
  await access(new URL(
    'services/bank-mail-agent/agent/hooks/bind-session.ts',
    crmRoot,
  ))

  const publicTargets = (config.rewrites ?? [])
    .map(rewrite => rewrite.destination?.service)
    .filter(Boolean)
  assert.equal(publicTargets.includes('bank-mail-eve'), false)
})

test('self-binds a newly started EVE session before bank-mail analysis', async () => {
  const hook = await readFile(new URL(
    'services/bank-mail-agent/agent/hooks/bind-session.ts',
    crmRoot,
  ), 'utf8')

  assert.match(hook, /'session\.started'/u)
  assert.match(hook, /requireBankMailAgentCaller\(ctx\)/u)
  assert.match(hook, /ctx\.session\.id/u)
  assert.match(hook, /await callBankMailServiceRpc/u)
  assert.match(hook, /bind_bank_mail_agent_run_session/u)
  assert.doesNotMatch(hook, /session\.completed|turn\.completed/u)
})

test('gives only the Nuxt web service a private binding to bank-mail EVE', async () => {
  const config = await loadVercelConfig()
  const web = config.services?.web

  assert.deepEqual(web?.bindings, [{
    type: 'service',
    service: 'bank-mail-eve',
    format: 'url',
    env: 'BANK_MAIL_AGENT_INTERNAL_URL',
  }])

  for (const [name, service] of Object.entries(config.services ?? {})) {
    if (name === 'web') continue
    assert.equal(service.bindings?.some(binding => binding.service === 'bank-mail-eve') ?? false, false)
  }
})
