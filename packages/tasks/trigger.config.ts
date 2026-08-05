import { defineConfig } from '@trigger.dev/sdk'

const project = process.env.TRIGGER_PROJECT_REF?.trim()
  || 'proj_wqbvdyoozgchuvesytka'

if (project === 'proj_your_project_ref') {
  throw new Error(
    'Replace the placeholder TRIGGER_PROJECT_REF before running Trigger.dev.',
  )
}

export default defineConfig({
  project,
  dirs: ['./src/trigger'],
  maxDuration: 3600,
  retries: {
    enabledInDev: true,
    default: {
      factor: 2,
      maxAttempts: 3,
      maxTimeoutInMs: 10_000,
      minTimeoutInMs: 1_000,
      randomize: true,
    },
  },
  runtime: 'node-24',
})
