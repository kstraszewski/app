-- The imported schema contained two historical NOT VALID checks. A fresh
-- target validates them before any application-data restore so invalid rows
-- fail the rehearsal rather than silently remaining unverified.

ALTER TABLE public.booking_widget_events
  VALIDATE CONSTRAINT booking_widget_events_event_id_shape;

ALTER TABLE public.booking_widget_events
  VALIDATE CONSTRAINT booking_widget_events_service_shape;
