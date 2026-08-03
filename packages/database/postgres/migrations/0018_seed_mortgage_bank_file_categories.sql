-- Restore the system-owned mortgage document categories that were previously
-- delivered by the historical Supabase bank-file repository migration.

INSERT INTO public.mortgage_bank_file_categories (
  category_key,
  label,
  icon,
  sort_order
)
VALUES
  ('application', 'Wnioski', 'i-lucide-file-pen-line', 10),
  ('pricing', 'Tabele i oprocentowanie', 'i-lucide-table-properties', 20),
  ('general_information', 'Informacje ogólne', 'i-lucide-file-text', 30),
  ('promotion_rules', 'Regulaminy promocji', 'i-lucide-badge-percent', 40),
  ('income_form', 'Dokumenty dochodowe', 'i-lucide-receipt-text', 50),
  ('disbursement_form', 'Wypłata kredytu', 'i-lucide-landmark', 60),
  ('risk_information', 'Ryzyka i stopy', 'i-lucide-shield-alert', 70),
  ('other', 'Pozostałe', 'i-lucide-folder', 100)
ON CONFLICT (category_key) DO UPDATE
SET
  label = EXCLUDED.label,
  icon = EXCLUDED.icon,
  sort_order = EXCLUDED.sort_order,
  is_archived = FALSE,
  updated_at = now();
