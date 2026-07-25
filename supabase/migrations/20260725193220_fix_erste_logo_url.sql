-- The previous Erste source URL now returns HTML/404. Keep the canonical
-- catalogue on the current public brand asset; organization overrides remain
-- untouched and continue to take precedence.
update public.mortgage_banks
set
  logo_url = 'https://cdn0.erstegroup.com/content/dam/at/eh/common/pictures/logos/holding/Holding_Logo_screen_white_404x192.png',
  logo_background_color = '#2870ED'
where slug = 'erste';
