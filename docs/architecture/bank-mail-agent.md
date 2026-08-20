# Bank Mail Agent (EVE)

## Status

The repository contains the safe proposal-only foundation for a standalone
bank-mail EVE agent. It does not yet enable provider webhooks, attachment
download, decryption, or automatic document attachment in production.

The first production boundary is intentionally narrow:

```text
provider ingestion
  -> authenticate sender + normalize/redact
  -> idempotent intake and analysis lease
  -> standalone EVE
       -> trusted intake metadata
       -> owner-scoped CRM candidate search
       -> minimal case/application context
       -> human-review proposal or terminal abstention
  -> existing human-approved mortgage artifact pipeline (future consumer)
```

The model is allowed to interpret different layouts, tables, forwarded text,
and naming conventions. Authentication, tenant scope, authorization,
idempotency, attachment safety, and every domain mutation remain deterministic.

## Runtime separation

- `apps/bank-mail-agent` is a standalone EVE deployment using the pinned
  `deepseek/deepseek-v4-flash-0731` checkpoint.
- The primary CRM agent uses the pinned
  `deepseek/deepseek-v4-pro-0813` checkpoint.
- Both agents import pure domain capabilities from
  `packages/crm-agent-capabilities`.
- They do not share EVE tool wrappers or principals. The CRM agent authenticates
  a user; the mail agent authenticates the exact ingestion service and immutable
  intake/run scope.
- CRM reads made by the mail agent use an acting-user token for the mailbox
  owner, preserving RLS. The service client is limited to narrow ledger RPCs.

## Signed invocation scope

The dispatcher must claim the intake and analysis run before creating an EVE
session. It then mints a short-lived Data API service JWT with only:

- exact service and preset identifiers;
- organization id and slug;
- mailbox owner and connection ids;
- intake and analysis-run ids.

These values never come from model arguments. Follow-up requests must present
the same scope as the session initiator. The analysis lease token remains in
the dispatcher and is never sent to the model.

## Data minimization

Before dispatch, `buildBankMailAgentPrompt`:

- converts input to bounded plain text;
- removes control characters;
- redacts PESEL/NIP-like values, e-mail addresses, and links;
- limits subject/body/filename length and attachment count;
- omits provider message ids, mailbox ids, and authorization scope.

The capability DTO allows case/application ids, case title, applicant display
names, bank, status, and external application reference. It does not select
contact data, PESEL/NIP, notes, descriptions, activity bodies, task bodies, or
document contents. A second redaction pass protects against sensitive values
pasted into otherwise allowed labels.

## Decision policy

The LLM may propose evidence, but the pure policy reducer and the database RPC
set the action ceiling. In the first version:

- exact unique application reference plus matching bank is strong evidence;
- applicant name alone is weak evidence;
- sender failure, another bank/reference, owner conflict, or ambiguity blocks a
  strong proposal;
- every accepted proposal is still `review_required`;
- automatic attachment is always false.

The final artifact operation must later call the existing mortgage upload and
command pipeline after a human approves the exact case, application, file hash,
and revision. Automation must not be recorded as if the mailbox owner performed
the action manually.

## Idempotency and replay

There are three independent identities:

1. Ingress identity: organization, connection, and hashed provider-message id.
2. Analysis identity: intake, source/normalized-input hashes, model, prompt,
   toolset, and policy versions. A lease elects one dispatcher.
3. Proposal identity: intake, analysis run, target case/application,
   classification, evidence, contradictions, and policy version.

The dispatcher binds the resulting EVE session id to the claimed run. Proposal
and finalization RPCs require that run id. Tool retries therefore return the
same domain result instead of creating a second proposal. EVE event ids may be
used to deduplicate telemetry reads, but never as the business idempotency key.

## Encrypted attachments

EVE never receives PESEL/NIP or a password. Attachment inspection records expose
only opaque ids, hashes, bounded size/MIME category, scan/encryption/extraction
status, and the category of credential that succeeded.

The future quarantine worker must:

- download to private staging and hash while streaming;
- validate magic bytes and scan before and after extraction;
- reject traversal, links/devices, nested archives, oversized entries, high
  compression ratios, excessive entry count, and CPU/time limits;
- derive at most a small bounded set of credentials from clients already linked
  to a candidate case;
- pass the secret to an isolated no-egress process outside argv, environment,
  logs, and EVE;
- erase decrypted temporary data immediately and retain unmatched quarantine
  data only under an explicit short retention policy.

Until that worker and provider attachment download are connected, encrypted
files always remain subject to manual review.

## Debug and evaluation

Production diagnostics are content-free:

- the database decision ledger stores hashes, enums, reason/evidence codes,
  versions, timing, ids, and the EVE session correlation;
- EVE instrumentation records no model or tool inputs/outputs by default;
- `EVE_TRACES_CONTENT=off` is required for real mail;
- support bundles must never include prompt text, mail bodies, filenames,
  names, addresses, PESEL/NIP, passwords, or tool payloads.

Full traces are allowed only for a synthetic corpus outside production, behind
both synthetic-trace flags documented in the agent README. Useful commands are
`eve info`, `eve dev`, `eve logs --events`, `eve traces --verbose`, package unit
tests, and a future `eve eval --strict` corpus. Security gates should assert
zero false automatic attachments, zero cross-tenant results, and zero protected
identifiers in outputs/events.

## Remaining production work

1. Add durable Gmail history/Watch, Microsoft Graph delta/subscriptions, and an
   IMAP polling/IDLE strategy with provider checkpoints.
2. Fetch attachments into a private quarantine namespace and implement the
   isolated scanner/decryptor described above.
3. Add the expert review UI and connect approval to the existing mortgage
   artifact upload/ledger service with explicit automation provenance.
4. Add synthetic multi-bank EVE eval fixtures and live-model quality/cost gates.
5. Define retention/DPIA rules for inbound mail staging and encrypted files.
