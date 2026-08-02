import { z } from 'zod'

export const MESSAGE_BODY_MAX_LENGTH = 4_000

const uuidSchema = z.string().uuid()
const sequenceSchema = z.number()
  .int()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER)
const messageSequenceSchema = sequenceSchema.min(1)

export const MessageBodySchema = z.string()
  .max(MESSAGE_BODY_MAX_LENGTH)
  .transform(value => value.trim())
  .pipe(z.string().min(1).max(MESSAGE_BODY_MAX_LENGTH))

export const SendMessageInputSchema = z.object({
  body: MessageBodySchema,
  clientMessageId: uuidSchema,
}).strict()

export type SendMessageInput = z.infer<typeof SendMessageInputSchema>

export const ReceiptUpdateInputSchema = z.object({
  deliveredThroughSequence: sequenceSchema.optional(),
  readThroughSequence: sequenceSchema.optional(),
}).strict()
  .refine(
    value => value.deliveredThroughSequence !== undefined
      || value.readThroughSequence !== undefined,
    { message: 'At least one receipt sequence is required' },
  )
  .transform((value) => {
    const readThroughSequence = value.readThroughSequence
    if (readThroughSequence === undefined) {
      return { deliveredThroughSequence: value.deliveredThroughSequence }
    }

    return {
      deliveredThroughSequence: Math.max(
        value.deliveredThroughSequence ?? 0,
        readThroughSequence,
      ),
      readThroughSequence,
    }
  })

export type ReceiptUpdateInput = z.infer<typeof ReceiptUpdateInputSchema>

export const ConversationTokenRequestSchema = z.object({
  conversationId: uuidSchema,
}).strict()

export type ConversationTokenRequest = z.infer<
  typeof ConversationTokenRequestSchema
>

const messageDurableEventBaseSchema = z.object({
  conversationId: uuidSchema,
  messageId: uuidSchema,
  sequence: messageSequenceSchema,
}).strict()

export const MessageCreatedEventSchema = messageDurableEventBaseSchema.extend({
  kind: z.literal('message.created'),
}).strict()

export const ReceiptUpdatedEventSchema = z.object({
  conversationId: uuidSchema,
  kind: z.literal('receipt.updated'),
  sequence: sequenceSchema,
}).strict()

export const DurableConversationEventSchema = z.discriminatedUnion('kind', [
  MessageCreatedEventSchema,
  ReceiptUpdatedEventSchema,
])

export const TypingUpdatedEventSchema = z.object({
  active: z.boolean(),
  conversationId: uuidSchema,
  kind: z.literal('typing.updated'),
}).strict()

export const ConversationEventSchema = z.discriminatedUnion('kind', [
  MessageCreatedEventSchema,
  ReceiptUpdatedEventSchema,
  TypingUpdatedEventSchema,
])

// Lowercase aliases make the schemas convenient in Nuxt route modules.
export const sendMessageInputSchema = SendMessageInputSchema
export const receiptUpdateInputSchema = ReceiptUpdateInputSchema
export const conversationTokenRequestSchema = ConversationTokenRequestSchema
