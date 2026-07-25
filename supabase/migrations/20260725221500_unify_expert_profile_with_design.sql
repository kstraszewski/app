alter table public.expert_brand_profiles
  drop constraint if exists expert_brand_profiles_logo_path_check,
  drop column if exists brand_name,
  drop column if exists logo_path;

comment on table public.expert_brand_profiles is
  'Expert profile content for materials. Product name, logos and visual tokens remain in organization_design_settings.';
