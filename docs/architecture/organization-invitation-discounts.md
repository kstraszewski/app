# Rabaty przypisane do zaproszeń organizacji

## Cel

Superadministrator może dołączyć do zaproszenia organizacji typu `application`
jedną, nieudostępnianą publicznie ofertę. Rabat jest wyprowadzany wyłącznie z
rekordu zaproszenia i nakładany po stronie serwera w Stripe Checkout. Odbiorca
nie może zmienić jego wartości ani czasu trwania.

Plan bazowy pozostaje niezmienny: 200 PLN brutto za aktywnego użytkownika na
miesiąc. Kupon obniża fakturę Stripe; nie zmienia ceny katalogowej ani liczby
licencjonowanych miejsc.

## Rodzaje rabatu

| Rodzaj | Dane | Zachowanie przy zmianie liczby miejsc | Typowe użycie |
| --- | --- | --- | --- |
| Procentowy | `percentOffBps` od 1 do 10 000 | Skaluje się z całą wartością faktury i przyszłymi miejscami w okresie ważności | 10% na 6 miesięcy, 25% bezterminowo |
| Kwotowy PLN | `amountOffMinor` od 1 grosza, waluta `pln` | Odejmuje stałą kwotę od całej faktury, a nie od każdego miejsca | 200 PLN od pierwszej faktury |
| Darmowy okres | Procentowy 100% (`10 000` bps) | Zeruje należność objętą czasem trwania; karta nadal jest zbierana w Checkout | Pierwsza faktura gratis, 3 miesiące gratis |

Rabat kwotowy jest świadomie rabatem od sumy faktury. Dla organizacji z trzema
miejscami kupon 200 PLN obniża 600 PLN do 400 PLN; nie daje 200 PLN rabatu na
każde miejsce. Rabat per użytkownik należy wyrażać procentem.

## Czas trwania

| Wariant | Stripe | Znaczenie |
| --- | --- | --- |
| Pierwsza faktura | `once` | Rabat obejmuje wyłącznie pierwszą fakturę pierwszej aktywowanej subskrypcji |
| Określona liczba miesięcy | `repeating` + `duration_in_months` 1–36 | Rabat obejmuje faktury i proracje w podanym okresie |
| Bezterminowo | `forever` | Rabat pozostaje na subskrypcji, także po zwiększeniu liczby miejsc |

Oferta jest grantem onboardingowym i aktywuje się tylko dla pierwszej
skutecznie uruchomionej subskrypcji. Anulowanie tej subskrypcji nie przyznaje
automatycznie kuponu po raz drugi. Nowa oferta wymaga nowej, jawnej decyzji
superadministratora.

## Przebieg

1. Superadministrator wybiera rodzaj, wartość i czas trwania w formularzu
   zaproszenia.
2. API waliduje liczby, walutę, dozwolone pola i zabrania rabatu dla
   `intermediary`.
3. Definicja jest zapisana atomowo z zaproszeniem i po utworzeniu staje się
   niezmienna. Resend rotuje token, ale zachowuje ofertę.
4. Publiczny podgląd i email pokazują wyłącznie czytelne warunki, bez ID Stripe.
5. Po akceptacji Checkout odczytuje ofertę z bazy. Klient nie przesyła rabatu.
6. Serwer tworzy lub odtwarza deterministyczny Stripe Coupon ograniczony do
   produktu planu Aplikacja i weryfikuje wszystkie jego parametry.
7. Checkout otrzymuje dokładnie jeden `discounts.coupon`. Pole do wpisania
   Promotion Code jest wtedy wyłączone. Gdy oferta nie jest przypisana,
   dotychczasowe ręczne kody promocyjne pozostają dostępne.
8. Otwarta sesja jest używana ponownie tylko wtedy, gdy zgadzają się organizacja,
   klient, cena, liczba miejsc, środowisko i dokładny kupon/fingerprint.
9. Webhook lub ręczny reconcile oznacza grant jako zastosowany dopiero po
   uzyskaniu aktywnego dostępu. Kolejne Checkout nie przyznają go ponownie.

## Trwały stan

Definicja i projekcja są przechowywane na service-only rekordzie zaproszenia:

- definicja: rodzaj, wartość, waluta, czas trwania i liczba miesięcy;
- stan: `assigned`, `checkout_created`, `applied` albo `revoked`;
- korelacja: Coupon, Checkout Session, Subscription, tryb test/live i czas
  zastosowania.

Surowe identyfikatory Stripe nigdy nie trafiają do publicznego API ani emaila.
Fingerprint jest wyliczany z kanonicznych warunków i wchodzi do ID Coupon,
metadata oraz klucza idempotencji Checkout.

## Reguły bezpieczeństwa

- Rabat może utworzyć tylko superadministrator przez endpoint same-origin.
- Kwota/procent z przeglądarki są ponownie walidowane na serwerze i przez
  constrainty PostgreSQL.
- Stripe Coupon jest tworzony przez backend i musi być zgodny z trybem,
  produktem, wartością, czasem oraz metadanymi zaproszenia.
- Nie łączymy `discounts` z `allow_promotion_codes`.
- Nieważny, usunięty albo niespójny przypisany Coupon zatrzymuje Checkout;
  system nie przechodzi po cichu na pełną cenę.
- 100% rabatu nadal używa `payment_method_collection: always`, dzięki czemu
  przyszłe płatne okresy i dodatkowe miejsca mają zapisaną kartę.
