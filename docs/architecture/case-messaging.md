# Case messaging

OpenExpert case messaging is a durable, one-to-one conversation between the
client person who has portal access to a case and the expert who owns that
case. An organization administrator may also access the conversation.

## Delivery model

Neon Postgres is the source of truth. A message is considered **sent** only
after the database transaction commits. That same transaction:

1. allocates a monotonic sequence inside the conversation;
2. inserts the message using a client-generated idempotency key;
3. inserts an outbox event.

The request then attempts a best-effort Ably publish. The realtime payload is
only an invalidation event containing conversation, message and sequence IDs.
It never contains the message body. Connected clients respond by loading the
missing sequence range from the authenticated Nuxt API.

When Ably is not configured or is temporarily unavailable, the UI polls the
same API. The Trigger.dev `openexpert-case-message-outbox` schedule retries
pending and failed realtime events every minute.

## Status semantics

- **sent** — the message row and its outbox event committed in Neon;
- **delivered** — the recipient application acknowledged a sequence;
- **read** — the recipient application acknowledged a sequence while the
  conversation was visible and the document was in the foreground.

Delivery and read state use monotonic high-water marks, not one mutable row per
message. Retried or out-of-order acknowledgements therefore cannot move state
backwards.

Typing indicators are ephemeral Ably events. They are never stored in Postgres
and they do not change message status.

## Access

- Portal endpoints require a verified Better Auth identity, an active
  `client_account_links` row and an active portal grant for the exact case and
  client person.
- CRM endpoints require organization membership and either case ownership or
  the organization administrator role.
- Browser tokens are short-lived and scoped to one durable conversation
  channel plus its ephemeral channel. Browsers cannot publish durable message
  events.
- Database write functions are available only to the service role and repeat
  the portal/CRM access checks inside the transaction.

## Runtime configuration

Configure the following server-only values in both Nuxt deployments and in
the Trigger.dev environment:

```dotenv
NUXT_ABLY_API_KEY=app.key:secret
NUXT_MESSAGING_OUTBOX_SECRET=long-random-secret
OPENEXPERT_MESSAGING_OUTBOX_URL=https://crm.example.com/api/internal/messaging/outbox
```

The Ably API key must allow publish/subscribe on the case-chat namespace,
`push-subscribe` for browser device registration and `push-admin` for the
server-side generic notifications. Do not expose it through public Nuxt
runtime configuration. Web clients obtain disposable token requests from
their authenticated conversation endpoint.

Web push activation is user initiated. Notification payloads are deliberately
generic and carry only an authenticated application route; the message body is
fetched after the user opens the application.

## Operational checks

After deployment:

1. apply the database migration before deploying the Nuxt applications;
2. deploy the Trigger.dev task and confirm its one-minute schedule;
3. send one message in each direction and verify sequence ordering;
4. interrupt Ably access, send a message, restore it and confirm outbox retry;
5. revoke a portal grant and confirm history, send, receipt and token endpoints
   all return not found;
6. confirm a non-owner organization member cannot access the conversation.

Ably setup references:

- <https://ably.com/docs/auth/token>
- <https://ably.com/docs/auth/capabilities>
- <https://ably.com/docs/push/configure/web>
