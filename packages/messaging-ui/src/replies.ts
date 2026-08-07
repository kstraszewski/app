import {
  buildMessagePreview,
  type Message,
  type MessageReplyReference,
} from '@openexpert/messaging'

export const MESSAGE_REPLY_SWIPE_ACTIVATION_PX = 8
export const MESSAGE_REPLY_SWIPE_TRIGGER_PX = 48
export const MESSAGE_REPLY_SWIPE_MAX_PX = 64

export interface MessageReplySwipeFrame {
  intent: 'pending' | 'horizontal' | 'vertical' | 'opposite'
  offset: number
  progress: number
  shouldReply: boolean
}

export function messageReplyReference(message: Message): MessageReplyReference {
  return {
    id: message.id,
    sequence: message.sequence,
    senderKind: message.senderKind,
    senderClientPersonId: message.senderClientPersonId,
    body: message.body,
    attachments: [...message.attachments],
  }
}

export function messageReplyPreviewText(
  reply: MessageReplyReference,
  maximumLength = 120,
): string {
  return buildMessagePreview(reply.body, reply.attachments, maximumLength)
    || 'Wiadomość'
}

export function resolveMessageReplySwipe(
  deltaX: number,
  deltaY: number,
): MessageReplySwipeFrame {
  const horizontalDistance = Math.abs(deltaX)
  const verticalDistance = Math.abs(deltaY)
  if (
    horizontalDistance < MESSAGE_REPLY_SWIPE_ACTIVATION_PX
    && verticalDistance < MESSAGE_REPLY_SWIPE_ACTIVATION_PX
  ) {
    return { intent: 'pending', offset: 0, progress: 0, shouldReply: false }
  }
  if (deltaX <= 0) {
    return { intent: 'opposite', offset: 0, progress: 0, shouldReply: false }
  }
  if (horizontalDistance < verticalDistance * 1.25) {
    return { intent: 'vertical', offset: 0, progress: 0, shouldReply: false }
  }

  const offset = Math.min(horizontalDistance, MESSAGE_REPLY_SWIPE_MAX_PX)
  return {
    intent: 'horizontal',
    offset,
    progress: Math.min(1, offset / MESSAGE_REPLY_SWIPE_TRIGGER_PX),
    shouldReply: horizontalDistance >= MESSAGE_REPLY_SWIPE_TRIGGER_PX,
  }
}
