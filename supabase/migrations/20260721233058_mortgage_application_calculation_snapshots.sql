-- Keep the purchase price and the independent appraisal value separate. The
-- latter is intentionally nullable: offers whose LTV basis requires it must
-- remain partial until an appraisal is available.
alter table public.crm_properties
  add column appraisal_value_amount numeric(14,2);

alter table public.crm_properties
  add constraint crm_properties_appraisal_value_amount_check
  check (appraisal_value_amount is null or appraisal_value_amount > 0);

-- A saved offer is only a shortlist entry. These fields freeze the exact
-- property x bank calculation used to start a concrete bank application.
alter table public.crm_case_bank_applications
  add column snapshot_status text not null default 'legacy_missing',
  add column snapshot_schema_version text,
  add column calculator_version text,
  add column comparison_baseline_offer_id uuid,
  add column scenario_snapshot jsonb,
  add column calculation_snapshot jsonb,
  add column purchase_price_amount numeric(14,2),
  add column appraisal_value_amount numeric(14,2),
  add column net_loan_amount numeric(14,2),
  add column gross_loan_amount numeric(14,2),
  add column financed_costs numeric(14,2),
  add column ltv_debt_basis text,
  add column collateral_value_basis text,
  add column ltv_debt_amount numeric(14,2),
  add column collateral_value_amount numeric(14,2),
  add column ltv_pct numeric(9,5),
  add column first_installment numeric(14,2),
  add column first_monthly_outflow numeric(14,2),
  add column cost_first_five_years numeric(14,2),
  add column total_cost numeric(14,2),
  add column calculated_at timestamptz,
  add constraint crm_case_bank_applications_snapshot_status_check
    check (snapshot_status in ('legacy_missing', 'pending_property', 'complete')),
  add constraint crm_case_bank_applications_snapshot_json_check
    check (
      (scenario_snapshot is null or jsonb_typeof(scenario_snapshot) = 'object')
      and (calculation_snapshot is null or jsonb_typeof(calculation_snapshot) = 'object')
    ),
  add constraint crm_case_bank_applications_snapshot_amounts_check
    check (
      (purchase_price_amount is null or purchase_price_amount > 0)
      and (appraisal_value_amount is null or appraisal_value_amount > 0)
      and (net_loan_amount is null or net_loan_amount > 0)
      and (gross_loan_amount is null or gross_loan_amount > 0)
      and (financed_costs is null or financed_costs >= 0)
      and (ltv_debt_amount is null or ltv_debt_amount > 0)
      and (collateral_value_amount is null or collateral_value_amount > 0)
      and (ltv_pct is null or ltv_pct >= 0)
      and (first_installment is null or first_installment >= 0)
      and (first_monthly_outflow is null or first_monthly_outflow >= 0)
      and (cost_first_five_years is null or cost_first_five_years >= 0)
      and (total_cost is null or total_cost >= 0)
      and (gross_loan_amount is null or net_loan_amount is null or gross_loan_amount >= net_loan_amount)
    ),
  add constraint crm_case_bank_applications_complete_snapshot_check
    check (
      snapshot_status <> 'complete'
      or (
        property_id is not null
        and snapshot_schema_version = '1.0'
        and calculator_version is not null
        and comparison_baseline_offer_id is not null
        and scenario_snapshot is not null
        and calculation_snapshot is not null
        and (scenario_snapshot ->> 'sourceOfferId') is not distinct from offer_id::text
        and purchase_price_amount is not null
        and net_loan_amount is not null
        and gross_loan_amount is not null
        and financed_costs is not null
        and ltv_debt_basis is not null
        and collateral_value_basis is not null
        and ltv_debt_amount is not null
        and collateral_value_amount is not null
        and ltv_pct is not null
        and first_installment is not null
        and first_monthly_outflow is not null
        and cost_first_five_years is not null
        and total_cost is not null
        and calculated_at is not null
      )
    ),
  add constraint crm_case_bank_applications_ltv_consistency_check
    check (
      snapshot_status <> 'complete'
      or (
        (
          (ltv_debt_basis = 'net_loan' and abs(ltv_debt_amount - net_loan_amount) <= 0.01)
          or (
            ltv_debt_basis in ('gross_loan', 'facility_limit')
            and abs(ltv_debt_amount - gross_loan_amount) <= 0.01
          )
        )
        and (
          (
            collateral_value_basis = 'purchase_price'
            and abs(collateral_value_amount - purchase_price_amount) <= 0.01
          )
          or (
            collateral_value_basis = 'appraisal_value'
            and appraisal_value_amount is not null
            and abs(collateral_value_amount - appraisal_value_amount) <= 0.01
          )
          or (
            collateral_value_basis = 'lower_of_purchase_and_appraisal'
            and appraisal_value_amount is not null
            and abs(
              collateral_value_amount
              - least(purchase_price_amount, appraisal_value_amount)
            ) <= 0.01
          )
        )
        -- V2 stores five decimal places; legacy V1 snapshots store two, so
        -- half of one V1 basis-point percentage unit is the compatibility bound.
        and abs(
          ltv_pct
          - (ltv_debt_amount / nullif(collateral_value_amount, 0) * 100)
        ) <= 0.00501
      )
    ),
  add constraint crm_case_bank_applications_pending_property_check
    check (snapshot_status <> 'pending_property' or property_id is null),
  add constraint crm_case_bank_applications_baseline_offer_fkey
    foreign key (organization_id, case_id, comparison_baseline_offer_id)
    references public.crm_case_offer_snapshots(organization_id, case_id, id)
    on delete restrict;

create or replace function private.validate_crm_case_bank_application_snapshot()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.snapshot_status = 'complete' and new is distinct from old then
    raise exception using errcode = '23514', message = 'A complete mortgage application calculation snapshot is immutable';
  end if;

  if tg_op = 'UPDATE'
    and old.snapshot_status <> 'complete'
    and new.snapshot_status = 'complete'
    and current_user <> 'service_role' then
    raise exception using errcode = '42501', message = 'Only the trusted server may finalize a mortgage application calculation snapshot';
  end if;

  return new;
end;
$$;

create trigger crm_case_bank_applications_snapshot_guard
before update on public.crm_case_bank_applications
for each row execute function private.validate_crm_case_bank_application_snapshot();

-- Historical applications which had already left draft remain operable. A
-- legacy or otherwise incomplete draft, however, cannot enter the live bank
-- process without the immutable property x offer calculation.
create or replace function private.require_crm_bank_application_snapshot_to_start()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  application_snapshot_status text;
begin
  if old.status_code = 'draft' and new.status_code <> 'draft' then
    select application.snapshot_status
    into application_snapshot_status
    from public.crm_case_bank_applications application
    where application.organization_id = new.organization_id
      and application.submission_id = new.id;

    if found and application_snapshot_status <> 'complete' then
      raise exception using
        errcode = '23514',
        message = 'A complete property calculation is required before starting the bank application';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.require_crm_bank_application_snapshot_to_start()
  from public, anon, authenticated;

create trigger crm_item_submissions_require_bank_application_snapshot_to_start
before update of status_code on public.crm_item_submissions
for each row execute function private.require_crm_bank_application_snapshot_to_start();

-- Application rows are created by the RPCs and never edited directly by the
-- browser. Status, notes and bank decisions live in crm_item_submissions.
revoke update on public.crm_case_bank_applications from authenticated;

create or replace function public.create_crm_case_bank_application_snapshot(
  target_organization_id uuid,
  target_case_id uuid,
  target_offer_id uuid,
  target_property_id uuid,
  target_actor_user_id uuid,
  expected_property_updated_at timestamptz,
  target_scenario_snapshot jsonb,
  target_calculation_snapshot jsonb
)
returns public.crm_case_bank_applications
language plpgsql
security invoker
set search_path = ''
as $$
declare
  result public.crm_case_bank_applications;
  current_property record;
  baseline_offer_id uuid;
  snapshot_property_id uuid;
  snapshot_purchase_price numeric(14,2);
  snapshot_appraisal_value numeric(14,2);
  snapshot_net_amount numeric(14,2);
  snapshot_gross_amount numeric(14,2);
  snapshot_financed_costs numeric(14,2);
  snapshot_ltv_debt_basis text;
  snapshot_collateral_basis text;
  snapshot_ltv_debt_amount numeric(14,2);
  snapshot_collateral_amount numeric(14,2);
  snapshot_ltv_pct numeric(9,5);
  snapshot_first_installment numeric(14,2);
  snapshot_first_outflow numeric(14,2);
  snapshot_cost_five_years numeric(14,2);
  snapshot_total_cost numeric(14,2);
  snapshot_calculator_version text;
  expected_ltv_debt_amount numeric;
  expected_collateral_amount numeric;
begin
  if current_user <> 'service_role' then
    raise exception using errcode = '42501', message = 'Mortgage application snapshots may only be created by the trusted server';
  end if;
  if not exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = target_organization_id
      and membership.user_id = target_actor_user_id
  ) then
    raise exception using errcode = '42501', message = 'The actor is not an organization member';
  end if;
  if target_scenario_snapshot is null
    or target_calculation_snapshot is null
    or jsonb_typeof(target_scenario_snapshot) <> 'object'
    or jsonb_typeof(target_calculation_snapshot) <> 'object' then
    raise exception using errcode = '22023', message = 'Application scenario and calculation snapshots must be JSON objects';
  end if;
  if target_scenario_snapshot ->> 'schemaVersion' <> 'openexpert.mortgage-application-scenario/1.0'
    or target_calculation_snapshot ->> 'schemaVersion' <> 'openexpert.mortgage-application-calculation/1.0'
    or target_calculation_snapshot ->> 'status' <> 'complete' then
    raise exception using errcode = '22023', message = 'Unsupported or incomplete mortgage application snapshot';
  end if;

  if nullif(target_scenario_snapshot ->> 'sourceOfferId', '')::uuid
    is distinct from target_offer_id then
    raise exception using errcode = '23514', message = 'The scenario source offer does not match the requested offer';
  end if;

  baseline_offer_id := (target_scenario_snapshot ->> 'comparisonBaselineOfferId')::uuid;
  snapshot_property_id := (target_scenario_snapshot -> 'property' ->> 'propertyId')::uuid;
  if snapshot_property_id <> target_property_id then
    raise exception using errcode = '23514', message = 'The property snapshot does not match the requested property';
  end if;
  if not exists (
    select 1
    from public.crm_case_offer_snapshots baseline
    where baseline.organization_id = target_organization_id
      and baseline.case_id = target_case_id
      and baseline.id = baseline_offer_id
  ) then
    raise exception using errcode = '23503', message = 'The comparison baseline offer does not belong to the CRM case';
  end if;

  select property.price_amount, property.appraisal_value_amount, property.updated_at
  into current_property
  from public.crm_properties property
  where property.organization_id = target_organization_id
    and property.case_id = target_case_id
    and property.id = target_property_id
  for share;
  if not found then
    raise exception using errcode = '23503', message = 'Property does not belong to the CRM case';
  end if;
  if current_property.updated_at is distinct from expected_property_updated_at then
    raise exception using errcode = '40001', message = 'Property changed while its mortgage application was being calculated';
  end if;

  snapshot_purchase_price := (target_scenario_snapshot -> 'property' ->> 'purchasePrice')::numeric;
  snapshot_appraisal_value := nullif(target_scenario_snapshot -> 'property' ->> 'appraisalValue', '')::numeric;
  if snapshot_purchase_price is distinct from current_property.price_amount
    or snapshot_appraisal_value is distinct from current_property.appraisal_value_amount then
    raise exception using errcode = '40001', message = 'Property values changed while its mortgage application was being calculated';
  end if;

  snapshot_calculator_version := target_calculation_snapshot ->> 'engineVersion';
  snapshot_net_amount := (target_calculation_snapshot -> 'summary' ->> 'netLoanAmount')::numeric;
  snapshot_gross_amount := (target_calculation_snapshot -> 'summary' ->> 'grossLoanAmount')::numeric;
  snapshot_financed_costs := (target_calculation_snapshot -> 'summary' ->> 'financedCosts')::numeric;
  snapshot_ltv_debt_basis := target_calculation_snapshot -> 'summary' ->> 'ltvDebtBasis';
  snapshot_collateral_basis := target_calculation_snapshot -> 'summary' ->> 'collateralValueBasis';
  snapshot_ltv_debt_amount := (target_calculation_snapshot -> 'summary' ->> 'ltvDebtAmount')::numeric;
  snapshot_collateral_amount := (target_calculation_snapshot -> 'summary' ->> 'collateralValueAmount')::numeric;
  snapshot_ltv_pct := (target_calculation_snapshot -> 'summary' ->> 'ltvPct')::numeric;
  snapshot_first_installment := (target_calculation_snapshot -> 'summary' ->> 'firstInstallment')::numeric;
  snapshot_first_outflow := (target_calculation_snapshot -> 'summary' ->> 'firstMonthlyOutflow')::numeric;
  snapshot_cost_five_years := (target_calculation_snapshot -> 'summary' ->> 'costFirstFiveYears')::numeric;
  snapshot_total_cost := (target_calculation_snapshot -> 'summary' ->> 'totalCost')::numeric;
  if snapshot_calculator_version is null
    or snapshot_purchase_price is null
    or snapshot_net_amount is null
    or snapshot_gross_amount is null
    or snapshot_financed_costs is null
    or snapshot_ltv_debt_basis is null
    or snapshot_collateral_basis is null
    or snapshot_ltv_debt_amount is null
    or snapshot_collateral_amount is null
    or snapshot_ltv_pct is null
    or snapshot_first_installment is null
    or snapshot_first_outflow is null
    or snapshot_cost_five_years is null
    or snapshot_total_cost is null then
    raise exception using errcode = '22023', message = 'The complete mortgage application snapshot is missing required summary values';
  end if;
  if snapshot_gross_amount < snapshot_net_amount
    or abs((snapshot_gross_amount - snapshot_net_amount) - snapshot_financed_costs) > 0.01 then
    raise exception using errcode = '23514', message = 'Application gross, net and financed amounts are inconsistent';
  end if;

  if snapshot_ltv_debt_basis = 'net_loan' then
    expected_ltv_debt_amount := snapshot_net_amount;
  elsif snapshot_ltv_debt_basis in ('gross_loan', 'facility_limit') then
    expected_ltv_debt_amount := snapshot_gross_amount;
  else
    raise exception using errcode = '22023', message = 'Unsupported LTV debt basis in the application snapshot';
  end if;
  if abs(snapshot_ltv_debt_amount - expected_ltv_debt_amount) > 0.01 then
    raise exception using errcode = '23514', message = 'The LTV debt amount does not match its declared basis';
  end if;

  if snapshot_collateral_basis = 'purchase_price' then
    expected_collateral_amount := snapshot_purchase_price;
  elsif snapshot_collateral_basis = 'appraisal_value' then
    if snapshot_appraisal_value is null then
      raise exception using errcode = '23514', message = 'An appraisal is required by the collateral value basis';
    end if;
    expected_collateral_amount := snapshot_appraisal_value;
  elsif snapshot_collateral_basis = 'lower_of_purchase_and_appraisal' then
    if snapshot_appraisal_value is null then
      raise exception using errcode = '23514', message = 'An appraisal is required by the collateral value basis';
    end if;
    expected_collateral_amount := least(snapshot_purchase_price, snapshot_appraisal_value);
  else
    raise exception using errcode = '22023', message = 'Unsupported collateral value basis in the application snapshot';
  end if;
  if abs(snapshot_collateral_amount - expected_collateral_amount) > 0.01 then
    raise exception using errcode = '23514', message = 'The collateral amount does not match its declared basis';
  end if;
  if snapshot_collateral_amount <= 0
    or abs(
      snapshot_ltv_pct
      - (snapshot_ltv_debt_amount / snapshot_collateral_amount * 100)
    ) > 0.00501 then
    raise exception using errcode = '23514', message = 'The LTV percentage is inconsistent with debt and collateral amounts';
  end if;

  select * into result
  from public.create_crm_case_bank_application(
    target_organization_id,
    target_case_id,
    target_offer_id,
    target_property_id
  );

  update public.crm_case_bank_applications application
  set
    created_by_user_id = target_actor_user_id,
    snapshot_status = 'complete',
    snapshot_schema_version = '1.0',
    calculator_version = snapshot_calculator_version,
    comparison_baseline_offer_id = baseline_offer_id,
    scenario_snapshot = target_scenario_snapshot,
    calculation_snapshot = target_calculation_snapshot,
    purchase_price_amount = snapshot_purchase_price,
    appraisal_value_amount = snapshot_appraisal_value,
    net_loan_amount = snapshot_net_amount,
    gross_loan_amount = snapshot_gross_amount,
    financed_costs = snapshot_financed_costs,
    ltv_debt_basis = snapshot_ltv_debt_basis,
    collateral_value_basis = snapshot_collateral_basis,
    ltv_debt_amount = snapshot_ltv_debt_amount,
    collateral_value_amount = snapshot_collateral_amount,
    ltv_pct = snapshot_ltv_pct,
    first_installment = snapshot_first_installment,
    first_monthly_outflow = snapshot_first_outflow,
    cost_first_five_years = snapshot_cost_five_years,
    total_cost = snapshot_total_cost,
    calculated_at = now()
  where application.organization_id = target_organization_id
    and application.case_id = target_case_id
    and application.submission_id = result.submission_id
  returning * into result;

  update public.crm_case_items item
  set owner_user_id = coalesce(item.owner_user_id, target_actor_user_id)
  where item.organization_id = target_organization_id
    and item.id = result.case_item_id;
  update public.crm_case_offer_selections selection
  set selected_by_user_id = coalesce(selection.selected_by_user_id, target_actor_user_id)
  where selection.organization_id = target_organization_id
    and selection.case_id = target_case_id;

  return result;
end;
$$;

revoke all on function public.create_crm_case_bank_application_snapshot(
  uuid, uuid, uuid, uuid, uuid, timestamptz, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.create_crm_case_bank_application_snapshot(
  uuid, uuid, uuid, uuid, uuid, timestamptz, jsonb, jsonb
) to service_role;

comment on column public.crm_properties.appraisal_value_amount is
  'Independent appraised collateral value. Never inferred from the purchase price.';
comment on column public.crm_case_bank_applications.calculation_snapshot is
  'Immutable server-calculated property x frozen-offer result used for this bank application.';
