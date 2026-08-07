ALTER TABLE public.mortgage_banks
  ADD COLUMN brand_color text,
  ADD COLUMN brand_foreground_color text,
  ADD CONSTRAINT mortgage_banks_brand_color_check
    CHECK (brand_color IS NULL OR brand_color ~ '^#[0-9A-Fa-f]{6}$'),
  ADD CONSTRAINT mortgage_banks_brand_foreground_color_check
    CHECK (brand_foreground_color IS NULL OR brand_foreground_color ~ '^#[0-9A-Fa-f]{6}$');

COMMENT ON COLUMN public.mortgage_banks.brand_color IS
  'Primary institution brand color used for compact UI identification.';
COMMENT ON COLUMN public.mortgage_banks.brand_foreground_color IS
  'Accessible foreground color paired with brand_color.';

INSERT INTO public.mortgage_banks (
  slug,
  name,
  website_url,
  logo_url,
  logo_background_color,
  brand_color,
  brand_foreground_color
)
VALUES
  (
    'pko-bp',
    'PKO Bank Polski / PKO Bank Hipoteczny',
    'https://www.pkobp.pl',
    'https://www.pkobp.pl/api/public/3c663fc2-a8dc-4cb9-ab55-9a4ee64b7c35.svg',
    NULL,
    '#FF2038',
    '#111111'
  ),
  (
    'ing',
    'ING Bank Śląski',
    'https://www.ing.pl',
    'https://www.ing.pl/_static/img/logo_lsl_new.5800ff4f65b35cf926f5.svg',
    NULL,
    '#FF6200',
    '#000066'
  ),
  (
    'erste',
    'Erste Bank Polska',
    'https://www.erste.pl',
    'https://cdn0.erstegroup.com/content/dam/at/eh/common/pictures/logos/holding/Holding_Logo_screen_white_404x192.png',
    '#2870ED',
    '#2870ED',
    '#FFFFFF'
  ),
  (
    'mbank',
    'mBank',
    'https://www.mbank.pl',
    'https://prowly-prod.s3.eu-west-1.amazonaws.com/uploads/5104/assets/254921/large-6ba0fabffbbded7d5ac20f20c407a62b.jpg',
    NULL,
    '#EA0A0A',
    '#FFFFFF'
  ),
  (
    'pekao',
    'Bank Pekao',
    'https://www.pekao.com.pl',
    'https://www.pekao.com.pl/.resources/pekao-module/webresources/dist_v2/img/logo.svg',
    NULL,
    '#D71921',
    '#FFFFFF'
  )
ON CONFLICT (slug) DO UPDATE
SET name = EXCLUDED.name,
    website_url = EXCLUDED.website_url,
    logo_url = EXCLUDED.logo_url,
    logo_background_color = EXCLUDED.logo_background_color,
    brand_color = EXCLUDED.brand_color,
    brand_foreground_color = EXCLUDED.brand_foreground_color;
