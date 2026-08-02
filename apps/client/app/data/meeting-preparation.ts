export type MeetingGoal = 'purchase' | 'construction' | 'refinance' | 'exploring'
export type MeetingStage = 'possibilities' | 'searching' | 'selected' | 'deadline'
export type MeetingIncomeSource =
  | 'employment'
  | 'business'
  | 'civil_contract'
  | 'foreign'
  | 'retirement'
  | 'rental'
  | 'other'
export type CoBorrowerPlan = 'yes' | 'no' | 'unsure'

export interface MeetingPreparationProfile {
  goal: MeetingGoal | null
  stage: MeetingStage | null
  incomeSources: MeetingIncomeSource[]
  coBorrower: CoBorrowerPlan | null
  propertyBudget: string
  ownFunds: string
  comfortablePayment: string
}

interface PreparationOption<T extends string> {
  value: T
  label: string
  description: string
  icon: string
}

export interface MeetingConcept {
  id: string
  title: string
  lead: string
  explanation: string
  question: string
  icon: string
}

export interface PreparationChecklistItem {
  id: string
  group: 'Sytuacja i budżet' | 'Dochody' | 'Nieruchomość lub obecny kredyt'
  label: string
  description: string
  incomeSources?: MeetingIncomeSource[]
  goals?: MeetingGoal[]
  stages?: MeetingStage[]
}

export interface ExpertQuestion {
  id: string
  category: 'Dopasowanie' | 'Koszt i ryzyko' | 'Proces i współpraca'
  text: string
  why: string
  goals?: MeetingGoal[]
  recommended?: boolean
}

export const meetingGoalOptions: PreparationOption<MeetingGoal>[] = [
  {
    value: 'purchase',
    label: 'Zakup mieszkania lub domu',
    description: 'Rynek pierwotny albo wtórny.',
    icon: 'i-lucide-house',
  },
  {
    value: 'construction',
    label: 'Budowa lub większy remont',
    description: 'Działka, harmonogram i wypłata w transzach.',
    icon: 'i-lucide-hammer',
  },
  {
    value: 'refinance',
    label: 'Przeniesienie obecnego kredytu',
    description: 'Porównanie kosztów i warunków refinansowania.',
    icon: 'i-lucide-refresh-cw',
  },
  {
    value: 'exploring',
    label: 'Dopiero sprawdzam możliwości',
    description: 'Chcę wiedzieć, od czego rozsądnie zacząć.',
    icon: 'i-lucide-compass',
  },
]

export const meetingStageOptions: PreparationOption<MeetingStage>[] = [
  {
    value: 'possibilities',
    label: 'Sprawdzam możliwości',
    description: 'Nie mam jeszcze konkretnej nieruchomości ani terminu.',
    icon: 'i-lucide-sparkles',
  },
  {
    value: 'searching',
    label: 'Szukam lub planuję',
    description: 'Znam mniej więcej budżet i horyzont czasowy.',
    icon: 'i-lucide-search',
  },
  {
    value: 'selected',
    label: 'Mam konkretny cel',
    description: 'Wybrana nieruchomość, projekt albo obecny kredyt.',
    icon: 'i-lucide-map-pin-check',
  },
  {
    value: 'deadline',
    label: 'Mam umowę lub ważny termin',
    description: 'Liczą się daty z umowy i bezpieczny harmonogram.',
    icon: 'i-lucide-calendar-clock',
  },
]

export const meetingIncomeSourceOptions: PreparationOption<MeetingIncomeSource>[] = [
  {
    value: 'employment',
    label: 'Umowa o pracę',
    description: 'Na czas określony albo nieokreślony.',
    icon: 'i-lucide-briefcase-business',
  },
  {
    value: 'business',
    label: 'Działalność gospodarcza',
    description: 'Jednoosobowa działalność lub spółka.',
    icon: 'i-lucide-store',
  },
  {
    value: 'civil_contract',
    label: 'Umowy cywilnoprawne',
    description: 'Umowa zlecenie, o dzieło lub kilka źródeł.',
    icon: 'i-lucide-file-signature',
  },
  {
    value: 'foreign',
    label: 'Dochód zagraniczny',
    description: 'Wynagrodzenie w innej walucie lub od zagranicznego pracodawcy.',
    icon: 'i-lucide-earth',
  },
  {
    value: 'retirement',
    label: 'Emerytura lub renta',
    description: 'Stałe świadczenie jako źródło dochodu.',
    icon: 'i-lucide-landmark',
  },
  {
    value: 'rental',
    label: 'Najem lub inne źródło',
    description: 'Dochód dodatkowy, który może wymagać osobnego udokumentowania.',
    icon: 'i-lucide-key-round',
  },
  {
    value: 'other',
    label: 'Inna sytuacja',
    description: 'Ekspert pomoże ustalić, jak najlepiej ją opisać.',
    icon: 'i-lucide-circle-ellipsis',
  },
]

export const coBorrowerOptions: PreparationOption<CoBorrowerPlan>[] = [
  {
    value: 'yes',
    label: 'Tak',
    description: 'Do rozmowy warto przygotować sytuację obu osób.',
    icon: 'i-lucide-users-round',
  },
  {
    value: 'no',
    label: 'Nie',
    description: 'Rozmawiamy tylko o mojej sytuacji.',
    icon: 'i-lucide-user-round',
  },
  {
    value: 'unsure',
    label: 'Jeszcze nie wiem',
    description: 'To może być jeden ze scenariuszy do porównania.',
    icon: 'i-lucide-help-circle',
  },
]

export const meetingConcepts: MeetingConcept[] = [
  {
    id: 'capacity-vs-budget',
    title: 'Zdolność kredytowa to nie to samo co bezpieczna rata',
    lead: 'Bank wylicza, ile może pożyczyć. Ty decydujesz, ile chcesz co miesiąc udźwignąć.',
    explanation: 'Do własnego limitu warto doliczyć miejsce na oszczędności, nieprzewidziane wydatki i zmianę kosztów życia. Najwyższa dostępna kwota nie musi być najlepszym budżetem dla Twojego gospodarstwa domowego.',
    question: 'Jaka rata zostawi mi rozsądny bufor, a nie tylko zmieści się w wyliczeniu banku?',
    icon: 'i-lucide-scale',
  },
  {
    id: 'interest-rate',
    title: 'Stała, okresowo stała i zmienna stopa inaczej rozkładają ryzyko',
    lead: 'Wysokość raty może być przewidywalna tylko przez określony czas albo zmieniać się wraz ze stopą referencyjną.',
    explanation: 'Przy stopie okresowo stałej zapytaj, jak długo obowiązuje obecna stawka i co stanie się po tym okresie. Przy stopie zmiennej rata może rosnąć lub spadać wraz ze zmianą wskaźnika wskazanego w umowie.',
    question: 'Pokaż mi oba scenariusze i wyjaśnij, co stanie się z ratą po zakończeniu okresu stałego.',
    icon: 'i-lucide-chart-no-axes-combined',
  },
  {
    id: 'rrso-total-cost',
    title: 'RRSO pomaga porównywać, ale patrz też na całkowitą kwotę do zapłaty',
    lead: 'Sama wysokość raty albo marża nie pokazuje wszystkich kosztów.',
    explanation: 'Porównuj oferty dla tej samej kwoty i okresu. Sprawdź prowizję, wycenę, konto, kartę, ubezpieczenia oraz inne wymagane usługi. RRSO opiera się na założeniach, dlatego poproś także o rozpisanie kosztów w złotych.',
    question: 'Które koszty są jednorazowe, które cykliczne i jaka jest całkowita kwota do zapłaty?',
    icon: 'i-lucide-receipt-text',
  },
  {
    id: 'installments',
    title: 'Rata równa i malejąca oznaczają inny start oraz inny koszt odsetek',
    lead: 'Niższa rata na początku nie zawsze oznacza niższy koszt całego kredytu.',
    explanation: 'Raty równe są zwykle niższe na początku. Raty malejące startują wyżej, ale kapitał spada szybciej. Dostępność obu wariantów i ich wpływ na zdolność zależą od oferty oraz Twojej sytuacji.',
    question: 'Jak oba warianty wpłyną na pierwszą ratę, zdolność i łączny koszt w moim przypadku?',
    icon: 'i-lucide-list-end',
  },
  {
    id: 'additional-products',
    title: 'Tańsza marża może wymagać konta, karty albo ubezpieczenia',
    lead: 'Pakiet dodatkowych produktów ma sens dopiero po policzeniu kosztu i obowiązków przez cały wymagany okres.',
    explanation: 'Sprawdź, co jest obowiązkowe, jak długo trzeba z tego korzystać i co się stanie po rezygnacji lub niespełnieniu warunków. Poproś o porównanie oferty z pakietem oraz bez niego.',
    question: 'Ile kosztują produkty dodatkowe i jak zmienią się warunki kredytu, jeśli z nich zrezygnuję?',
    icon: 'i-lucide-package-check',
  },
  {
    id: 'early-repayment',
    title: 'Nadpłata jest możliwa, ale jej zasady warto znać przed podpisaniem umowy',
    lead: 'Znaczenie mają typ oprocentowania, okres od zawarcia umowy i sposób rozliczenia kosztów.',
    explanation: 'Zapytaj o ewentualną rekompensatę, minimalną kwotę, sposób zlecenia nadpłaty oraz wybór między skróceniem okresu a obniżeniem raty. Warunki mogą różnić się między ofertami.',
    question: 'Jak dokładnie działa częściowa i całkowita wcześniejsza spłata w każdej z porównywanych ofert?',
    icon: 'i-lucide-fast-forward',
  },
]

export const preparationChecklist: PreparationChecklistItem[] = [
  {
    id: 'goal-budget',
    group: 'Sytuacja i budżet',
    label: 'Znam cel, przybliżony budżet i termin',
    description: 'Orientacyjne kwoty wystarczą na pierwszą rozmowę.',
  },
  {
    id: 'comfortable-payment',
    group: 'Sytuacja i budżet',
    label: 'Wiem, jaka miesięczna rata byłaby dla mnie komfortowa',
    description: 'To punkt odniesienia niezależny od maksymalnej zdolności.',
  },
  {
    id: 'liabilities',
    group: 'Sytuacja i budżet',
    label: 'Mam listę wszystkich rat, kart, limitów i poręczeń',
    description: 'Nawet niewykorzystany limit może mieć znaczenie w analizie banku.',
  },
  {
    id: 'household',
    group: 'Sytuacja i budżet',
    label: 'Potrafię oszacować stałe koszty gospodarstwa domowego',
    description: 'Mieszkanie, utrzymanie, dzieci, transport i inne regularne zobowiązania.',
  },
  {
    id: 'own-funds',
    group: 'Sytuacja i budżet',
    label: 'Znam wysokość i źródło środków własnych',
    description: 'Oddziel wkład własny od rezerwy na koszty transakcji i bezpieczeństwo.',
    goals: ['purchase', 'construction', 'exploring'],
  },
  {
    id: 'employment-details',
    group: 'Dochody',
    label: 'Znam datę zatrudnienia, rodzaj umowy i średni dochód netto',
    description: 'Jeśli umowa jest terminowa, przygotuj również datę jej zakończenia.',
    incomeSources: ['employment'],
  },
  {
    id: 'business-details',
    group: 'Dochody',
    label: 'Znam staż firmy, formę opodatkowania i wyniki z ostatnich okresów',
    description: 'Wymagany zakres dokumentów zależy od banku i sposobu rozliczeń.',
    incomeSources: ['business'],
  },
  {
    id: 'civil-contract-details',
    group: 'Dochody',
    label: 'Mam podsumowanie ciągłości umów i średnich wpływów',
    description: 'Przygotuj okres współpracy, zleceniodawców i typowy miesięczny dochód.',
    incomeSources: ['civil_contract'],
  },
  {
    id: 'foreign-income-details',
    group: 'Dochody',
    label: 'Znam walutę, kraj, typ umowy i sposób wypłaty dochodu',
    description: 'Dochód zagraniczny może zawężać listę dostępnych banków.',
    incomeSources: ['foreign'],
  },
  {
    id: 'other-income-details',
    group: 'Dochody',
    label: 'Mam podsumowanie pozostałych regularnych źródeł dochodu',
    description: 'Przygotuj kwoty, częstotliwość i okres ich uzyskiwania.',
    incomeSources: ['retirement', 'rental', 'other'],
  },
  {
    id: 'property-details',
    group: 'Nieruchomość lub obecny kredyt',
    label: 'Mam podstawowe dane wybranej nieruchomości',
    description: 'Cena, rynek, lokalizacja, metraż, status prawny i numer księgi wieczystej — jeśli jest już znany.',
    goals: ['purchase'],
    stages: ['selected', 'deadline'],
  },
  {
    id: 'agreement-deadlines',
    group: 'Nieruchomość lub obecny kredyt',
    label: 'Mam pod ręką umowę i wszystkie ważne terminy',
    description: 'Zwłaszcza termin zapłaty, finansowania, zadatku i możliwe konsekwencje opóźnienia.',
    stages: ['deadline'],
  },
  {
    id: 'construction-details',
    group: 'Nieruchomość lub obecny kredyt',
    label: 'Mam kosztorys, harmonogram i status formalności budowy',
    description: 'Na pierwszą rozmowę wystarczy wiedzieć, co już jest gotowe: działka, projekt, pozwolenie lub zgłoszenie.',
    goals: ['construction'],
  },
  {
    id: 'current-loan',
    group: 'Nieruchomość lub obecny kredyt',
    label: 'Znam saldo, ratę, oprocentowanie i pozostały okres obecnego kredytu',
    description: 'Warto mieć umowę, aktualny harmonogram oraz informację o warunkach wcześniejszej spłaty.',
    goals: ['refinance'],
  },
  {
    id: 'property-direction',
    group: 'Nieruchomość lub obecny kredyt',
    label: 'Potrafię opisać, czego szukam i w jakim terminie',
    description: 'Miasto, typ nieruchomości, przybliżona cena i planowany moment zakupu.',
    goals: ['purchase', 'exploring'],
    stages: ['possibilities', 'searching'],
  },
]

export const expertQuestions: ExpertQuestion[] = [
  {
    id: 'safe-budget',
    category: 'Dopasowanie',
    text: 'Jaki budżet i rata są bezpieczne w mojej sytuacji, nie tylko maksymalnie dostępne?',
    why: 'Oddziela bankowy limit od Twojego komfortu finansowego.',
    recommended: true,
  },
  {
    id: 'personal-risks',
    category: 'Dopasowanie',
    text: 'Co w mojej sytuacji najmocniej pomaga, a co może ograniczyć zdolność lub wybór banków?',
    why: 'Pozwala od razu ustalić, gdzie są realne ryzyka i co można uporządkować.',
    recommended: true,
  },
  {
    id: 'property-risks',
    category: 'Dopasowanie',
    text: 'Jakie cechy tej nieruchomości albo inwestycji mogą być problemem dla banku?',
    why: 'Cena to nie wszystko — bank ocenia także zabezpieczenie i stan prawny.',
    goals: ['purchase', 'construction'],
  },
  {
    id: 'refinance-threshold',
    category: 'Dopasowanie',
    text: 'Przy jakiej różnicy kosztów refinansowanie faktycznie zaczyna się opłacać?',
    why: 'Uwzględnia koszty zmiany banku, a nie tylko niższą ratę.',
    goals: ['refinance'],
  },
  {
    id: 'rate-scenarios',
    category: 'Koszt i ryzyko',
    text: 'Jak wygląda rata w wariancie okresowo stałym i zmiennym oraz co dzieje się po okresie stałym?',
    why: 'Pokazuje ryzyko stopy procentowej w praktyce.',
    recommended: true,
  },
  {
    id: 'total-cost',
    category: 'Koszt i ryzyko',
    text: 'Jaka jest całkowita kwota do zapłaty i pełna lista kosztów w każdej ofercie?',
    why: 'Chroni przed porównaniem wyłącznie raty, marży albo promocyjnego hasła.',
    recommended: true,
  },
  {
    id: 'cross-sell',
    category: 'Koszt i ryzyko',
    text: 'Które produkty dodatkowe są obowiązkowe, ile kosztują i co się stanie po rezygnacji?',
    why: 'Pozwala policzyć realny koszt konta, karty i ubezpieczeń.',
    recommended: true,
  },
  {
    id: 'early-repayment',
    category: 'Koszt i ryzyko',
    text: 'Jakie są zasady, opłaty i skutki nadpłaty lub wcześniejszej spłaty?',
    why: 'Ważne, jeśli planujesz szybciej zmniejszać dług albo sprzedać nieruchomość.',
  },
  {
    id: 'offer-scope',
    category: 'Proces i współpraca',
    text: 'Z iloma bankami współpracujecie, które obejmie porównanie i czy jakieś pozostają poza nim?',
    why: 'Wyjaśnia zakres rynku, na którym powstanie rekomendacja.',
    recommended: true,
  },
  {
    id: 'compensation',
    category: 'Proces i współpraca',
    text: 'Czy płacę za tę usługę i w jaki sposób ekspert lub pośrednik jest wynagradzany?',
    why: 'Daje pełną przejrzystość relacji i możliwych kosztów.',
  },
  {
    id: 'timeline',
    category: 'Proces i współpraca',
    text: 'Jakie będą kolejne kroki, dokumenty i realny harmonogram od dzisiaj do uruchomienia kredytu?',
    why: 'Zamienia rozmowę w konkretny plan działania.',
    recommended: true,
  },
  {
    id: 'plan-b',
    category: 'Proces i współpraca',
    text: 'Jaki mamy plan B, jeśli wycena, zdolność albo decyzja banku okażą się gorsze od założeń?',
    why: 'Pozwala przygotować alternatywę zanim pojawi się presja czasu.',
  },
]

export const preparationSources = [
  {
    label: 'UOKiK — prawa przy kredycie hipotecznym',
    href: 'https://finanse.uokik.gov.pl/chf/ustawa-o-kredycie-hipotecznym/',
  },
  {
    label: 'KNF — stała czy zmienna stopa oprocentowania',
    href: 'https://www.knf.gov.pl/dla_konsumenta/kampanie_informacyjne/stala_czy_zmienna_stopa_oprocentowania',
  },
  {
    label: 'Rzecznik Finansowy — wcześniejsza spłata kredytu',
    href: 'https://rf.gov.pl/edukacja/baza-wiedzy/najczestsze-pytania-i-odpowiedzi-faq/wczesniejsza-splata-kredytow-w-pytaniach-i-odpowiedziach/',
  },
  {
    label: 'BIK — historia kredytowa i Raport BIK',
    href: 'https://www.bik.pl/dla-ciebie/historia-kredytowa/raport-bik',
  },
  {
    label: 'KNF — rejestr pośredników kredytowych',
    href: 'https://www.knf.gov.pl/podmioty/posrednictwo_kredytowe/dzial_I',
  },
]

export function goalLabel(value: MeetingGoal | null): string {
  return meetingGoalOptions.find(option => option.value === value)?.label || 'Nie wybrano'
}

export function stageLabel(value: MeetingStage | null): string {
  return meetingStageOptions.find(option => option.value === value)?.label || 'Nie wybrano'
}

export function incomeSourceLabels(values: MeetingIncomeSource[]): string[] {
  return values.map(value => (
    meetingIncomeSourceOptions.find(option => option.value === value)?.label || value
  ))
}

export function coBorrowerLabel(value: CoBorrowerPlan | null): string {
  return coBorrowerOptions.find(option => option.value === value)?.label || 'Nie wybrano'
}

export function visibleChecklistItems(
  profile: MeetingPreparationProfile,
): PreparationChecklistItem[] {
  return preparationChecklist.filter((item) => {
    if (item.goals?.length && profile.goal && !item.goals.includes(profile.goal)) return false
    if (item.goals?.length && !profile.goal) return false
    if (item.stages?.length && profile.stage && !item.stages.includes(profile.stage)) return false
    if (item.stages?.length && !profile.stage) return false
    if (item.incomeSources?.length) {
      return item.incomeSources.some(source => profile.incomeSources.includes(source))
    }
    return true
  })
}

export function recommendedQuestionIds(profile: MeetingPreparationProfile): string[] {
  return expertQuestions
    .filter(question => (
      question.recommended
      || Boolean(profile.goal && question.goals?.includes(profile.goal))
    ))
    .map(question => question.id)
}
