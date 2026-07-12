-- Keep direct Data API writes inside the same domain enforced by the shared
-- application validator. Lower bounds already exist on the individual fields.

alter table public.mortgage_capacity_settings
  add constraint mortgage_capacity_social_amounts_upper_bound
  check (
    minimum_social_1_person <= 100000
    and minimum_social_2_people <= 100000
    and minimum_social_3_people <= 100000
    and minimum_social_4_people <= 100000
    and minimum_social_5_people <= 100000
    and minimum_social_additional_person <= 100000
  );
