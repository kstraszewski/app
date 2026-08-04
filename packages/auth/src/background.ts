import { waitUntil as vercelWaitUntil } from '@vercel/functions'

/**
 * Keeps an already-handled task alive after the HTTP response. Vercel needs
 * its request-scoped helper; Nitro's event hook covers local and other
 * compatible runtimes.
 */
export function scheduleOpenExpertBackgroundTask(
  task: Promise<unknown>,
  nitroWaitUntil?: (task: Promise<unknown>) => void,
): void {
  if (process.env.VERCEL) {
    vercelWaitUntil(task)
    return
  }
  if (nitroWaitUntil) {
    nitroWaitUntil(task)
    return
  }
  void task
}
