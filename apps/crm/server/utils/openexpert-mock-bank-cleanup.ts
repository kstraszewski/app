import type { H3Event } from 'h3'
import { serverStorageClient } from './platform-storage.ts'
import {
  claimOpenExpertMockBankPayloadCleanupJobs,
  finalizeOpenExpertMockBankPayloadCleanupJob,
  type OpenExpertMockBankPayloadCleanupJob,
} from './openexpert-mock-bank-dispatch.ts'
import { OPENEXPERT_MOCK_BANK_OUTBOX_NAMESPACE } from './openexpert-mock-bank-payload.ts'

async function processJob(event: H3Event, job: OpenExpertMockBankPayloadCleanupJob): Promise<boolean> {
  try {
    await serverStorageClient(event).delete({
      namespace: OPENEXPERT_MOCK_BANK_OUTBOX_NAMESPACE,
      path: job.storagePath,
    })
    await finalizeOpenExpertMockBankPayloadCleanupJob({
      event,
      jobId: job.jobId,
      claimToken: job.claimToken,
      succeeded: true,
    })
    return true
  }
  catch {
    try {
      await finalizeOpenExpertMockBankPayloadCleanupJob({
        event,
        jobId: job.jobId,
        claimToken: job.claimToken,
        succeeded: false,
        errorCode: 'mock_bank_payload_delete_failed',
      })
    }
    catch {
      // The five-minute database claim expires and is reclaimed by a later
      // action even if both object deletion and failure bookkeeping fail.
    }
    return false
  }
}

export interface OpenExpertMockBankPayloadCleanupResult {
  claimed: number
  completed: number
  failed: number
}

/**
 * Drains the durable deletion queue. Scheduled workers observe claim failures
 * by default. User-facing send/replay actions explicitly suppress only that
 * claim error so cleanup can never turn a durably sent email into a failed
 * request; stale claims remain safe to retry later.
 */
export async function cleanupOpenExpertMockBankPayloads(
  event: H3Event,
  options: { limit?: number, suppressClaimErrors?: boolean } = {},
): Promise<OpenExpertMockBankPayloadCleanupResult> {
  let jobs: OpenExpertMockBankPayloadCleanupJob[]
  try {
    jobs = await claimOpenExpertMockBankPayloadCleanupJobs({
      event,
      limit: options.limit ?? 4,
    })
  }
  catch (error) {
    if (!options.suppressClaimErrors) throw error
    return { claimed: 0, completed: 0, failed: 0 }
  }
  const results = await Promise.all(jobs.map(job => processJob(event, job)))
  const completed = results.filter(Boolean).length
  return {
    claimed: jobs.length,
    completed,
    failed: jobs.length - completed,
  }
}
