create table public.expert_brand_profiles (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  expert_name text not null default '',
  professional_title text not null default 'Ekspert kredytowy',
  tagline text not null default '',
  contact_email text not null default '',
  contact_phone text not null default '',
  website_url text not null default '',
  location text not null default '',
  bio text not null default '',
  specializations text[] not null default '{}',
  visual_style text not null default 'minimal',
  portrait_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id),
  constraint expert_brand_profiles_membership_fkey
    foreign key (organization_id, user_id)
    references public.organization_memberships(organization_id, user_id)
    on delete cascade,
  constraint expert_brand_profiles_visual_style_check
    check (visual_style in ('minimal', 'editorial', 'warm')),
  constraint expert_brand_profiles_lengths_check
    check (
      char_length(expert_name) <= 100
      and char_length(professional_title) <= 100
      and char_length(tagline) <= 140
      and char_length(contact_email) <= 160
      and char_length(contact_phone) <= 40
      and char_length(website_url) <= 240
      and char_length(location) <= 100
      and char_length(bio) <= 800
      and cardinality(specializations) <= 8
    ),
  constraint expert_brand_profiles_portrait_path_check
    check (
      portrait_path is null
      or portrait_path like organization_id::text || '/' || user_id::text || '/portrait/%'
    )
);

create trigger set_expert_brand_profiles_updated_at
  before update on public.expert_brand_profiles
  for each row execute function public.set_updated_at();

alter table public.expert_brand_profiles enable row level security;

create policy "experts read own brand profile"
  on public.expert_brand_profiles for select to authenticated
  using (user_id = (select auth.uid()));

create policy "experts insert own brand profile"
  on public.expert_brand_profiles for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and organization_id in (
      select membership.organization_id
      from public.organization_memberships membership
      where membership.user_id = (select auth.uid())
    )
  );

create policy "experts update own brand profile"
  on public.expert_brand_profiles for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "experts delete own brand profile"
  on public.expert_brand_profiles for delete to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.expert_brand_profiles from public, anon, authenticated;
grant select, insert, update, delete on public.expert_brand_profiles to authenticated;
grant all on public.expert_brand_profiles to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'expert-brand-assets',
  'expert-brand-assets',
  true,
  5242880,
  array['image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

comment on table public.expert_brand_profiles is
  'Expert profile content for materials. Product name, logos and visual tokens remain in organization_design_settings.';
