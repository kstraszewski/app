-- Rekomendacja S defines sigma as a binary regulatory outcome: either 0 p.p.
-- or 1.5 p.p. It is selectable by an administrator after applying the
-- 100-working-day test, but arbitrary intermediate values are not valid.

alter table public.mortgage_capacity_settings
  drop constraint mortgage_capacity_settings_variable_rate_volatility_buffe_check;

alter table public.mortgage_capacity_settings
  add constraint mortgage_capacity_sigma_check
  check (variable_rate_volatility_buffer_pct in (0, 1.5));
