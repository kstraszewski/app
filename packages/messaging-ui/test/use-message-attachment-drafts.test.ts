import assert from 'node:assert/strict'
import test from 'node:test'
import type { MessageAttachment } from '@openexpert/messaging'
import { useMessageAttachmentDrafts } from '../src/composables/useMessageAttachmentDrafts.ts'
import { classifyMessageAttachmentCompletionFailure } from '../src/helpers.ts'
import type { MessageAttachmentDraftAdapter } from '../src/types.ts'

class FakeXmlHttpRequest extends EventTarget {
  static instances: FakeXmlHttpRequest[] = []
  static active = 0
  static maximumActive = 0

  readonly upload = new EventTarget()
  status = 0
  file: File | null = null
  finished = false

  static reset() {
    FakeXmlHttpRequest.instances = []
    FakeXmlHttpRequest.active = 0
    FakeXmlHttpRequest.maximumActive = 0
  }

  open(_method: string, _url: string, _async: boolean) {}

  setRequestHeader(_name: string, _value: string) {}

  send(file: File) {
    this.file = file
    FakeXmlHttpRequest.instances.push(this)
    FakeXmlHttpRequest.active += 1
    FakeXmlHttpRequest.maximumActive = Math.max(
      FakeXmlHttpRequest.maximumActive,
      FakeXmlHttpRequest.active,
    )
  }

  progress(loaded: number) {
    if (!this.file) return
    const event = new Event('progress')
    Object.defineProperties(event, {
      lengthComputable: { value: true },
      loaded: { value: loaded },
      total: { value: this.file.size },
    })
    this.upload.dispatchEvent(event)
  }

  succeed() {
    if (this.finished) return
    this.finished = true
    this.status = 200
    FakeXmlHttpRequest.active -= 1
    this.dispatchEvent(new Event('load'))
  }

  abort() {
    if (this.finished) return
    this.finished = true
    if (this.file) FakeXmlHttpRequest.active -= 1
    this.dispatchEvent(new Event('abort'))
  }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  throw new Error('Timed out waiting for attachment draft state')
}

function attachmentAdapter(options: {
  failFirstCompletion?: 'transient' | 'terminal'
} = {}) {
  const attachments = new Map<string, MessageAttachment>()
  const discarded: string[] = []
  const reservedClientMessageIds: string[] = []
  let reservations = 0
  let completions = 0

  const adapter: MessageAttachmentDraftAdapter = {
    async reserve(input) {
      reservations += 1
      reservedClientMessageIds.push(input.clientMessageId)
      const attachment = {
        id: crypto.randomUUID(),
        name: input.name,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
      }
      attachments.set(attachment.id, attachment)
      return {
        attachment,
        upload: { url: `https://uploads.test/${attachment.id}`, method: 'PUT' },
      }
    },
    async complete(id) {
      completions += 1
      if (options.failFirstCompletion && completions === 1) {
        if (options.failFirstCompletion === 'terminal') {
          throw Object.assign(new Error('Rezerwacja wygasła.'), { statusCode: 410 })
        }
        throw new Error('Weryfikacja jest chwilowo niedostępna.')
      }
      const attachment = attachments.get(id)
      if (!attachment) throw new Error('Missing attachment')
      return attachment
    },
    async discard(id) {
      discarded.push(id)
    },
    completionFailureMode: classifyMessageAttachmentCompletionFailure,
  }

  return {
    adapter,
    discarded,
    reservations: () => reservations,
    completions: () => completions,
    reservedClientMessageIds,
  }
}

function installFakeXhr() {
  const previous = globalThis.XMLHttpRequest
  Object.defineProperty(globalThis, 'XMLHttpRequest', {
    configurable: true,
    value: FakeXmlHttpRequest,
  })
  return () => Object.defineProperty(globalThis, 'XMLHttpRequest', {
    configurable: true,
    value: previous,
  })
}

test('uploads at most three attachments concurrently and completes the queue', async () => {
  FakeXmlHttpRequest.reset()
  const restoreXhr = installFakeXhr()
  const fixture = attachmentAdapter()
  const controller = useMessageAttachmentDrafts(fixture.adapter)
  try {
    const files = Array.from({ length: 5 }, (_, index) => new File(
      [`file-${index}`],
      `file-${index}.txt`,
      { type: 'text/plain', lastModified: index },
    ))
    const result = controller.addFiles(files, crypto.randomUUID())
    assert.equal(result.acceptedDraftIds.length, 5)

    await waitFor(() => FakeXmlHttpRequest.instances.length === 3)
    assert.equal(FakeXmlHttpRequest.maximumActive, 3)
    FakeXmlHttpRequest.instances[0]!.progress(3)
    assert.ok(controller.drafts.value[0]!.progress > 0)
    for (const request of FakeXmlHttpRequest.instances.slice(0, 3)) request.succeed()

    await waitFor(() => FakeXmlHttpRequest.instances.length === 5)
    for (const request of FakeXmlHttpRequest.instances.slice(3)) request.succeed()
    await waitFor(() => controller.readyAttachments.value.length === 5)

    assert.equal(FakeXmlHttpRequest.maximumActive, 3)
    assert.equal(fixture.reservations(), 5)
    assert.equal(fixture.completions(), 5)
    await controller.clear({ discard: false })
    assert.deepEqual(fixture.discarded, [])
  }
  finally {
    controller.dispose()
    restoreXhr()
  }
})

test('retries completion without uploading the file a second time', async () => {
  FakeXmlHttpRequest.reset()
  const restoreXhr = installFakeXhr()
  const fixture = attachmentAdapter({ failFirstCompletion: 'transient' })
  const controller = useMessageAttachmentDrafts(fixture.adapter)
  try {
    controller.addFiles([
      new File(['document'], 'document.pdf', { type: 'application/pdf' }),
    ], crypto.randomUUID())
    await waitFor(() => FakeXmlHttpRequest.instances.length === 1)
    FakeXmlHttpRequest.instances[0]!.succeed()
    await waitFor(() => controller.drafts.value[0]?.status === 'failed')

    const failed = controller.drafts.value[0]!
    assert.equal(failed.failureStage, 'complete')
    await controller.retry(failed.draftId)
    await waitFor(() => controller.readyAttachments.value.length === 1)

    assert.equal(FakeXmlHttpRequest.instances.length, 1)
    assert.equal(fixture.reservations(), 1)
    assert.equal(fixture.completions(), 2)
    await controller.clear({ discard: false })
  }
  finally {
    controller.dispose()
    restoreXhr()
  }
})

test('restarts the upload with a fresh reservation after a terminal completion error', async () => {
  FakeXmlHttpRequest.reset()
  const restoreXhr = installFakeXhr()
  const fixture = attachmentAdapter({ failFirstCompletion: 'terminal' })
  const controller = useMessageAttachmentDrafts(fixture.adapter)
  try {
    controller.addFiles([
      new File(['document'], 'document.pdf', { type: 'application/pdf' }),
    ], crypto.randomUUID())
    await waitFor(() => FakeXmlHttpRequest.instances.length === 1)
    FakeXmlHttpRequest.instances[0]!.succeed()
    await waitFor(() => controller.drafts.value[0]?.status === 'failed')

    const failed = controller.drafts.value[0]!
    assert.equal(failed.failureStage, 'upload')
    await controller.retry(failed.draftId)
    await waitFor(() => FakeXmlHttpRequest.instances.length === 2)
    FakeXmlHttpRequest.instances[1]!.succeed()
    await waitFor(() => controller.readyAttachments.value.length === 1)

    assert.equal(fixture.reservations(), 2)
    assert.equal(fixture.completions(), 2)
    assert.equal(fixture.discarded.length, 1)
    await controller.clear({ discard: false })
  }
  finally {
    controller.dispose()
    restoreXhr()
  }
})

test('invalidates an expired ready attachment and re-uploads it on retry', async () => {
  FakeXmlHttpRequest.reset()
  const restoreXhr = installFakeXhr()
  const fixture = attachmentAdapter()
  const controller = useMessageAttachmentDrafts(fixture.adapter)
  try {
    controller.addFiles([
      new File(['photo'], 'photo.jpg', { type: 'image/jpeg' }),
    ], crypto.randomUUID())
    await waitFor(() => FakeXmlHttpRequest.instances.length === 1)
    FakeXmlHttpRequest.instances[0]!.succeed()
    await waitFor(() => controller.readyAttachments.value.length === 1)
    const expiredId = controller.readyAttachments.value[0]!.id

    controller.invalidateReadyAttachments([expiredId])
    const failed = controller.drafts.value[0]!
    assert.equal(failed.status, 'failed')
    assert.equal(failed.failureStage, 'upload')
    assert.equal(controller.readyAttachments.value.length, 0)

    await controller.retry(failed.draftId)
    await waitFor(() => FakeXmlHttpRequest.instances.length === 2)
    FakeXmlHttpRequest.instances[1]!.succeed()
    await waitFor(() => controller.readyAttachments.value.length === 1)
    assert.notEqual(controller.readyAttachments.value[0]!.id, expiredId)
    assert.equal(fixture.discarded.includes(expiredId), true)
    await controller.clear({ discard: false })
  }
  finally {
    controller.dispose()
    restoreXhr()
  }
})

test('rebinds retained files to a fresh idempotency key when the draft changes', async () => {
  FakeXmlHttpRequest.reset()
  const restoreXhr = installFakeXhr()
  const fixture = attachmentAdapter()
  const controller = useMessageAttachmentDrafts(fixture.adapter)
  try {
    const originalClientMessageId = crypto.randomUUID()
    const nextClientMessageId = crypto.randomUUID()
    controller.addFiles([
      new File(['report'], 'report.txt', { type: 'text/plain' }),
    ], originalClientMessageId)
    await waitFor(() => FakeXmlHttpRequest.instances.length === 1)
    FakeXmlHttpRequest.instances[0]!.succeed()
    await waitFor(() => controller.readyAttachments.value.length === 1)

    await controller.restartForClientMessageId(nextClientMessageId)
    await waitFor(() => FakeXmlHttpRequest.instances.length === 2)
    FakeXmlHttpRequest.instances[1]!.succeed()
    await waitFor(() => controller.readyAttachments.value.length === 1)

    assert.deepEqual(fixture.reservedClientMessageIds, [
      originalClientMessageId,
      nextClientMessageId,
    ])
    assert.equal(fixture.discarded.length, 1)
    await controller.clear({ discard: false })
  }
  finally {
    controller.dispose()
    restoreXhr()
  }
})

test('aborts and discards a reserved attachment when removed', async () => {
  FakeXmlHttpRequest.reset()
  const restoreXhr = installFakeXhr()
  const fixture = attachmentAdapter()
  const controller = useMessageAttachmentDrafts(fixture.adapter)
  try {
    controller.addFiles([
      new File(['photo'], 'photo.jpg', { type: 'image/jpeg' }),
    ], crypto.randomUUID())
    await waitFor(() => FakeXmlHttpRequest.instances.length === 1)
    const draft = controller.drafts.value[0]!
    await controller.remove(draft.draftId)

    assert.equal(FakeXmlHttpRequest.instances[0]!.finished, true)
    assert.equal(controller.drafts.value.length, 0)
    assert.equal(fixture.discarded.length, 1)
  }
  finally {
    controller.dispose()
    restoreXhr()
  }
})
