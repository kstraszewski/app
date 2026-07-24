-- Keep historical funnel events when a booking service is deleted. The
-- recording function still requires a service for new searches and booking
-- attempts; the nullable value only represents a service removed later.

alter table public.booking_widget_events
  drop constraint booking_widget_events_service_shape;

alter table public.booking_widget_events
  add constraint booking_widget_events_service_shape check (
    event_type <> 'widget_view'
    or service_id is null
  );
