# `@openexpert/messaging-ui`

Shared, endpoint-agnostic attachment UI for expert/client conversations.

## Upload controller

```ts
import {
  useMessageAttachmentDrafts,
  type MessageAttachmentDraftAdapter,
} from '@openexpert/messaging-ui'
import type { MessageAttachment } from '@openexpert/messaging'

const attachmentBase = `/api/conversations/${conversationId}/attachments`

const adapter: MessageAttachmentDraftAdapter = {
  async reserve(input) {
    const response = await $fetch<{ data: {
      attachment: MessageAttachment
      upload: { url: string, method: 'PUT', headers?: Record<string, string> }
    } }>(attachmentBase, { method: 'POST', body: input })
    return response.data
  },
  async complete(id) {
    const response = await $fetch<{ data: { attachment: MessageAttachment } }>(
      `${attachmentBase}/${id}/complete`,
      { method: 'POST' },
    )
    return response.data.attachment
  },
  async discard(id) {
    await $fetch(`${attachmentBase}/${id}`, { method: 'DELETE' })
  },
}

const attachmentDrafts = useMessageAttachmentDrafts(adapter)
```

Create `clientMessageId` before selecting the first file and keep it stable for
the whole draft. Send `attachmentDrafts.readyAttachments.value.map(item => item.id)`
as `attachmentIds`. After a successful message POST, call:

```ts
await attachmentDrafts.clear({ discard: false })
```

On draft abandonment use `clear()` (the default discards reservations).

## Composer

```vue
<MessageAttachmentComposer
  :controller="attachmentDrafts"
  :client-message-id="clientMessageId"
>
  <template #input>
    <UTextarea v-model="body" />
  </template>
  <template #submit>
    <UButton type="submit" :disabled="attachmentDrafts.isBusy.value" />
  </template>
</MessageAttachmentComposer>
```

The component owns the picker, paste/drop handling, progress and draft errors.
It exposes `openPicker`, `addFiles`, `handlePaste` and drag/drop handlers for a
larger parent drop target.

## Sent attachments

```vue
<MessageAttachments
  :attachments="message.attachments"
  :url-for="(attachment, download) =>
    `${attachmentBase}/${attachment.id}${download ? '?download=1' : ''}`"
/>
```

Message body and delivery footer intentionally remain in the parent bubble.
