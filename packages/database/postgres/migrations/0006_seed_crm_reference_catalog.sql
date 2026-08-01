-- Restore the portable, system-owned CRM reference catalogue that used to be
-- delivered by the Supabase data migrations. Demo data and normal CRM writes
-- both depend on these stable product types, workflows, and statuses.

INSERT INTO public.crm_product_types (
  id,
  organization_id,
  domain,
  code,
  name,
  description,
  is_system
)
VALUES
  ('00000000-0000-4000-8000-000000001001', NULL, 'credit', 'credit_mortgage', 'Kredyt hipoteczny', 'Finansowanie zakupu lub budowy nieruchomosci.', TRUE),
  ('00000000-0000-4000-8000-000000001002', NULL, 'credit', 'credit_cash', 'Kredyt gotowkowy', 'Finansowanie bez zabezpieczenia hipotecznego.', TRUE),
  ('00000000-0000-4000-8000-000000001003', NULL, 'credit', 'credit_consolidation', 'Kredyt konsolidacyjny', 'Polaczenie zobowiazan klienta.', TRUE),
  ('00000000-0000-4000-8000-000000001004', NULL, 'credit', 'credit_business', 'Kredyt firmowy', 'Finansowanie dzialalnosci gospodarczej.', TRUE),
  ('00000000-0000-4000-8000-000000002001', NULL, 'insurance', 'insurance_life', 'Ubezpieczenie zycie', 'Ochrona zycia lub zdrowia klienta.', TRUE),
  ('00000000-0000-4000-8000-000000002002', NULL, 'insurance', 'insurance_property', 'Ubezpieczenie nieruchomosci', 'Polisa nieruchomosci, czesto powiazana z kredytem.', TRUE),
  ('00000000-0000-4000-8000-000000002003', NULL, 'insurance', 'insurance_motor', 'Ubezpieczenie komunikacyjne', 'OC, AC i produkty komunikacyjne.', TRUE),
  ('00000000-0000-4000-8000-000000002004', NULL, 'insurance', 'insurance_business', 'Ubezpieczenie firmowe', 'Ochrona majatku i ryzyk firmowych.', TRUE),
  ('00000000-0000-4000-8000-000000002005', NULL, 'insurance', 'insurance_travel', 'Ubezpieczenie podrozne', 'Polisa na wyjazd prywatny lub sluzbowy.', TRUE),
  ('00000000-0000-4000-8000-000000002006', NULL, 'insurance', 'insurance_credit_linked', 'Ubezpieczenie pod kredyt', 'Produkt ubezpieczeniowy wymagany lub rekomendowany przy kredycie.', TRUE),
  ('00000000-0000-4000-8000-000000003001', NULL, 'real_estate', 'real_estate_purchase', 'Zakup nieruchomosci', 'Proces zakupu nieruchomosci przez klienta.', TRUE),
  ('00000000-0000-4000-8000-000000003002', NULL, 'real_estate', 'real_estate_sale', 'Sprzedaz nieruchomosci', 'Proces sprzedazy nieruchomosci klienta.', TRUE),
  ('00000000-0000-4000-8000-000000003003', NULL, 'real_estate', 'real_estate_rent', 'Najem nieruchomosci', 'Proces najmu lub wynajmu nieruchomosci.', TRUE),
  ('00000000-0000-4000-8000-000000003004', NULL, 'real_estate', 'real_estate_investment', 'Inwestycja w nieruchomosci', 'Analiza i prowadzenie zakupu inwestycyjnego.', TRUE)
ON CONFLICT (code) WHERE organization_id IS NULL
DO UPDATE SET
  domain = EXCLUDED.domain,
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  is_active = TRUE,
  is_system = TRUE;

INSERT INTO public.crm_workflows (
  id,
  organization_id,
  scope,
  domain,
  code,
  name,
  is_default,
  is_system
)
VALUES
  ('00000000-0000-4000-8000-000000000101', NULL, 'case', NULL, 'case_default', 'Sprawa', TRUE, TRUE),
  ('00000000-0000-4000-8000-000000000201', NULL, 'case_item', 'credit', 'case_item_credit', 'Produkt kredytowy', TRUE, TRUE),
  ('00000000-0000-4000-8000-000000000202', NULL, 'case_item', 'insurance', 'case_item_insurance', 'Produkt ubezpieczeniowy', TRUE, TRUE),
  ('00000000-0000-4000-8000-000000000203', NULL, 'case_item', 'real_estate', 'case_item_real_estate', 'Produkt nieruchomosciowy', TRUE, TRUE),
  ('00000000-0000-4000-8000-000000000301', NULL, 'submission', NULL, 'submission_default', 'Zgloszenie do instytucji', TRUE, TRUE),
  ('00000000-0000-4000-8000-000000000401', NULL, 'settlement', NULL, 'settlement_default', 'Rozliczenie prowizji', TRUE, TRUE)
ON CONFLICT (scope, code) WHERE organization_id IS NULL
DO UPDATE SET
  domain = EXCLUDED.domain,
  name = EXCLUDED.name,
  is_default = TRUE,
  is_system = TRUE;

WITH status_seed (
  workflow_code,
  code,
  label,
  color,
  sort_order,
  is_initial,
  is_terminal
) AS (
  VALUES
    ('case_default', 'nowa', 'Nowa', 'neutral', 10, TRUE, FALSE),
    ('case_default', 'analiza', 'Analiza', 'info', 20, FALSE, FALSE),
    ('case_default', 'aktywna', 'Aktywna', 'success', 30, FALSE, FALSE),
    ('case_default', 'czeka_na_klienta', 'Czeka na klienta', 'warning', 40, FALSE, FALSE),
    ('case_default', 'zakonczona', 'Zakonczona', 'success', 90, FALSE, TRUE),
    ('case_default', 'utracona', 'Utracona', 'error', 95, FALSE, TRUE),
    ('case_default', 'archiwum', 'Archiwum', 'neutral', 100, FALSE, TRUE),
    ('case_item_credit', 'kwalifikacja', 'Kwalifikacja', 'neutral', 10, TRUE, FALSE),
    ('case_item_credit', 'dokumenty', 'Dokumenty', 'warning', 20, FALSE, FALSE),
    ('case_item_credit', 'oferty', 'Oferty', 'info', 30, FALSE, FALSE),
    ('case_item_credit', 'wnioski_wyslane', 'Wnioski wyslane', 'info', 40, FALSE, FALSE),
    ('case_item_credit', 'decyzja', 'Decyzja', 'warning', 50, FALSE, FALSE),
    ('case_item_credit', 'umowa', 'Umowa', 'success', 60, FALSE, FALSE),
    ('case_item_credit', 'uruchomiony', 'Uruchomiony', 'success', 90, FALSE, TRUE),
    ('case_item_credit', 'utracony', 'Utracony', 'error', 95, FALSE, TRUE),
    ('case_item_insurance', 'analiza_potrzeb', 'Analiza potrzeb', 'neutral', 10, TRUE, FALSE),
    ('case_item_insurance', 'oferty', 'Oferty', 'info', 20, FALSE, FALSE),
    ('case_item_insurance', 'wybrana_oferta', 'Wybrana oferta', 'warning', 30, FALSE, FALSE),
    ('case_item_insurance', 'polisa_wystawiona', 'Polisa wystawiona', 'success', 50, FALSE, FALSE),
    ('case_item_insurance', 'aktywna', 'Aktywna', 'success', 90, FALSE, TRUE),
    ('case_item_insurance', 'odnowienie', 'Odnowienie', 'warning', 95, FALSE, FALSE),
    ('case_item_insurance', 'utracona', 'Utracona', 'error', 100, FALSE, TRUE),
    ('case_item_real_estate', 'przyjecie', 'Przyjecie', 'neutral', 10, TRUE, FALSE),
    ('case_item_real_estate', 'poszukiwanie_lub_listing', 'Poszukiwanie lub listing', 'info', 20, FALSE, FALSE),
    ('case_item_real_estate', 'prezentacje', 'Prezentacje', 'info', 30, FALSE, FALSE),
    ('case_item_real_estate', 'negocjacje', 'Negocjacje', 'warning', 40, FALSE, FALSE),
    ('case_item_real_estate', 'umowa', 'Umowa', 'success', 60, FALSE, FALSE),
    ('case_item_real_estate', 'zamknieta', 'Zamknieta', 'success', 90, FALSE, TRUE),
    ('case_item_real_estate', 'utracona', 'Utracona', 'error', 95, FALSE, TRUE),
    ('submission_default', 'draft', 'Draft', 'neutral', 10, TRUE, FALSE),
    ('submission_default', 'wyslane', 'Wyslane', 'info', 20, FALSE, FALSE),
    ('submission_default', 'w_analizie', 'W analizie', 'warning', 30, FALSE, FALSE),
    ('submission_default', 'braki', 'Braki', 'warning', 40, FALSE, FALSE),
    ('submission_default', 'zaakceptowane', 'Zaakceptowane', 'success', 80, FALSE, TRUE),
    ('submission_default', 'odrzucone', 'Odrzucone', 'error', 90, FALSE, TRUE),
    ('submission_default', 'wycofane', 'Wycofane', 'neutral', 95, FALSE, TRUE),
    ('settlement_default', 'szacowane', 'Szacowane', 'neutral', 10, TRUE, FALSE),
    ('settlement_default', 'oczekiwane', 'Oczekiwane', 'info', 20, FALSE, FALSE),
    ('settlement_default', 'nalezne', 'Nalezne', 'warning', 30, FALSE, FALSE),
    ('settlement_default', 'zaplacone', 'Zaplacone', 'success', 90, FALSE, TRUE),
    ('settlement_default', 'anulowane', 'Anulowane', 'neutral', 95, FALSE, TRUE),
    ('settlement_default', 'sporne', 'Sporne', 'error', 100, FALSE, FALSE)
)
INSERT INTO public.crm_workflow_statuses (
  organization_id,
  workflow_id,
  code,
  label,
  color,
  sort_order,
  is_initial,
  is_terminal
)
SELECT
  NULL,
  workflow.id,
  status_seed.code,
  status_seed.label,
  status_seed.color,
  status_seed.sort_order,
  status_seed.is_initial,
  status_seed.is_terminal
FROM status_seed
JOIN public.crm_workflows AS workflow
  ON workflow.organization_id IS NULL
 AND workflow.code = status_seed.workflow_code
ON CONFLICT (workflow_id, code)
DO UPDATE SET
  label = EXCLUDED.label,
  color = EXCLUDED.color,
  sort_order = EXCLUDED.sort_order,
  is_initial = EXCLUDED.is_initial,
  is_terminal = EXCLUDED.is_terminal;
