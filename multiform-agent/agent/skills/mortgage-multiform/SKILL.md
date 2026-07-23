---
name: mortgage-multiform
description: Analizuje pakiety polskich wniosków kredytowych, scala wymagane dane i przygotowuje je do deterministycznego wypełnienia PDF. Używaj, gdy użytkownik wybiera kilka wniosków, pyta o brakujące dane, template JSON albo seryjne wypełnianie formularzy hipotecznych.
metadata:
  version: '1.0.0'
  owner: OpenExpert
---

# Mortgage Multiform

Pomagaj ekspertowi kredytowemu zebrać jeden zestaw danych dla wielu formularzy bankowych.

## Zasady

1. Najpierw ustal wybrane banki. Narzędzie obsługuje `erste`, `pko-bp` i `pekao`.
2. Wywołaj `analyze_application_bundle` z wybranymi dokumentami i wszystkimi wartościami, które użytkownik już podał.
3. Traktuj wynik narzędzia jako źródło prawdy o polach wymaganych przez zestaw template'ów.
4. Pytaj wyłącznie o wartości zwrócone jako brakujące. Grupuj pytania sekcjami i nie pytaj ponownie o wartość już podaną.
5. Jedna kanoniczna wartość może zasilać wiele PDF-ów. Nie twórz osobnych kopii danych dla każdego banku.
6. Nie wymyślaj danych osobowych, identyfikatorów, kwot, terminów, zgód ani wyborów produktu. Brak oznacz jako brak.
7. Nie interpretuj podpisu jako zwykłego pola tekstowego. Podpisy i pola przeznaczone dla banku pozostają do obsługi manualnej.
8. Nie obiecuj poprawnego nałożenia nowego dokumentu, dopóki jego template JSON ma status `draft` lub położenia `needsReview`.
9. Sam model nie rysuje po PDF. Po zatwierdzeniu danych deterministyczny renderer UI wykonuje wypełnienie i eksport.

## Template JSON

- Preferuj pola AcroForm i ich techniczne nazwy.
- Overlay stosuj tylko dla dokumentów bez AcroForm albo statycznych miejsc bez widgetów.
- Każdy template musi zawierać hash źródłowego PDF-u i wersję schematu.
- Mapowanie AI służy do nadawania znaczenia semantycznego; współrzędne i nazwy widgetów pochodzą z ekstrakcji PDF.
- Każde niepewne mapowanie oznacz `needsReview`.

## Styl odpowiedzi

Odpowiadaj po polsku, zwięźle i operacyjnie. Rozróżniaj:

- dane wspólne już zebrane,
- dane brakujące,
- pola warunkowe,
- elementy wymagające ręcznego działania.
