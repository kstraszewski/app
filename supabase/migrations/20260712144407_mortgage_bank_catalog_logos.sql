-- Canonical institution logos shown before an organization uploads its own
-- override. URLs point to public brand assets published by each institution.

alter table public.mortgage_banks
  add column if not exists logo_url text,
  add column if not exists logo_background_color text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.mortgage_banks'::regclass
      and conname = 'mortgage_banks_logo_url_check'
  ) then
    alter table public.mortgage_banks
      add constraint mortgage_banks_logo_url_check
      check (
        logo_url is null
        or (
          char_length(logo_url) <= 1000
          and logo_url ~* '^https://[^[:space:]]+$'
        )
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.mortgage_banks'::regclass
      and conname = 'mortgage_banks_logo_background_color_check'
  ) then
    alter table public.mortgage_banks
      add constraint mortgage_banks_logo_background_color_check
      check (
        logo_background_color is null
        or logo_background_color ~ '^#[0-9A-Fa-f]{6}$'
      );
  end if;
end;
$$;

update public.mortgage_banks
set
  website_url = case slug
    when 'erste' then 'https://www.erste.pl'
    else website_url
  end,
  logo_url = case slug
    when 'pko-bp' then 'https://www.pkobp.pl/api/public/3c663fc2-a8dc-4cb9-ab55-9a4ee64b7c35.svg'
    when 'ing' then 'https://www.ing.pl/_static/img/logo_lsl_new.5800ff4f65b35cf926f5.svg'
    when 'erste' then 'https://www.erste.pl/_fileserver/item/1525064'
    when 'mbank' then 'https://prowly-prod.s3.eu-west-1.amazonaws.com/uploads/5104/assets/254921/large-6ba0fabffbbded7d5ac20f20c407a62b.jpg'
    when 'pekao' then 'https://www.pekao.com.pl/.resources/pekao-module/webresources/dist_v2/img/logo.svg'
    else logo_url
  end,
  logo_background_color = case slug
    when 'erste' then '#2870ED'
    else null
  end
where slug in ('pko-bp', 'ing', 'erste', 'mbank', 'pekao');
