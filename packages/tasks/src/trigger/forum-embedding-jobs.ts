import { schedules } from '@trigger.dev/sdk'
import {
  drainForumEmbeddingJobs,
  forumEmbeddingWorkerConfiguration,
} from '../forum-embedding-worker.js'

/**
 * Continuously materializes vector-search embeddings queued by forum writes.
 * The CRM worker owns the lease, checksum and per-job exponential retry logic;
 * this schedule adds bounded draining and transport-level retries.
 */
export const forumEmbeddingJobs = schedules.task({
  id: 'openexpert-forum-embedding-jobs',
  cron: '* * * * *',
  queue: {
    concurrencyLimit: 1,
  },
  ttl: '2m',
  retry: {
    maxAttempts: 3,
    factor: 2,
    minTimeoutInMs: 1_000,
    maxTimeoutInMs: 15_000,
    randomize: true,
  },
  run: async () => {
    const configuration = forumEmbeddingWorkerConfiguration(process.env)
    if (!configuration) {
      return { skipped: true, reason: 'forum_embeddings_not_configured' as const }
    }

    return {
      skipped: false,
      ...await drainForumEmbeddingJobs(configuration),
    }
  },
})
