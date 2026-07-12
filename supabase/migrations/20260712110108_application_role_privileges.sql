-- Tables created in SQL migrations do not inherit Dashboard-generated grants.
-- Keep anonymous clients away from application data, then grant only the
-- operations that are protected by the RLS policies in this schema.
revoke all on table
  public.organizations,
  public.users,
  public.waitlist,
  public.crm_product_types,
  public.crm_workflows,
  public.crm_workflow_statuses,
  public.crm_clients,
  public.crm_client_people,
  public.crm_cases,
  public.crm_case_participants,
  public.crm_providers,
  public.crm_case_items,
  public.crm_item_submissions,
  public.crm_case_item_settlements,
  public.crm_tasks,
  public.crm_activities,
  public.crm_documents,
  public.crm_properties
from anon, authenticated;

grant select on table
  public.organizations,
  public.users
to authenticated;

grant select, insert, update, delete on table
  public.crm_product_types,
  public.crm_workflows,
  public.crm_workflow_statuses,
  public.crm_clients,
  public.crm_client_people,
  public.crm_cases,
  public.crm_case_participants,
  public.crm_providers,
  public.crm_case_items,
  public.crm_item_submissions,
  public.crm_case_item_settlements,
  public.crm_tasks,
  public.crm_activities,
  public.crm_documents,
  public.crm_properties
to authenticated;

grant all privileges on table
  public.organizations,
  public.users,
  public.waitlist,
  public.crm_product_types,
  public.crm_workflows,
  public.crm_workflow_statuses,
  public.crm_clients,
  public.crm_client_people,
  public.crm_cases,
  public.crm_case_participants,
  public.crm_providers,
  public.crm_case_items,
  public.crm_item_submissions,
  public.crm_case_item_settlements,
  public.crm_tasks,
  public.crm_activities,
  public.crm_documents,
  public.crm_properties
to service_role;

revoke all on function public.set_updated_at() from public, anon, authenticated;
