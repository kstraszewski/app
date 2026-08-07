-- Product regulations are permanent bank documents and should not be mixed with
-- time-limited promotion rules.
INSERT INTO public.mortgage_bank_file_categories (
  category_key,
  label,
  icon,
  sort_order
)
VALUES (
  'product_rules',
  'Regulaminy produktów',
  'i-lucide-book-open-check',
  45
)
ON CONFLICT (category_key) DO UPDATE
SET
  label = EXCLUDED.label,
  icon = EXCLUDED.icon,
  sort_order = EXCLUDED.sort_order,
  is_archived = FALSE,
  updated_at = now();
