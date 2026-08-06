export { default as MessageAttachmentComposer } from './components/MessageAttachmentComposer.vue'
export { default as MessageAttachments } from './components/MessageAttachments.vue'
export { default as MessageReplyQuote } from './components/MessageReplyQuote.vue'
export {
  classifyMessageAttachmentCompletionFailure,
  formatMessageAttachmentBytes,
  isImageMessageAttachment,
  messageAttachmentFileFingerprint,
  messageAttachmentKindLabel,
  messageAttachmentVisualKind,
} from './helpers.ts'
export type { MessageAttachmentVisualKind } from './helpers.ts'
export {
  MESSAGE_REPLY_SWIPE_ACTIVATION_PX,
  MESSAGE_REPLY_SWIPE_MAX_PX,
  MESSAGE_REPLY_SWIPE_TRIGGER_PX,
  messageReplyPreviewText,
  messageReplyReference,
  resolveMessageReplySwipe,
} from './replies.ts'
export type { MessageReplySwipeFrame } from './replies.ts'
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
