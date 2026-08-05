export { default as MessageAttachmentComposer } from './components/MessageAttachmentComposer.vue'
export { default as MessageAttachments } from './components/MessageAttachments.vue'
export {
  classifyMessageAttachmentCompletionFailure,
  formatMessageAttachmentBytes,
  isImageMessageAttachment,
  messageAttachmentFileFingerprint,
  messageAttachmentKindLabel,
  messageAttachmentVisualKind,
} from './helpers.ts'
export type { MessageAttachmentVisualKind } from './helpers.ts'
export { useMessageAttachmentDrafts } from './composables/useMessageAttachmentDrafts.ts'
export type {
  AddMessageAttachmentDraftsResult,
  ClearMessageAttachmentDraftsOptions,
  MessageAttachmentDraft,
  MessageAttachmentDraftAdapter,
  MessageAttachmentCompletionFailureMode,
  MessageAttachmentDraftController,
  MessageAttachmentDraftRejection,
  MessageAttachmentDraftStatus,
  MessageAttachmentFailureStage,
  MessageAttachmentReservationInput,
  MessageAttachmentUploadReservation,
  MessageAttachmentUploadTarget,
} from './types.ts'
