-- Organization catalogue overrides use a strict JSON whitelist. Keep it in
-- sync with the two checklist fields introduced for mortgage product versions.
alter table public.mortgage_product_overrides
  drop constraint mortgage_product_overrides_parameters_check1,
  add constraint mortgage_product_overrides_parameters_allowed_keys_check
    check (
      parameters - array[
        'effective_from', 'effective_to', 'calculation_date', 'data_status',
        'completeness_score', 'interest_type', 'fixed_rate_pct',
        'fixed_period_months', 'margin_pct', 'reference_rate_code',
        'reference_rate_pct', 'reference_rate_as_of',
        'representative_apr_pct', 'min_amount', 'max_amount',
        'min_term_months', 'max_term_months', 'max_ltv_pct', 'is_eco',
        'cost_rules', 'requirements', 'document_requirements',
        'multiform_template_ids', 'representative_example', 'assumptions',
        'unknown_fields'
      ]::text[] = '{}'::jsonb
    );
