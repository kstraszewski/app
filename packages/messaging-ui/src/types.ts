import type { MessageAttachment } from '@openexpert/messaging'
import type {
  ComputedRef,
  ShallowRef,
} from 'vue'

export type MessageAttachmentDraftStatus =
  | 'queued'
  | 'uploading'
  | 'verifying'
  | 'ready'
  | 'failed'

export type MessageAttachmentFailureStage =
  | 'reserve'
  | 'upload'
  | 'complete'

export interface MessageAttachmentReservationInput {
  clientMessageId: string
  name: string
  mimeType: string
  sizeBytes: number
}

export interface MessageAttachmentUploadTarget {
  url: string
  method: 'PUT'
  headers?: Readonly<Record<string, string>>
}

export interface MessageAttachmentUploadReservation {
  attachment: MessageAttachment
  upload: MessageAttachmentUploadTarget
}

export type MessageAttachmentCompletionFailureMode =
  | 'retry-complete'
  | 'restart-upload'

export interface MessageAttachmentDraftAdapter {
  reserve(
    input: MessageAttachmentReservationInput,
  ): Promise<MessageAttachmentUploadReservation>
  complete(id: string): Promise<MessageAttachment>
  discard(id: string): Promise<void>
  completionFailureMode?(
    error: unknown,
  ): MessageAttachmentCompletionFailureMode
}

export interface MessageAttachmentDraft {
  draftId: string
  clientMessageId: string
  file: File
  name: string
  mimeType: string
  sizeBytes: number
  previewUrl: string | null
  attachment: MessageAttachment | null
  status: MessageAttachmentDraftStatus
  progress: number
  error: string | null
  failureStage: MessageAttachmentFailureStage | null
}

export interface MessageAttachmentDraftRejection {
  id: string
  name: string
  reason: string
}

export interface AddMessageAttachmentDraftsResult {
  acceptedDraftIds: string[]
  rejected: MessageAttachmentDraftRejection[]
}

export interface ClearMessageAttachmentDraftsOptions {
  /**
   * Discard reserved server attachments. Set this to false only after the
   * message that references every ready attachment has been committed.
   */
  discard?: boolean
}

export interface MessageAttachmentDraftController {
  drafts: Readonly<ShallowRef<readonly MessageAttachmentDraft[]>>
  rejections: Readonly<ShallowRef<readonly MessageAttachmentDraftRejection[]>>
  readyAttachments: ComputedRef<MessageAttachment[]>
  isBusy: ComputedRef<boolean>
  hasFailed: ComputedRef<boolean>
  addFiles(
    files: Iterable<File> | ArrayLike<File>,
    clientMessageId: string,
  ): AddMessageAttachmentDraftsResult
  addPasteEvent(
    event: ClipboardEvent,
    clientMessageId: string,
  ): AddMessageAttachmentDraftsResult
  retry(draftId: string): Promise<void>
  remove(draftId: string): Promise<void>
  dismissRejection(id: string): void
  invalidateReadyAttachments(
    attachmentIds: readonly string[],
    message?: string,
  ): void
  restartForClientMessageId(clientMessageId: string): Promise<void>
  clear(options?: ClearMessageAttachmentDraftsOptions): Promise<void>
  dispose(): void
}
