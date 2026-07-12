# Organizacje i graf zespołów

## Niezmienniki

- Użytkownik może należeć do wielu organizacji przez `organization_memberships`.
- `users.organization_id` jest wyłącznie organizacją domyślną używaną przy przekierowaniu. Nie jest źródłem autoryzacji.
- Kontekst organizacji zawsze pochodzi ze sluga w URL: `/org/{slug}/...`.
- Każdy endpoint organizacyjny weryfikuje członkostwo dla sluga i jawnie filtruje dane po `organization_id`.
- Zespoły tworzą DAG: graf może mieć wiele korzeni, dowolną głębokość i wielu rodziców jednego węzła, ale nie może zawierać cykli.
- `team_memberships` przechowuje wyłącznie członkostwa bezpośrednie. Członkostwo nie przechodzi automatycznie na rodziców ani potomków.

## Model danych

| Relacja | Znaczenie |
| --- | --- |
| `organization_memberships` | M:N między globalnym profilem użytkownika i organizacją, wraz z rolą organizacyjną. |
| `teams` | Węzły grafu należące do jednej organizacji. |
| `team_edges` | Skierowane krawędzie rodzic → dziecko; klucze złożone uniemożliwiają połączenia między organizacjami. |
| `team_memberships` | Bezpośrednie M:N między użytkownikami organizacji i zespołami. |

Spójność tenantów jest wymuszana zarówno przez RLS, jak i złożone klucze obce zawierające `organization_id`. To samo dotyczy powiązań encji CRM, więc użytkownik należący do kilku organizacji nie może połączyć danych między nimi.

## Ochrona DAG

Krawędzie dodaje publiczne RPC `add_team_edge`. Prywatna implementacja:

1. blokuje modyfikacje grafu advisory lockiem przypisanym do organizacji,
2. zwiększa rewizję grafu jako zabezpieczenie dla transakcji `REPEATABLE READ`,
3. rekurencyjnie sprawdza osiągalność rodzica od dziecka,
4. odrzuca self-edge, duplikat, cykl i połączenie między organizacjami.

Bezpośredni insert jest dodatkowo chroniony triggerem, ale API powinno korzystać z RPC, aby zachować ochronę przed wyścigiem równoległych zapisów.

## Routing i autoryzacja

- `/org` wybiera organizację lub automatycznie przechodzi do jedynej dostępnej.
- `/org/{slug}` przekierowuje do dashboardu organizacji.
- `/org/{slug}/teams` zarządza węzłami, krawędziami i bezpośrednimi członkostwami.
- API organizacyjne znajduje się pod `/api/org/{slug}/...`.

`requireCrmSession` uwierzytelnia użytkownika, rozwiązuje organizację po slugu i weryfikuje `organization_memberships`. Nie przełącza globalnego „active org”, dzięki czemu dwie karty otwarte dla różnych organizacji nie wchodzą ze sobą w wyścig.
