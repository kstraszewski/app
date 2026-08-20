import {
  defaultBackend,
  defineSandbox,
  type SandboxBackend,
  type SandboxNetworkPolicy,
} from 'eve/sandbox'

type BankMailSandboxSessionOptions = {
  networkPolicy?: SandboxNetworkPolicy
}

const backend = defaultBackend({
  vercel: { networkPolicy: 'deny-all' },
  docker: { networkPolicy: 'deny-all' },
  microsandbox: { networkPolicy: 'deny-all' },
}) as SandboxBackend<Record<string, never>, BankMailSandboxSessionOptions>

export default defineSandbox<Record<string, never>, BankMailSandboxSessionOptions>({
  backend,
  description: 'No agent-authored sandbox capabilities; all isolating backends deny network egress.',
  async onSession({ use }) {
    // Re-apply per durable session. A backend that cannot enforce the policy
    // rejects session creation, so the agent fails closed.
    await use({ networkPolicy: 'deny-all' })
  },
})
