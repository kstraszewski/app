alter table public.facilities
  add column latitude double precision,
  add column longitude double precision,
  add constraint facilities_coordinates_pair_check
    check ((latitude is null) = (longitude is null)),
  add constraint facilities_latitude_range_check
    check (latitude is null or latitude between -90 and 90),
  add constraint facilities_longitude_range_check
    check (longitude is null or longitude between -180 and 180);

comment on column public.facilities.latitude is
  'Optional WGS84 latitude published for directory map placement when paired with longitude.';

comment on column public.facilities.longitude is
  'Optional WGS84 longitude published for directory map placement when paired with latitude.';
