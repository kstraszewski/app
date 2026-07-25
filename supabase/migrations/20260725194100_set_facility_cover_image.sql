create or replace function public.set_facility_cover_image(
  p_organization_id uuid,
  p_facility_id uuid,
  p_image_id uuid
)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'openexpert-facility-cover:'
        || p_organization_id::text
        || ':'
        || p_facility_id::text,
      0
    )
  );

  if not exists (
    select 1
    from public.facility_images image
    where image.organization_id = p_organization_id
      and image.facility_id = p_facility_id
      and image.id = p_image_id
  ) then
    raise exception 'facility_image_not_found'
      using errcode = 'P0002';
  end if;

  with ranked_images as (
    select
      image.id,
      (
        pg_catalog.row_number() over (
          order by
            (image.id = p_image_id) desc,
            image.sort_order,
            image.created_at,
            image.id
        ) - 1
      )::integer as next_sort_order
    from public.facility_images image
    where image.organization_id = p_organization_id
      and image.facility_id = p_facility_id
  )
  update public.facility_images image
  set sort_order = ranked.next_sort_order
  from ranked_images ranked
  where image.organization_id = p_organization_id
    and image.facility_id = p_facility_id
    and image.id = ranked.id
    and image.sort_order is distinct from ranked.next_sort_order;
end;
$$;

revoke all on function public.set_facility_cover_image(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.set_facility_cover_image(uuid, uuid, uuid)
  to service_role;

comment on function public.set_facility_cover_image(uuid, uuid, uuid) is
  'Atomically moves one facility image to cover position and normalizes gallery ordering.';
