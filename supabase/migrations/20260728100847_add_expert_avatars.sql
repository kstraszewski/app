begin;

alter table public.users
  add column avatar_url text;

alter table public.users
  add constraint users_avatar_url_length_check
  check (avatar_url is null or length(avatar_url) <= 2000);

comment on column public.users.avatar_url is
  'Public-facing expert portrait URL. Null keeps the initials fallback.';

-- Preserve the established catalog implementation and decorate its safe public
-- expert payload with the portrait URL. The wrapper remains service-role only.
alter function public.get_booking_widget_catalog(uuid)
  rename to get_booking_widget_catalog_without_avatar;

alter function public.get_booking_widget_catalog_without_avatar(uuid)
  set schema private;

revoke all on function private.get_booking_widget_catalog_without_avatar(uuid)
  from public, anon, authenticated, service_role;

create function public.get_booking_widget_catalog(p_widget_token uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  result := private.get_booking_widget_catalog_without_avatar(p_widget_token);

  return jsonb_set(
    result,
    '{experts}',
    coalesce((
      select jsonb_agg(
        expert.value
          || jsonb_build_object('avatarUrl', app_user.avatar_url)
        order by expert.ordinality
      )
      from jsonb_array_elements(result -> 'experts')
        with ordinality as expert(value, ordinality)
      left join public.users app_user
        on app_user.id = (expert.value ->> 'userId')::uuid
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_booking_widget_catalog(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_booking_widget_catalog(uuid)
  to service_role;

commit;
