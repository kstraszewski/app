# CRM Bank Mail Agent (EVE)

Prywatny, ograniczony agent backendowy aplikacji Nuxt `apps/crm`, przeznaczony
do analizy jednej wiadomości bankowej. Jego
górną granicą autonomii jest utworzenie idempotentnej propozycji dopasowania
maila do sprawy. Agent nie dołącza plików, nie zmienia procesu kredytowego i nie
wysyła poczty.

## Przepływ

```text
provider mail -> zaufany intake/normalizacja -> EVE (ten serwis)
                                              -> read-only CRM capabilities
                                              -> proposal/no-match RPC
                                              -> kolejka weryfikacji człowieka
```

Warstwa ingestion poza tym serwisem odpowiada za stabilną tożsamość wiadomości,
uwierzytelnienie nadawcy, dopasowanie domeny do konfiguracji banku, limity treści,
redakcję PESEL/NIP oraz rejestrację intake. Do modelu należy wysłać wyłącznie
ograniczony tekst wiadomości i bezpieczne wyniki inspekcji dokumentów. UUID
organizacji, skrzynki, właściciela i intake nie są częścią promptu.

Agent uruchamia się jako prywatny serwis EVE w tym samym projekcie Vercel co
Nuxt CRM. Nie ma publicznego rewrite'u ani osobnego projektu Vercel; dispatcher
Nuxt dociera do niego wyłącznie przez service binding. Kanał `/eve` jest
zamknięty i dodatkowo wymaga krótko żyjącego Data API JWT z rolą
`openexpert_service` oraz dokładnymi claims:

```json
{
  "serviceId": "openexpert-crm-bank-mail-ingestion",
  "preset": "bank-mail-intake",
  "organizationId": "<uuid>",
  "organizationSlug": "<slug>",
  "intakeId": "<uuid>",
  "analysisRunId": "<uuid>",
  "connectionId": "<uuid>",
  "mailboxOwnerUserId": "<uuid>"
}
```

Dispatcher wywołuje `claim_bank_mail_agent_run` przed utworzeniem sesji, dzięki
czemu duplikat wiadomości nie uruchamia drugi raz modelu. Token lease służy
dispatcherowi tylko do powiązania sesji i nigdy nie trafia do EVE. Każdy claim
jest walidowany, a zakres inicjatora i bieżącego wywołania musi
pozostać identyczny przez całą trwałą sesję. W produkcji nie ma anonymous,
placeholder ani local-dev auth. Upload kanału jest wyłączony.

## Narzędzia i uprawnienia

- `load_trusted_intake_metadata` — zaufany, PII-free stan intake i ocena
  tożsamości nadawcy.
- `list_attachment_inspections` — tylko statusy kwarantanny/skanu/ekstrakcji,
  prefiksy hashy i kategoria użytego sekretu; bez wartości, nazwy i bajtów.
- `search_case_candidates` — współdzielona capability CRM uruchamiana jako
  właściciel skrzynki, dodatkowo ograniczona do `owned-by-actor`.
- `get_case_match_context` — minimalny kontekst kandydata bez danych
  kontaktowych, notatek, treści dokumentów, PESEL/NIP i aktywności.
- `propose_case_match` — serwisowy, idempotentny RPC. Polityka pozostaje
  `review_required`; auto-attach jest niemożliwy.
- `finalize_intake` — idempotentne zakończenie jako brak dopasowania,
  konieczność wyboru przez człowieka albo odrzucenie bezpieczeństwa.

Domyślne narzędzia `bash`, `read_file`, `write_file`, `glob`, `grep`,
`web_fetch`, `web_search`, `todo` i `agent` są wyłączone. Sandbox ma politykę
sieciową `deny-all`. Współdzielony jest kod capability i schematy, nie wrappery
EVE ani principal głównego agenta.

## Lokalne uruchomienie

Uzupełnij `.env.local` na podstawie `.env.example`. Kanał także lokalnie wymaga
prawidłowo podpisanego tokena serwisowego; dzięki temu test lokalny odtwarza
produkcyjną granicę zaufania.

```bash
pnpm --filter @openexpert/crm-bank-mail-agent eve:info
pnpm --filter @openexpert/crm-bank-mail-agent typecheck
pnpm --filter @openexpert/crm-bank-mail-agent test
pnpm --filter @openexpert/crm-bank-mail-agent eval:list
pnpm --filter @openexpert/crm-bank-mail-agent eval
pnpm --filter @openexpert/crm-bank-mail-agent build
pnpm --filter @openexpert/crm-bank-mail-agent dev
```

`dev` nasłuchuje na stałym porcie `3014`, aby nie kolidować z pozostałymi
agentami EVE uruchamianymi przez Turbo.

Zwykłe `pnpm dev:crm` uruchamia równolegle Nuxt CRM, głównego agenta EVE oraz
ten prywatny serwis. W produkcji `apps/crm/vercel.json` wstrzykuje do Nuxt URL
bindingu jako `BANK_MAIL_AGENT_INTERNAL_URL`; tej zmiennej nie ustawia się
ręcznie i agent nie ma publicznego rewrite'u.

`eval` uruchamia trzy deterministyczne scenariusze EVE z `mockModel` i wyłącznie
syntetycznymi narzędziami: prompt injection, wieloznaczne dopasowanie oraz
jednoznaczny numer wniosku. Fixture jest osobnym targetem pod `evals/fixture`:
nie omija uwierzytelnienia kanału produkcyjnego, nie łączy się z Data API i nie
dotyka CRM. Sprawdza rzeczywisty protokół sesji EVE, kolejność wywołań i sufit
akcji. Nie jest testem integracyjnym serwisowego JWT ani RPC — te granice nadal
pokrywają testy `test/*.test.ts` oraz środowiskowy smoke test dispatchera.

## Analiza i debugowanie

Domyślne debugowanie jest celowo PII-free:

1. `eve info` pokazuje faktycznie odkryty model, kanał, sandbox i zestaw tools.
2. `pnpm --filter @openexpert/crm-bank-mail-agent eval` odtwarza syntetyczne,
   deterministyczne ścieżki i zapisuje artefakty pod
   `evals/fixture/.eve/evals/`.
3. `eve logs --events` pokazuje kolejność kroków i kody błędów bez potrzeby
   rejestrowania maila.
4. Ledger bazy przechowuje idempotency key, wersję promptu/polityki, kody
   dowodów i wynik propozycji. Nie przechowuje tematu, body, nazwisk,
   PESEL/NIP, haseł ani pełnych odpowiedzi modelu.
5. Powtórzenie tego samego intake powinno zwrócić ten sam efekt RPC. To jest
   podstawowy test retry/replay, ponieważ przerwany krok EVE może zostać
   wykonany ponownie.

`agent/instrumentation.ts` domyślnie ustawia `recordInputs: false` i
`recordOutputs: false`, a request span nie zawiera tokena, URL ani body. Pełną
treść można dopuścić wyłącznie dla danych syntetycznych, poza produkcją,
ustawiając jednocześnie:

```dotenv
BANK_MAIL_AGENT_SYNTHETIC_DATA_ONLY=1
BANK_MAIL_AGENT_SYNTHETIC_TRACES=1
```

Plik instrumentation przejmuje konfigurację telemetryczną EVE. Aby faktycznie
eksportować takie syntetyczne spany, trzeba jawnie dodać zatwierdzony exporter
OpenTelemetry w `setup`; domyślnie aplikacja nie wysyła trace do zewnętrznego
systemu.

## Załączniki szyfrowane PESEL/NIP

Ten agent nie przyjmuje hasła i sam nie odszyfrowuje archiwów. Docelowy worker
załączników powinien działać poza modelem: pobrać plik do kwarantanny, sprawdzić
magic bytes i malware/ZIP-bomb, ograniczyć kandydatów do powiązanych z wybraną
sprawą, pobrać PESEL/NIP serwerowo, podać sekret izolowanemu procesowi poza
argv/env/logami i zwrócić agentowi wyłącznie kod inspekcji. Oryginał i sekret
nigdy nie mogą wejść do sesji EVE. Dopóki ta warstwa nie zostanie podłączona,
załącznik pozostaje elementem wymagającym ręcznej weryfikacji.
