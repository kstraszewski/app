-- Supports the expert-side, newest-first list of committed files sent by a
-- client in one case conversation. Draft uploads and discarded reservations
-- are deliberately excluded from the index.

CREATE INDEX crm_case_message_attachments_client_conversation_sent_idx
  ON public.crm_case_message_attachments (
    organization_id,
    conversation_id,
    attached_at DESC,
    id DESC
  )
  WHERE uploader_kind = 'client'::text
    AND message_id IS NOT NULL
    AND discarded_at IS NULL;

COMMENT ON INDEX public.crm_case_message_attachments_client_conversation_sent_idx IS
  'Newest-first lookup for committed client files shown in an expert conversation.';
