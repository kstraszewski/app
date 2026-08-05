import {
  MESSAGE_ATTACHMENT_MAX_FILES,
  MESSAGE_ATTACHMENT_MAX_TOTAL_BYTES,
  validateMessageAttachmentCandidate,
  type MessageAttachment,
} from '@openexpert/messaging'
import {
  computed,
  getCurrentScope,
  onScopeDispose,
  shallowRef,
} from 'vue'
import { messageAttachmentFileFingerprint } from '../helpers.ts'
import type {
  AddMessageAttachmentDraftsResult,
  ClearMessageAttachmentDraftsOptions,
  MessageAttachmentDraft,
  MessageAttachmentDraftAdapter,
  MessageAttachmentDraftController,
  MessageAttachmentDraftRejection,
  MessageAttachmentFailureStage,
  MessageAttachmentUploadTarget,
} from '../types.ts'

const MAX_CONCURRENT_UPLOADS = 3
const UPLOAD_TIMEOUT_MS = 10 * 60 * 1000

function normalizedFiles(
  files: Iterable<File> | ArrayLike<File>,
): File[] {
  return Array.from(files)
}

function createPreviewUrl(file: File, mimeType: string): string | null {
  if (!mimeType.startsWith('image/')) return null
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return null
  return URL.createObjectURL(file)
}

function revokePreviewUrl(url: string | null): void {
  if (!url || typeof URL === 'undefined' || typeof URL.revokeObjectURL !== 'function') return
  URL.revokeObjectURL(url)
}

function uploadErrorMessage(error: unknown, stage: MessageAttachmentFailureStage): string {
  if (error instanceof Error && error.name !== 'AbortError' && error.message.trim()) {
    return error.message
  }
  if (stage === 'complete') return 'Plik został przesłany, ale nie udało się go zweryfikować.'
  if (stage === 'reserve') return 'Nie udało się przygotować bezpiecznego przesyłania.'
  return 'Nie udało się przesłać pliku.'
}

function candidateRejectionMessage(reason: string): string {
  if (reason === 'File name is invalid') return 'Nazwa pliku jest nieprawidłowa.'
  if (reason === 'File must not be empty') return 'Plik jest pusty.'
  if (reason === 'File exceeds the 25 MiB limit') return 'Plik przekracza limit 25 MB.'
  if (reason === 'File extension does not match its type') {
    return 'Rozszerzenie pliku nie pasuje do jego typu.'
  }
  if (reason === 'File type is not supported') return 'Ten typ pliku nie jest obsługiwany.'
  return reason
}

function uploadWithXhr(
  target: MessageAttachmentUploadTarget,
  file: File,
  signal: AbortSignal,
  onProgress: (progress: number) => void,
): Promise<void> {
  if (typeof XMLHttpRequest === 'undefined') {
    return Promise.reject(new Error('Przesyłanie plików wymaga przeglądarki.'))
  }
  if (target.method !== 'PUT') {
    return Promise.reject(new Error('Nieobsługiwana metoda przesyłania pliku.'))
  }

  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    let settled = false

    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', abort)
      callback()
    }
    const abort = () => {
      request.abort()
      const error = new Error('Przesyłanie anulowane.')
      error.name = 'AbortError'
      finish(() => reject(error))
    }

    request.open('PUT', target.url, true)
    request.timeout = UPLOAD_TIMEOUT_MS
    for (const [name, value] of Object.entries(target.headers ?? {})) {
      request.setRequestHeader(name, value)
    }
    request.upload.addEventListener('progress', (event) => {
      const total = event.lengthComputable && event.total > 0 ? event.total : file.size
      if (!total) return
      onProgress(Math.min(99, Math.max(0, Math.round((event.loaded / total) * 100))))
    })
    request.addEventListener('load', () => {
      if (request.status >= 200 && request.status < 300) {
        finish(resolve)
        return
      }
      finish(() => reject(new Error(`Przesyłanie pliku zakończyło się błędem ${request.status}.`)))
    })
    request.addEventListener('error', () => {
      finish(() => reject(new Error('Połączenie zostało przerwane podczas przesyłania.')))
    })
    request.addEventListener('timeout', () => {
      finish(() => reject(new Error('Przesyłanie pliku trwało zbyt długo.')))
    })
    request.addEventListener('abort', () => {
      const error = new Error('Przesyłanie anulowane.')
      error.name = 'AbortError'
      finish(() => reject(error))
    })

    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) {
      abort()
      return
    }
    request.send(file)
  })
}

function clipboardFiles(event: ClipboardEvent): File[] {
  const items = Array.from(event.clipboardData?.items ?? [])
  return items.flatMap((item) => {
    if (item.kind !== 'file') return []
    const file = item.getAsFile()
    return file ? [file] : []
  })
}

export function useMessageAttachmentDrafts(
  adapter: MessageAttachmentDraftAdapter,
): MessageAttachmentDraftController {
  const drafts = shallowRef<readonly MessageAttachmentDraft[]>([])
  const rejections = shallowRef<readonly MessageAttachmentDraftRejection[]>([])
  const readyAttachments = computed<MessageAttachment[]>(() => drafts.value
    .filter(draft => draft.status === 'ready' && draft.attachment)
    .map(draft => draft.attachment as MessageAttachment))
  const isBusy = computed(() => drafts.value.some(
    draft => draft.status === 'queued'
      || draft.status === 'uploading'
      || draft.status === 'verifying',
  ))
  const hasFailed = computed(() => drafts.value.some(draft => draft.status === 'failed'))

  const activeDraftIds = new Set<string>()
  const abortControllers = new Map<string, AbortController>()
  const runVersions = new Map<string, number>()
  let pumpScheduled = false
  let disposed = false

  function findDraft(draftId: string): MessageAttachmentDraft | undefined {
    return drafts.value.find(draft => draft.draftId === draftId)
  }

  function patchDraft(
    draftId: string,
    patch: Partial<MessageAttachmentDraft>,
  ): void {
    drafts.value = drafts.value.map(draft => draft.draftId === draftId
      ? { ...draft, ...patch }
      : draft)
  }

  function nextRunVersion(draftId: string): number {
    const next = (runVersions.get(draftId) ?? 0) + 1
    runVersions.set(draftId, next)
    return next
  }

  function isCurrentRun(draftId: string, version: number): boolean {
    return runVersions.get(draftId) === version && Boolean(findDraft(draftId))
  }

  function schedulePump(): void {
    if (disposed || pumpScheduled) return
    pumpScheduled = true
    queueMicrotask(pump)
  }

  function pump(): void {
    pumpScheduled = false
    if (disposed) return

    const availableSlots = MAX_CONCURRENT_UPLOADS - activeDraftIds.size
    if (availableSlots <= 0) return
    const queued = drafts.value
      .filter(draft => draft.status === 'queued' && !activeDraftIds.has(draft.draftId))
      .slice(0, availableSlots)

    for (const draft of queued) {
      activeDraftIds.add(draft.draftId)
      const version = nextRunVersion(draft.draftId)
      const resumeCompletion = draft.failureStage === 'complete' && Boolean(draft.attachment)
      patchDraft(draft.draftId, {
        status: resumeCompletion ? 'verifying' : 'uploading',
        error: null,
        failureStage: null,
        progress: resumeCompletion ? 100 : 0,
      })
      void processDraft(draft.draftId, version, resumeCompletion)
        .finally(() => {
          activeDraftIds.delete(draft.draftId)
          abortControllers.delete(draft.draftId)
          schedulePump()
        })
    }
  }

  async function processDraft(
    draftId: string,
    version: number,
    resumeCompletion: boolean,
  ): Promise<void> {
    let stage: MessageAttachmentFailureStage = resumeCompletion ? 'complete' : 'reserve'
    try {
      let draft = findDraft(draftId)
      if (!draft) return
      let attachment = draft.attachment

      if (!resumeCompletion) {
        const reservation = await adapter.reserve({
          clientMessageId: draft.clientMessageId,
          name: draft.name,
          mimeType: draft.mimeType,
          sizeBytes: draft.sizeBytes,
        })
        attachment = reservation.attachment
        if (!isCurrentRun(draftId, version)) {
          await adapter.discard(attachment.id).catch(() => undefined)
          return
        }
        patchDraft(draftId, { attachment })

        stage = 'upload'
        const abortController = new AbortController()
        abortControllers.set(draftId, abortController)
        await uploadWithXhr(
          reservation.upload,
          draft.file,
          abortController.signal,
          (progress) => {
            if (isCurrentRun(draftId, version)) patchDraft(draftId, { progress })
          },
        )
        if (!isCurrentRun(draftId, version)) return
        patchDraft(draftId, { status: 'verifying', progress: 100 })
      }

      if (!attachment) throw new Error('Brak rezerwacji przesyłanego pliku.')
      stage = 'complete'
      const completedAttachment = await adapter.complete(attachment.id)
      if (!isCurrentRun(draftId, version)) return
      patchDraft(draftId, {
        attachment: completedAttachment,
        status: 'ready',
        progress: 100,
        error: null,
        failureStage: null,
      })
    }
    catch (error) {
      if (!isCurrentRun(draftId, version)) return
      if (error instanceof Error && error.name === 'AbortError') return
      const failureStage = stage === 'complete'
        && adapter.completionFailureMode?.(error) === 'restart-upload'
        ? 'upload'
        : stage
      patchDraft(draftId, {
        status: 'failed',
        error: uploadErrorMessage(error, stage),
        failureStage,
      })
    }
  }

  function addFiles(
    files: Iterable<File> | ArrayLike<File>,
    clientMessageId: string,
  ): AddMessageAttachmentDraftsResult {
    if (disposed) throw new Error('Obsługa załączników została już zamknięta.')
    const accepted: MessageAttachmentDraft[] = []
    const rejected: MessageAttachmentDraftRejection[] = []
    const existingFingerprints = new Set(drafts.value.map(
      draft => messageAttachmentFileFingerprint(draft.file),
    ))
    let fileCount = drafts.value.length
    let totalBytes = drafts.value.reduce((total, draft) => total + draft.sizeBytes, 0)

    for (const file of normalizedFiles(files)) {
      let reason = ''
      const validation = validateMessageAttachmentCandidate({
        name: file.name,
        type: file.type,
        size: file.size,
      })
      if (!validation.ok) reason = candidateRejectionMessage(validation.reason)
      else if (fileCount >= MESSAGE_ATTACHMENT_MAX_FILES) {
        reason = `Do jednej wiadomości można dodać maksymalnie ${MESSAGE_ATTACHMENT_MAX_FILES} plików.`
      }
      else if (totalBytes + file.size > MESSAGE_ATTACHMENT_MAX_TOTAL_BYTES) {
        reason = 'Łączny rozmiar załączników w wiadomości jest zbyt duży.'
      }
      else if (existingFingerprints.has(messageAttachmentFileFingerprint(file))) {
        reason = 'Ten plik został już dodany.'
      }

      if (reason || !validation.ok) {
        rejected.push({ id: crypto.randomUUID(), name: file.name, reason })
        continue
      }

      const draft: MessageAttachmentDraft = {
        draftId: crypto.randomUUID(),
        clientMessageId,
        file,
        name: file.name,
        mimeType: validation.mimeType,
        sizeBytes: file.size,
        previewUrl: createPreviewUrl(file, validation.mimeType),
        attachment: null,
        status: 'queued',
        progress: 0,
        error: null,
        failureStage: null,
      }
      accepted.push(draft)
      existingFingerprints.add(messageAttachmentFileFingerprint(file))
      fileCount += 1
      totalBytes += file.size
    }

    if (accepted.length) {
      drafts.value = [...drafts.value, ...accepted]
      schedulePump()
    }
    if (rejected.length) rejections.value = [...rejections.value, ...rejected]
    return {
      acceptedDraftIds: accepted.map(draft => draft.draftId),
      rejected,
    }
  }

  function addPasteEvent(
    event: ClipboardEvent,
    clientMessageId: string,
  ): AddMessageAttachmentDraftsResult {
    const files = clipboardFiles(event)
    if (!files.length) return { acceptedDraftIds: [], rejected: [] }
    event.preventDefault()
    return addFiles(files, clientMessageId)
  }

  async function retry(draftId: string): Promise<void> {
    const draft = findDraft(draftId)
    if (!draft || draft.status !== 'failed') return

    if (draft.failureStage === 'complete' && draft.attachment) {
      patchDraft(draftId, { status: 'queued', error: null })
      schedulePump()
      return
    }

    if (draft.attachment) {
      const attachmentId = draft.attachment.id
      activeDraftIds.add(draftId)
      patchDraft(draftId, { attachment: null, status: 'queued', error: null })
      try {
        await adapter.discard(attachmentId).catch(() => undefined)
      }
      finally {
        activeDraftIds.delete(draftId)
      }
      if (!findDraft(draftId)) {
        schedulePump()
        return
      }
    }
    patchDraft(draftId, {
      status: 'queued',
      progress: 0,
      error: null,
      failureStage: null,
    })
    schedulePump()
  }

  async function remove(draftId: string): Promise<void> {
    const draft = findDraft(draftId)
    if (!draft) return
    nextRunVersion(draftId)
    abortControllers.get(draftId)?.abort()
    abortControllers.delete(draftId)
    drafts.value = drafts.value.filter(item => item.draftId !== draftId)
    revokePreviewUrl(draft.previewUrl)
    if (draft.attachment) await adapter.discard(draft.attachment.id).catch(() => undefined)
    schedulePump()
  }

  function dismissRejection(id: string): void {
    rejections.value = rejections.value.filter(rejection => rejection.id !== id)
  }

  function invalidateReadyAttachments(
    attachmentIds: readonly string[],
    message = 'Załącznik wygasł. Prześlij go ponownie.',
  ): void {
    const ids = new Set(attachmentIds)
    drafts.value = drafts.value.map((draft) => {
      if (
        draft.status !== 'ready'
        || !draft.attachment
        || !ids.has(draft.attachment.id)
      ) return draft
      return {
        ...draft,
        status: 'failed',
        error: message,
        failureStage: 'upload',
      }
    })
  }

  async function restartForClientMessageId(clientMessageId: string): Promise<void> {
    if (disposed) throw new Error('Obsługa załączników została już zamknięta.')
    const previousDrafts = [...drafts.value]
    if (!previousDrafts.length) return

    for (const draft of previousDrafts) {
      nextRunVersion(draft.draftId)
      abortControllers.get(draft.draftId)?.abort()
      abortControllers.delete(draft.draftId)
      activeDraftIds.add(draft.draftId)
    }
    drafts.value = previousDrafts.map(draft => ({
      ...draft,
      clientMessageId,
      attachment: null,
      status: 'queued',
      progress: 0,
      error: null,
      failureStage: null,
    }))

    try {
      await Promise.all(previousDrafts.flatMap(draft => draft.attachment
        ? [adapter.discard(draft.attachment.id).catch(() => undefined)]
        : []))
    }
    finally {
      for (const draft of previousDrafts) activeDraftIds.delete(draft.draftId)
      schedulePump()
    }
  }

  async function clear(
    options: ClearMessageAttachmentDraftsOptions = {},
  ): Promise<void> {
    const previousDrafts = [...drafts.value]
    drafts.value = []
    rejections.value = []
    for (const draft of previousDrafts) {
      nextRunVersion(draft.draftId)
      abortControllers.get(draft.draftId)?.abort()
      revokePreviewUrl(draft.previewUrl)
    }
    abortControllers.clear()

    const draftsToDiscard = options.discard === false
      ? previousDrafts.filter(draft => draft.status !== 'ready')
      : previousDrafts
    if (draftsToDiscard.length) {
      await Promise.all(draftsToDiscard.flatMap(draft => draft.attachment
        ? [adapter.discard(draft.attachment.id).catch(() => undefined)]
        : []))
    }
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    void clear()
  }

  if (getCurrentScope()) onScopeDispose(dispose)

  return {
    drafts,
    rejections,
    readyAttachments,
    isBusy,
    hasFailed,
    addFiles,
    addPasteEvent,
    retry,
    remove,
    dismissRejection,
    invalidateReadyAttachments,
    restartForClientMessageId,
    clear,
    dispose,
  }
}
