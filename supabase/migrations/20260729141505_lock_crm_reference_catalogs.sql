-- CRM product types, workflows, statuses and providers are fixed reference
-- catalogues. They remain readable by organization members and writable by
-- service_role migrations, but application users cannot customize them.
revoke insert, update, delete on table
  public.crm_product_types,
  public.crm_workflows,
  public.crm_workflow_statuses,
  public.crm_providers
from authenticated;

drop policy if exists crm_product_types_insert_for_members
  on public.crm_product_types;
drop policy if exists crm_product_types_update_for_members
  on public.crm_product_types;
drop policy if exists crm_product_types_delete_for_members
  on public.crm_product_types;

drop policy if exists crm_workflows_insert_for_members
  on public.crm_workflows;
drop policy if exists crm_workflows_update_for_members
  on public.crm_workflows;
drop policy if exists crm_workflows_delete_for_members
  on public.crm_workflows;

drop policy if exists crm_workflow_statuses_insert_for_members
  on public.crm_workflow_statuses;
drop policy if exists crm_workflow_statuses_update_for_members
  on public.crm_workflow_statuses;
drop policy if exists crm_workflow_statuses_delete_for_members
  on public.crm_workflow_statuses;

drop policy if exists crm_providers_organization_members
  on public.crm_providers;
create policy crm_providers_visible_to_members
  on public.crm_providers for select to authenticated
  using (private.is_organization_member(organization_id));
